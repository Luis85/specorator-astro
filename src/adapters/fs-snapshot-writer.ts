import { mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { normalizePath } from 'obsidian';
import type { PageNode, ViewSnapshot } from '../core/domain/types';
import type { SnapshotWriterPort } from '../core/ports';

/** Schema version of the on-disk data dir, bumped if the layout changes. */
const DATA_LAYOUT_VERSION = 1;

/** Subdirectory of the project that holds the committed snapshot set. */
const DATA_DIRNAME = 'data';

/** Subdirectory of the data dir that holds one JSON file per snapshot. */
const SNAPSHOTS_DIRNAME = 'snapshots';

/** The manifest the C5 Content Layer loader reads to enumerate snapshots. */
const INDEX_FILENAME = 'index.json';

/** The standalone-pages manifest the template's page loader reads (FR-12). */
const PAGES_FILENAME = 'pages.json';

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
 * Writes snapshots into the Astro project's data directory (FR-3; DESIGN §5.2).
 *
 * On-disk layout (relative to the project dir passed to the constructor):
 *
 * ```
 * <projectDir>/data/
 *   index.json                  # manifest: { version, generatedAt, snapshots: [{ baseId, view, route, file }] }
 *   snapshots/<slug>.json       # one ViewSnapshot per file, slug derived from baseId
 *   pages.json                  # standalone-pages manifest: { version, generatedAt, pages: PageNode[] }
 * ```
 *
 * The whole `data/` directory is **atomically replaced** on every `commit`:
 * the full set — snapshots AND standalone pages (FR-12) — is staged in a sibling
 * temp dir, fsynced, then swapped into place in ONE atomic rename. A commit that
 * fails partway never leaves a half-written `data/` — the previous directory
 * (snapshots + pages together) stays intact (sequencing is owned by the writer,
 * not the caller). Writes go through Node `fs`; `normalizePath` is used for the
 * vault-relative project path.
 */
export class FsSnapshotWriter implements SnapshotWriterPort {
	private readonly dataDir: string;
	private readonly tmpPrefix: string;

	constructor(projectDir: string) {
		// `projectDir` is vault-relative (derived from `manifest.dir`); normalize
		// the separators before deriving any child paths (OBS-3).
		const normalizedProjectDir = normalizePath(projectDir);
		this.dataDir = path.join(normalizedProjectDir, DATA_DIRNAME);
		this.tmpPrefix = path.join(normalizedProjectDir, '.data.tmp-');
	}

	async commit(snapshots: ViewSnapshot[], pages: PageNode[] = []): Promise<void> {
		// Ensure the project dir exists so the sibling temp dir can be created.
		await mkdir(path.dirname(this.dataDir), { recursive: true });

		// 1. Stage the full set in a sibling temp dir on the same filesystem (so
		//    the final swap can be an atomic rename, not a cross-device copy).
		const stagingDir = await mkdtemp(this.tmpPrefix);
		try {
			await this.stage(stagingDir, snapshots, pages);
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
	 * Write every snapshot file, the snapshot index, and the standalone-pages
	 * manifest into the staging dir, then fsync — so the later atomic swap brings
	 * snapshots AND pages over together (a single atomic set, FR-12).
	 */
	private async stage(
		stagingDir: string,
		snapshots: ViewSnapshot[],
		pages: PageNode[],
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

		// fsync the directory trees so the rename's effects survive a crash.
		await fsyncDir(snapshotsDir);
		await fsyncDir(stagingDir);
	}

	/** Atomically replace `dataDir` with the staged dir. */
	private async swap(stagingDir: string): Promise<void> {
		// Move any prior data dir aside first so the live `data/` is only ever
		// the complete previous set or the complete new set — never a mix.
		const backupDir = `${this.dataDir}.bak-${String(Date.now())}-${String(process.pid)}`;
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
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** fsync a directory so renames within it are durably persisted. */
async function fsyncDir(absolute: string): Promise<void> {
	const handle = await open(absolute, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
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
