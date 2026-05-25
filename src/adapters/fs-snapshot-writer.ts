import {
	type FileHandle,
	mkdir,
	mkdtemp,
	open,
	readdir,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizePath } from 'obsidian';
import { emptyNavigationTree, type NavigationTree } from '../core/domain/navigation';
import type { PageNode, ViewSnapshot } from '../core/domain/types';
import type { SnapshotWriterPort } from '../core/ports';

/** Schema version of the on-disk data dir, bumped if the layout changes. */
const DATA_LAYOUT_VERSION = 1;

/** Subdirectory of the project that holds the committed snapshot set. */
const DATA_DIRNAME = 'data';

/** Prefix of the sibling staging dir used while a commit is being written. */
const TMP_BASENAME_PREFIX = '.data.tmp-';

/** Prefix of the sibling backup dir the prior `data/` is moved aside to during a swap. */
const BACKUP_BASENAME_PREFIX = 'data.bak-';

/** Subdirectory of the data dir that holds one JSON file per snapshot. */
const SNAPSHOTS_DIRNAME = 'snapshots';

/** The manifest the C5 Content Layer loader reads to enumerate snapshots. */
const INDEX_FILENAME = 'index.json';

/** The standalone-pages manifest the template's page loader reads (FR-12). */
const PAGES_FILENAME = 'pages.json';

/** The resolved navigation tree the template's nav loader reads (FR-13). */
const NAVIGATION_FILENAME = 'navigation.json';

/**
 * The site-config sidecar `astro.config.mjs` reads synchronously at config load
 * to set Astro's `site` (required by `@astrojs/sitemap` + canonical/OG, FR-14,
 * FR-23). Committed in the SAME atomic swap as the other manifests.
 */
const SITE_FILENAME = 'site.json';

/** One entry in {@link SnapshotIndex.snapshots}. */
interface SnapshotIndexEntry {
	/** The snapshot's `baseId` (`ViewSnapshot.baseId`). */
	baseId: string;
	/** The view name within that base (`ViewSnapshot.view.name`). */
	view: string;
	/** The listing route for this view (`ViewSnapshot.route`, leading slash). */
	route: string;
	/** Path to the snapshot JSON, relative to the data dir (POSIX separators). */
	file: string;
}

/** Shape of `<dataDir>/index.json`. Consumed by the C5 loader. */
interface SnapshotIndex {
	version: number;
	generatedAt: string;
	snapshots: SnapshotIndexEntry[];
}

/**
 * Shape of `<dataDir>/pages.json` — the standalone-pages manifest (FR-12; DESIGN
 * §5.7). Consumed by the template's page loader (C13), which renders one route
 * per page (the `isHome` page at `/`).
 */
interface PagesManifest {
	version: number;
	generatedAt: string;
	pages: PageNode[];
}

/**
 * Shape of `<dataDir>/navigation.json` — the resolved navigation tree (FR-13;
 * DESIGN §5.7). Consumed by the template's navigation loader, which renders the
 * menu + breadcrumbs across all pages. The plugin resolves the curated settings
 * nav against the route table before commit, so this is already validated.
 */
interface NavigationManifest {
	version: number;
	generatedAt: string;
	navigation: NavigationTree;
}

/**
 * Shape of `<dataDir>/site.json` — the SEO sidecar (FR-14, FR-23; DESIGN §5.7).
 * `astro.config.mjs` reads it synchronously at config load to set Astro's `site`
 * (enabling `@astrojs/sitemap` + canonical/OpenGraph). `siteUrl` is optional:
 * absent/empty leaves `site` unset so dev/build still succeed, with SEO degrading
 * gracefully (warn-don't-fail). Always written so the config never reads a stale
 * URL after the user clears it.
 */
interface SiteManifest {
	version: number;
	generatedAt: string;
	siteUrl?: string;
}

