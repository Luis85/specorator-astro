/*
 * specorator-template-version: 1
 *
 * Custom Content Layer loader (Astro 6) for the committed snapshot set
 * (docs/DESIGN.md §5.5). It reads the on-disk data dir the plugin's snapshot
 * writer (C2) produces — which lives at the Astro project root, OUTSIDE `src/`:
 *
 *   <project>/data/
 *     index.json               # { version, generatedAt, snapshots: [{ baseId, view, route, file }] }
 *     snapshots/<slug>.json     # one ViewSnapshot per file
 *
 * Each snapshot is validated against `snapshotSchema` (see `schema.ts`) before
 * it reaches a page. In dev, a `watcher.on('change', …)` reloads the collection
 * whenever the writer rewrites a snapshot or the index (FR-7), so re-syncing in
 * Obsidian live-updates the Web Viewer preview without a restart.
 *
 * The data dir is resolved from `config.root` (the project root), so it works
 * regardless of the current working directory.
 */
import type { Loader, LoaderContext } from 'astro/loaders';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { indexSchema, snapshotSchema } from './schema';

/** Project-relative data dir (POSIX), resolved against `config.root`. */
const DATA_DIR = 'data';
const INDEX_FILE = 'index.json';

export interface SnapshotLoaderOptions {
	/** Data dir relative to the Astro project root. Defaults to `data`. */
	dir?: string;
}

/**
 * The Content Layer loader that feeds the `snapshots` collection. Reads
 * `<dir>/index.json`, then every snapshot file it lists, validating each with
 * the collection schema. The snapshot's authoritative listing `route` is its
 * store id, so `getStaticPaths()` can map one page per route directly.
 */
export function snapshotLoader(options: SnapshotLoaderOptions = {}): Loader {
	const dir = options.dir ?? DATA_DIR;

	return {
		name: 'specorator-snapshot-loader',
		async load(context: LoaderContext): Promise<void> {
			const { store, logger, config, parseData, watcher } = context;

			const dataDirUrl = new URL(`${dir}/`, config.root);
			const dataDirPath = fileURLToPath(dataDirUrl);
			const indexPath = path.join(dataDirPath, INDEX_FILE);

			const loadAll = async (): Promise<void> => {
				store.clear();

				const indexRaw = await readFile(indexPath, 'utf8').catch((error: unknown) => {
					// No data committed yet (first run, before any sync) is not fatal:
					// the site renders its empty/placeholder state. Anything else is.
					if (isNotFound(error)) {
						logger.info(`No snapshot index at ${indexPath} yet — rendering empty.`);
						return null;
					}
					throw error;
				});
				if (indexRaw === null) return;

				const index = indexSchema.parse(JSON.parse(indexRaw));
				logger.info(
					`Loading ${String(index.snapshots.length)} snapshot(s) from ${dir}/ (data layout v${String(index.version)}).`,
				);

				for (const entry of index.snapshots) {
					// `entry.file` is data-dir-relative with POSIX separators.
					const filePath = path.join(dataDirPath, ...entry.file.split('/'));
					const raw = await readFile(filePath, 'utf8');
					const json = JSON.parse(raw) as Record<string, unknown>;

					// Validate against the collection schema; the store id is the
					// listing route so pages map 1:1 to routes.
					const data = await parseData({ id: entry.route, data: json });
					store.set({
						id: entry.route,
						data,
						filePath: path.relative(fileURLToPath(config.root), filePath),
					});
				}
			};

			await loadAll();

			// Dev-only: reload when the writer rewrites the data dir (FR-7). The
			// writer swaps the whole `data/` atomically, so any change under it
			// (index or a snapshot) means re-read the full set.
			watcher?.on('change', (changedPath: string) => {
				if (isUnderDir(changedPath, dataDirPath)) {
					logger.info('Snapshot data changed — reloading collection.');
					void loadAll();
				}
			});
			watcher?.on('add', (changedPath: string) => {
				if (isUnderDir(changedPath, dataDirPath)) {
					logger.info('Snapshot data added — reloading collection.');
					void loadAll();
				}
			});
		},
		// The collection's own schema (in content.config.ts) validates entries via
		// `parseData`; expose it here too so loader-level typing stays accurate.
		schema: snapshotSchema,
	};
}

/** True if `candidate` is the same as or nested under `dir`. */
function isUnderDir(candidate: string, dir: string): boolean {
	const rel = path.relative(dir, candidate);
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { code?: string }).code === 'ENOENT'
	);
}
