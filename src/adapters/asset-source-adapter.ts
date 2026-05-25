import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TFile, normalizePath, type App } from 'obsidian';
import type { AssetSourcePort } from '../core/ports';
import type { AssetCopyTask, AssetLocation } from '../core/usecases/resolve-assets';
import { normalizeReference } from '../core/domain/asset-resolver';

/** Project-relative directory Astro serves at the site root. */
const PUBLIC_DIRNAME = 'public';

/**
 * Resolves and copies referenced vault attachments into the Astro project's
 * `public/` tree (FR-16; DESIGN §5.8). The thin I/O half of the asset pipeline:
 * the pure `resolveSnapshotAssets` use-case decides *what* to copy and *where*;
 * this adapter only reads Obsidian's metadata cache and touches `node:fs`.
 *
 * - `locate` resolves a (possibly wiki) reference against the metadata cache,
 *   relative to the referencing note — Obsidian's own link resolution, so it
 *   honors the user's attachment-folder layout — and returns the concrete vault
 *   path + size. Synchronous (the cache lookup is), so the pure pipeline can
 *   call it inline.
 * - `copyAll` copies each task's vault file into `public/<url>`, **deduped by
 *   content hash** (identical bytes already present are skipped — re-syncs are
 *   cheap and idempotent) and copying **only** the referenced files. A source
 *   that has vanished since `locate` is skipped with a warning, never fatal.
 *
 * `child_process` is never used here; copies are plain file reads/writes.
 */
export class AssetSourceAdapter implements AssetSourcePort {
	/**
	 * @param app the Obsidian app (for the metadata cache + vault).
	 * @param projectDir vault-relative Astro project dir (`<pluginDir>/astro`).
	 * @param vaultBasePath absolute filesystem path of the vault root, used to
	 *   turn a vault-relative attachment path into an absolute source to read.
	 */
	constructor(
		private readonly app: App,
		private readonly projectDir: string,
		private readonly vaultBasePath: string,
	) {}

	locate(reference: string, fromNotePath: string): AssetLocation | null {
		const linkpath = normalizeReference(reference) ?? reference;
		// `getFirstLinkpathDest` applies Obsidian's own link resolution (shortest
		// path, attachment folders, etc.) relative to the referencing note.
		const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, fromNotePath);
		if (!(dest instanceof TFile)) {
			return null;
		}
		return { vaultPath: dest.path, sizeBytes: dest.stat.size };
	}

	async copyAll(tasks: readonly AssetCopyTask[]): Promise<{ warnings: string[] }> {
		const warnings: string[] = [];
		const publicDir = path.join(normalizePath(this.projectDir), PUBLIC_DIRNAME);

		for (const task of tasks) {
			try {
				await this.copyOne(task, publicDir);
			} catch (error) {
				// A source that vanished between harvest and copy, or any I/O error,
				// is non-fatal: warn and keep going (FR-16 — never fail the build).
				warnings.push(
					`Could not copy attachment ${task.source}: ` +
						`${error instanceof Error ? error.message : String(error)} — the page will show a broken image.`,
				);
			}
		}

		return { warnings };
	}

	/** Copy one attachment into `public/`, skipping identical bytes (hash dedup). */
	private async copyOne(task: AssetCopyTask, publicDir: string): Promise<void> {
		const sourceAbs = path.join(this.vaultBasePath, ...task.source.split('/'));
		// `task.url` is a leading-slash public URL (e.g. `/assets/cover.png`); it
		// maps 1:1 onto `public/<url>`.
		const destAbs = path.join(publicDir, ...task.url.replace(/^\/+/, '').split('/'));

		const bytes = await readFile(sourceAbs);
		const existing = await readFile(destAbs).catch((error: unknown) => {
			if (isNotFound(error)) return null;
			throw error;
		});

		// Dedupe by content hash: identical bytes already in place → nothing to do.
		if (existing !== null && sameBytes(existing, bytes)) {
			return;
		}

		await mkdir(path.dirname(destAbs), { recursive: true });
		await writeFile(destAbs, bytes);
	}
}

/** Whether two buffers hold identical content (compared by SHA-256 + length). */
function sameBytes(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return (
		createHash('sha256').update(a).digest('hex') ===
		createHash('sha256').update(b).digest('hex')
	);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: string }).code === 'ENOENT'
	);
}