/**
 * Writes snapshots into the Astro project's data directory (FR-3; DESIGN §5.2).
 *
 * On-disk layout (relative to the project dir passed to the constructor):
 *
 * ```
 * <projectDir>/data/
 *   index.json                  # manifest: { version, generatedAt, snapshots: [{ baseId, view, route, file }] }
 *   snapshots/<slug>.json       # one ViewSnapshot per file, slug derived from baseId
 *   pages.json                  # standalone-pages manifest: { version, generatedAt, pages: PageNode[] }
 *   navigation.json             # navigation manifest: { version, generatedAt, navigation: NavigationTree }
 *   site.json                   # SEO sidecar: { version, generatedAt, siteUrl? } (FR-14, FR-23)
 * ```
 *
 * The whole `data/` directory is **atomically replaced** on every `commit`:
 * the full set — snapshots, standalone pages (FR-12), the resolved navigation
 * tree (FR-13), AND the SEO site sidecar (FR-14, FR-23) — is staged in a sibling
 * temp dir, fsynced, then swapped into place in ONE atomic rename. A commit that
 * fails partway never leaves a half-written `data/` — the previous directory
 * (snapshots + pages + navigation + site together) stays intact (sequencing is
 * owned by the writer, not the caller). Writes go through Node `fs`;
 * `normalizePath` is used for the vault-relative project path.
 */
export class FsSnapshotWriter implements SnapshotWriterPort {
	private readonly projectDir: string;
	private readonly dataDir: string;
	private readonly tmpPrefix: string;

	/**
	 * Per-instance monotonic counter folded into every backup dir name so two
	 * commits from the same process in the same millisecond can never pick the
	 * same `data.bak-*` path and clobber each other's backup (FIX 4b).
	 */
	private backupSeq = 0;

	constructor(projectDir: string) {
		// `projectDir` is vault-relative (derived from `manifest.dir`); normalize
		// the separators before deriving any child paths (OBS-3).
		const normalizedProjectDir = normalizePath(projectDir);
		this.projectDir = normalizedProjectDir;
		this.dataDir = path.join(normalizedProjectDir, DATA_DIRNAME);
		this.tmpPrefix = path.join(normalizedProjectDir, TMP_BASENAME_PREFIX);
	}

	async commit(
		snapshots: ViewSnapshot[],
		pages: PageNode[] = [],
		navigation: NavigationTree = emptyNavigationTree(),
		siteUrl?: string,
	): Promise<void> {
		// Ensure the project dir exists so the sibling temp dir can be created.
		await mkdir(path.dirname(this.dataDir), { recursive: true });

		// 0. Sweep crash debris from a prior run before staging: stray `.data.tmp-*`
		//    (a commit killed mid-stage) and `data.bak-*` (killed mid-swap) dirs are
		//    never cleaned otherwise, and a crash BETWEEN the two swap renames leaves
		//    only a backup with no `data/`. Recover that case (FIX 3).
		await this.sweepDebris();

		// 1. Stage the full set in a sibling temp dir on the same filesystem (so
		//    the final swap can be an atomic rename, not a cross-device copy).
		const stagingDir = await mkdtemp(this.tmpPrefix);
		try {
			await this.stage(stagingDir, snapshots, pages, navigation, siteUrl);
		} catch (error) {
			// Staging failed: discard the partial temp dir and leave the existing
			// data dir untouched. Nothing was swapped, so it stays intact (or
			// absent if there was none).
			await rm(stagingDir, { recursive: true, force: true });
			throw error;
		}

		// 2. Swap the staged dir into place atomically.
		await this.swap(stagingDir);
	}

	/**
	 * Sweep stray sibling dirs left by a crashed prior commit, and recover a
	 * mid-swap crash (FIX 3). `swap()` renames `data/` → `data.bak-*` then
	 * `staging` → `data/`; a hard crash BETWEEN the two leaves only the backup and
	 * no `data/`. So:
	 *
	 * - If `data/` is missing but exactly one `data.bak-*` exists, that backup is
	 *   the last complete set — promote it back to `data/`.
	 * - Then delete every remaining `.data.tmp-*` (abandoned staging) and
	 *   `data.bak-*` (already-superseded backup) dir.
	 *
	 * Best-effort: a sibling that another concurrent commit is mid-rename on may
	 * vanish underfoot (ENOENT), which is fine — it is being handled there.
	 */
	private async sweepDebris(): Promise<void> {
		let siblings: string[];
		try {
			siblings = await readdir(this.projectDir);
		} catch (error) {
			// No project dir yet → nothing to sweep (a first commit will create it).
			if (isNotFound(error)) return;
			throw error;
		}

		const tmpDirs = siblings.filter((name) => name.startsWith(TMP_BASENAME_PREFIX));
		const backupDirs = siblings.filter((name) => name.startsWith(BACKUP_BASENAME_PREFIX));

		// Recover a mid-swap crash: `data/` gone but exactly one backup present.
		const dataPresent = siblings.includes(DATA_DIRNAME);
		if (!dataPresent && backupDirs.length === 1) {
			const recovered = await renameIfExists(
				path.join(this.projectDir, backupDirs[0]),
				this.dataDir,
			);
			if (recovered) {
				backupDirs.length = 0; // promoted, no longer debris to sweep
			}
		}

		// Sweep the rest: abandoned staging dirs and any superseded backups.
		for (const name of [...tmpDirs, ...backupDirs]) {
			await rm(path.join(this.projectDir, name), { recursive: true, force: true });
		}
	}

	/**
	 * Write every snapshot file, the snapshot index, the standalone-pages
	 * manifest, and the navigation manifest into the staging dir, then fsync — so
	 * the later atomic swap brings snapshots, pages, AND navigation over together
	 * (a single atomic set, FR-12, FR-13).
	 */
	private async stage(
		stagingDir: string,
		snapshots: ViewSnapshot[],
		pages: PageNode[],
		navigation: NavigationTree,
		siteUrl?: string,
	): Promise<void> {
		const snapshotsDir = path.join(stagingDir, SNAPSHOTS_DIRNAME);
		await mkdir(snapshotsDir, { recursive: true });

		const usedFilenames = new Set<string>();
		const entries: SnapshotIndexEntry[] = [];

		for (const snapshot of snapshots) {
			const filename = uniqueFilename(snapshot.baseId, usedFilenames);
			const filePosix = `${SNAPSHOTS_DIRNAME}/${filename}`;
			const absolute = path.join(snapshotsDir, filename);
			await writeFileSynced(absolute, `${JSON.stringify(snapshot, null, '\t')}\n`);
			entries.push({
				baseId: snapshot.baseId,
				view: snapshot.view.name,
				route: snapshot.route,
				file: filePosix,
			});
		}

		const index: SnapshotIndex = {
			version: DATA_LAYOUT_VERSION,
			generatedAt: new Date().toISOString(),
			snapshots: entries,
		};
		await writeFileSynced(
			path.join(stagingDir, INDEX_FILENAME),
			`${JSON.stringify(index, null, '\t')}\n`,
		);

		// Standalone pages (FR-12): one manifest committed in the SAME staged dir,
		// so the atomic swap brings snapshots and pages over together. Always
		// written (an empty `pages` array is a valid, complete manifest), so the
		// template's page loader never sees a half-written or stale set.
		const pagesManifest: PagesManifest = {
			version: DATA_LAYOUT_VERSION,
			generatedAt: index.generatedAt,
			pages,
		};
		await writeFileSynced(
			path.join(stagingDir, PAGES_FILENAME),
			`${JSON.stringify(pagesManifest, null, '\t')}\n`,
		);

		// Resolved navigation tree (FR-13): one manifest committed in the SAME
		// staged dir, so the atomic swap brings it over with the snapshots + pages.
		// Always written (an empty tree is a valid, complete manifest), so the
		// template's nav loader never sees a half-written or stale menu.
		const navigationManifest: NavigationManifest = {
			version: DATA_LAYOUT_VERSION,
			generatedAt: index.generatedAt,
			navigation,
		};
		await writeFileSynced(
			path.join(stagingDir, NAVIGATION_FILENAME),
			`${JSON.stringify(navigationManifest, null, '\t')}\n`,
		);

		// SEO site sidecar (FR-14, FR-23): the settings site URL, committed in the
		// SAME staged dir so the atomic swap brings it over with the rest.
		// `astro.config.mjs` reads this synchronously at config load to set Astro's
		// `site` (enabling @astrojs/sitemap + canonical/OG). Always written; a
		// trimmed-empty/absent URL is omitted so the config leaves `site` unset and
		// SEO degrades gracefully (warn-don't-fail). Trimmed so blank input is "no
		// URL", never a malformed `site`.
		const trimmedSiteUrl = siteUrl?.trim();
		const siteManifest: SiteManifest = {
			version: DATA_LAYOUT_VERSION,
			generatedAt: index.generatedAt,
			...(trimmedSiteUrl ? { siteUrl: trimmedSiteUrl } : {}),
		};
		await writeFileSynced(
			path.join(stagingDir, SITE_FILENAME),
			`${JSON.stringify(siteManifest, null, '\t')}\n`,
		);

		// fsync the directory trees so the rename's effects survive a crash.
		await fsyncDir(snapshotsDir);
		await fsyncDir(stagingDir);
	}

	/** Atomically replace `dataDir` with the staged dir. */
	private async swap(stagingDir: string): Promise<void> {
		// Move any prior data dir aside first so the live `data/` is only ever
		// the complete previous set or the complete new set — never a mix. The
		// backup name folds in a per-instance monotonic counter on top of the
		// timestamp + pid, so two commits in the same process/millisecond can never
		// collide on the same backup dir and clobber each other's prior set (FIX 4b).
		const backupDir = path.join(
			this.projectDir,
			`${BACKUP_BASENAME_PREFIX}${String(Date.now())}-${String(process.pid)}-${String(
				(this.backupSeq += 1),
			)}`,
		);
		const hadPrevious = await renameIfExists(this.dataDir, backupDir);

		try {
			await rename(stagingDir, this.dataDir);
		} catch (error) {
			// The new set could not be moved into place: restore the previous data
			// dir (if any) so we never leave the project without its prior data.
			if (hadPrevious) {
				await rename(backupDir, this.dataDir).catch(() => undefined);
			}
			await rm(stagingDir, { recursive: true, force: true });
			throw error;
		}

		if (hadPrevious) {
			await rm(backupDir, { recursive: true, force: true });
		}
	}
}

/**
 * Derive a filesystem-safe, deterministic, collision-free filename from a
 * `baseId`. Non-alphanumeric runs collapse to `-`; collisions get a numeric
 * suffix so two bases sharing a slug still land in distinct files.
 */
function uniqueFilename(baseId: string, used: Set<string>): string {
	const slugBase =
		baseId
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'snapshot';
	let candidate = `${slugBase}.json`;
	let n = 1;
	while (used.has(candidate)) {
		candidate = `${slugBase}-${String(n)}.json`;
		n += 1;
	}
	used.add(candidate);
	return candidate;
}

/** Write a file and fsync its contents so they survive the directory swap. */
async function writeFileSynced(absolute: string, contents: string): Promise<void> {
	await writeFile(absolute, contents, 'utf8');
	const handle = await open(absolute, 'r+');
	try {
		await syncQuietly(handle);
	} finally {
		await handle.close();
	}
}

/** fsync a directory so renames within it are durably persisted. */
async function fsyncDir(absolute: string): Promise<void> {
	const handle = await open(absolute, 'r');
	try {
		await syncQuietly(handle);
	} finally {
		await handle.close();
	}
}

// fsync is a crash-durability optimization, NOT correctness: the bytes are
// already written (writeFile/rename completed) by the time we sync. Several
// filesystems refuse fsync outright — cloud-synced vault folders (iCloud,
// OneDrive, Dropbox), network shares, and Windows directory handles surface
// EPERM/EINVAL/ENOTSUP/EISDIR/ENOSYS. Swallow exactly that "fsync unsupported"
// class so a sync/preview still succeeds (with weaker durability) instead of
// aborting the whole commit; rethrow anything else (e.g. EIO).
const FSYNC_UNSUPPORTED_CODES = new Set(['EPERM', 'EINVAL', 'ENOTSUP', 'EISDIR', 'ENOSYS']);

async function syncQuietly(handle: FileHandle): Promise<void> {
	try {
		await handle.sync();
	} catch (error) {
		if (isFsyncUnsupported(error)) return;
		throw error;
	}
}

function isFsyncUnsupported(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		FSYNC_UNSUPPORTED_CODES.has((error as { code?: string }).code ?? '')
	);
}

/** `rename` `from` → `to` if `from` exists; returns whether it existed. */
async function renameIfExists(from: string, to: string): Promise<boolean> {
	try {
		await rename(from, to);
		return true;
	} catch (error) {
		if (isNotFound(error)) return false;
		throw error;
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: string }).code === 'ENOENT'
	);
}
