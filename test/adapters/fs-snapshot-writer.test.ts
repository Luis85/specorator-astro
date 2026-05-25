import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsSnapshotWriter } from '../../src/adapters/fs-snapshot-writer';
import type { NavigationTree } from '../../src/core/domain/navigation';
import type { PageNode, ViewSnapshot } from '../../src/core/domain/types';

/** Build a minimal standalone page node for the given route. */
function pageNode(route: string, isHome = false): PageNode {
	return {
		path: `Site/pages/${route.replace(/^\//, '') || 'index'}.md`,
		route,
		title: route,
		isHome,
		frontmatter: {},
		body: { format: 'markdown', content: `Body for ${route}` },
	};
}

interface PagesManifest {
	version: number;
	generatedAt: string;
	pages: PageNode[];
}

async function readPages(dataDir: string): Promise<PagesManifest> {
	return JSON.parse(await readFile(path.join(dataDir, 'pages.json'), 'utf8')) as PagesManifest;
}

interface NavigationManifest {
	version: number;
	generatedAt: string;
	navigation: NavigationTree;
}

async function readNavigation(dataDir: string): Promise<NavigationManifest> {
	return JSON.parse(
		await readFile(path.join(dataDir, 'navigation.json'), 'utf8'),
	) as NavigationManifest;
}

/** Build a minimal, valid snapshot for the given base id / view name. */
function snapshot(baseId: string, viewName = 'Default'): ViewSnapshot {
	return {
		baseId,
		route: `/${baseId
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')}`,
		source: { kind: 'file', path: `${baseId}.base` },
		view: { type: 'table', name: viewName, order: [] },
		render: { component: 'table', layout: 'BaseLayout' },
		groups: [{ key: null, entries: [] }],
		generatedAt: '2026-01-01T00:00:00.000Z',
	};
}

interface SnapshotIndex {
	version: number;
	generatedAt: string;
	snapshots: { baseId: string; view: string; file: string }[];
}

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

async function readIndex(dataDir: string): Promise<SnapshotIndex> {
	return JSON.parse(await readFile(path.join(dataDir, 'index.json'), 'utf8')) as SnapshotIndex;
}

describe('FsSnapshotWriter (temp-dir contract)', () => {
	let projectDir: string;
	let dataDir: string;

	beforeEach(async () => {
		projectDir = await mkdtemp(path.join(tmpdir(), 'specorator-writer-'));
		dataDir = path.join(projectDir, 'data');
	});

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	it('writes one JSON file per snapshot plus an index enumerating them', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([snapshot('Books/books.base', 'Cards'), snapshot('Projects', 'Table')]);

		const index = await readIndex(dataDir);
		expect(index.version).toBe(1);
		expect(typeof index.generatedAt).toBe('string');
		expect(index.snapshots).toHaveLength(2);

		// Every index entry points at a real file holding the matching snapshot.
		for (const entry of index.snapshots) {
			expect(entry.file.startsWith('snapshots/')).toBe(true);
			const onDisk = JSON.parse(
				await readFile(path.join(dataDir, entry.file), 'utf8'),
			) as ViewSnapshot;
			expect(onDisk.baseId).toBe(entry.baseId);
			expect(onDisk.view.name).toBe(entry.view);
		}

		// The snapshots dir contains exactly the indexed files (no extras).
		const files = await readdir(path.join(dataDir, 'snapshots'));
		expect(files.sort()).toEqual(index.snapshots.map((e) => path.basename(e.file)).sort());
	});

	it('gives colliding base-id slugs distinct files (no clobber)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		// Both slugify to `books` but must not overwrite each other.
		await writer.commit([snapshot('Books', 'A'), snapshot('books', 'B')]);

		const index = await readIndex(dataDir);
		const files = index.snapshots.map((e) => e.file);
		expect(new Set(files).size).toBe(2);
		const onDisk = await readdir(path.join(dataDir, 'snapshots'));
		expect(onDisk).toHaveLength(2);
	});

	it('atomically REPLACES the previous set rather than merging into it', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([snapshot('alpha'), snapshot('beta')]);

		const first = await readIndex(dataDir);
		const firstFiles = first.snapshots.map((e) => path.basename(e.file));
		expect(firstFiles.sort()).toEqual(['alpha.json', 'beta.json']);

		// Commit a different set; the prior files must be gone, not merged.
		await writer.commit([snapshot('gamma')]);

		const second = await readIndex(dataDir);
		expect(second.snapshots.map((e) => e.baseId)).toEqual(['gamma']);

		const remaining = await readdir(path.join(dataDir, 'snapshots'));
		expect(remaining).toEqual(['gamma.json']);
		expect(await exists(path.join(dataDir, 'snapshots', 'alpha.json'))).toBe(false);
		expect(await exists(path.join(dataDir, 'snapshots', 'beta.json'))).toBe(false);
	});

	it('leaves the previous data dir intact when a commit fails mid-stage', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([snapshot('keep-me')]);
		const before = await readIndex(dataDir);

		// A snapshot whose serialization throws makes `stage` reject partway
		// through the write loop (after the directory + index work has begun),
		// exercising the staging-failure path without touching the writer.
		const exploding = snapshot('boom') as ViewSnapshot & { trap: unknown };
		exploding.trap = {
			toJSON() {
				throw new Error('injected staging failure');
			},
		};

		await expect(writer.commit([exploding])).rejects.toThrow('injected staging failure');

		// The prior data dir is untouched: same index, same files.
		const after = await readIndex(dataDir);
		expect(after).toEqual(before);
		const files = await readdir(path.join(dataDir, 'snapshots'));
		expect(files).toEqual(['keep-me.json']);

		// No half-written staging dir is left lying around next to `data/`.
		const stray = (await readdir(projectDir)).filter((name) => name.startsWith('.data.tmp-'));
		expect(stray).toEqual([]);
	});

	it('leaves NO data dir behind when the very first commit fails mid-stage', async () => {
		const writer = new FsSnapshotWriter(projectDir);

		const exploding = snapshot('boom') as ViewSnapshot & { trap: unknown };
		exploding.trap = {
			toJSON() {
				throw new Error('injected staging failure');
			},
		};

		await expect(writer.commit([exploding])).rejects.toThrow('injected staging failure');

		// Nothing was swapped in, so there is neither a data dir nor a temp dir.
		expect(await exists(dataDir)).toBe(false);
		const stray = (await readdir(projectDir)).filter((name) => name.startsWith('.data.tmp-'));
		expect(stray).toEqual([]);
	});

	it('creates the project dir when it does not exist yet', async () => {
		const nested = path.join(projectDir, 'does', 'not', 'exist', 'astro');
		const writer = new FsSnapshotWriter(nested);
		await writer.commit([snapshot('first')]);

		const index = await readIndex(path.join(nested, 'data'));
		expect(index.snapshots.map((e) => e.baseId)).toEqual(['first']);
	});

	it('commits an empty set as an empty, valid data dir (incl. an empty pages manifest)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([]);

		const index = await readIndex(dataDir);
		expect(index.snapshots).toEqual([]);
		const files = await readdir(path.join(dataDir, 'snapshots'));
		expect(files).toEqual([]);

		// pages.json is always written — an empty array is a valid, complete manifest.
		const pages = await readPages(dataDir);
		expect(pages.version).toBe(1);
		expect(pages.pages).toEqual([]);

		// navigation.json is always written too — an empty tree is a valid manifest.
		const navigation = await readNavigation(dataDir);
		expect(navigation.version).toBe(1);
		expect(navigation.navigation).toEqual({ items: [] });
	});

	it('writes the standalone pages into pages.json alongside the snapshots (FR-12)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit(
			[snapshot('Books/books.base', 'Reading')],
			[pageNode('/', true), pageNode('/about')],
		);

		const pages = await readPages(dataDir);
		expect(pages.pages.map((p) => p.route)).toEqual(['/', '/about']);
		expect(pages.pages.find((p) => p.isHome)?.route).toBe('/');
		// The snapshot set committed in the SAME atomic swap is intact too.
		const index = await readIndex(dataDir);
		expect(index.snapshots.map((e) => e.baseId)).toEqual(['Books/books.base']);
	});

	it('atomically REPLACES the previous pages with the new set (no merge)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([], [pageNode('/'), pageNode('/about'), pageNode('/contact')]);
		expect((await readPages(dataDir)).pages.map((p) => p.route)).toEqual([
			'/',
			'/about',
			'/contact',
		]);

		// A later commit with a different page set replaces it wholesale.
		await writer.commit([], [pageNode('/about')]);
		expect((await readPages(dataDir)).pages.map((p) => p.route)).toEqual(['/about']);
	});

	it('leaves the previous pages manifest intact when a commit fails mid-stage', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([snapshot('keep')], [pageNode('/keep')]);
		const before = await readPages(dataDir);

		const exploding = snapshot('boom') as ViewSnapshot & { trap: unknown };
		exploding.trap = {
			toJSON() {
				throw new Error('injected staging failure');
			},
		};
		await expect(writer.commit([exploding], [pageNode('/new')])).rejects.toThrow(
			'injected staging failure',
		);

		// The prior pages.json (and snapshots) are untouched — the swap never ran.
		expect(await readPages(dataDir)).toEqual(before);
	});

	it('writes the resolved navigation tree into navigation.json in the same swap (FR-13)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		const navigation: NavigationTree = {
			items: [
				{ title: 'Home', route: '/', children: [] },
				{
					title: 'Library',
					children: [{ title: 'Books', route: '/books', children: [] }],
				},
			],
		};
		await writer.commit(
			[snapshot('Books/books.base', 'Reading')],
			[pageNode('/', true)],
			navigation,
		);

		expect((await readNavigation(dataDir)).navigation).toEqual(navigation);
		// The snapshots + pages committed in the SAME atomic swap are intact too.
		expect((await readIndex(dataDir)).snapshots.map((e) => e.baseId)).toEqual([
			'Books/books.base',
		]);
		expect((await readPages(dataDir)).pages.map((p) => p.route)).toEqual(['/']);
	});

	it('atomically REPLACES the previous navigation with the new tree (no merge)', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([], [], { items: [{ title: 'Old', route: '/old', children: [] }] });
		expect((await readNavigation(dataDir)).navigation.items.map((i) => i.title)).toEqual([
			'Old',
		]);

		await writer.commit([], [], { items: [{ title: 'New', route: '/new', children: [] }] });
		expect((await readNavigation(dataDir)).navigation.items.map((i) => i.title)).toEqual([
			'New',
		]);
	});

	it('leaves the previous navigation manifest intact when a commit fails mid-stage', async () => {
		const writer = new FsSnapshotWriter(projectDir);
		await writer.commit([snapshot('keep')], [], {
			items: [{ title: 'Keep', route: '/keep', children: [] }],
		});
		const before = await readNavigation(dataDir);

		const exploding = snapshot('boom') as ViewSnapshot & { trap: unknown };
		exploding.trap = {
			toJSON() {
				throw new Error('injected staging failure');
			},
		};
		await expect(
			writer.commit([exploding], [], {
				items: [{ title: 'New', route: '/new', children: [] }],
			}),
		).rejects.toThrow('injected staging failure');

		// The prior navigation.json is untouched — the swap never ran.
		expect(await readNavigation(dataDir)).toEqual(before);
	});

	// Crash-debris sweep + mid-swap recovery (FIX 3) and unique backup paths (FIX 4b).
	describe('crash recovery + debris sweep', () => {
		it('recovers a mid-swap crash: data/ gone but a single data.bak-* present', async () => {
			// Simulate a crash BETWEEN swap's two renames: data/ was moved aside to a
			// backup, but the staging dir never made it into data/. Build a complete
			// backup by committing then renaming data/ → data.bak-*.
			const writer = new FsSnapshotWriter(projectDir);
			await writer.commit([snapshot('survivor')]);
			const backup = path.join(projectDir, 'data.bak-123-456-1');
			await rename(dataDir, backup);
			expect(await exists(dataDir)).toBe(false);

			// The next commit's sweep promotes the lone backup back to data/, then
			// commits the new set over it (so we still end with the new data).
			await writer.commit([snapshot('newer')]);

			const index = await readIndex(dataDir);
			expect(index.snapshots.map((e) => e.baseId)).toEqual(['newer']);
			// The recovered backup was promoted then superseded — no debris remains.
			const debris = (await readdir(projectDir)).filter(
				(n) => n.startsWith('data.bak-') || n.startsWith('.data.tmp-'),
			);
			expect(debris).toEqual([]);
		});

		it('does NOT recover when data/ already exists (ambiguous: leaves data/, sweeps backups)', async () => {
			const writer = new FsSnapshotWriter(projectDir);
			await writer.commit([snapshot('live')]);
			// A leftover backup sits next to a healthy data/ (crash AFTER the swap
			// completed but BEFORE the backup was rm'd). data/ is authoritative.
			const stale = path.join(projectDir, 'data.bak-999-1-1');
			await mkdir(stale, { recursive: true });
			await writeFile(path.join(stale, 'marker.txt'), 'stale');

			await writer.commit([snapshot('live2')]);

			// data/ holds the freshly committed set; the stale backup was swept.
			expect((await readIndex(dataDir)).snapshots.map((e) => e.baseId)).toEqual(['live2']);
			expect(await exists(stale)).toBe(false);
		});

		it('sweeps stray .data.tmp-* staging dirs from a mid-stage crash', async () => {
			const writer = new FsSnapshotWriter(projectDir);
			await writer.commit([snapshot('first')]);
			// An abandoned staging dir from a commit killed mid-stage.
			const orphanTmp = path.join(projectDir, '.data.tmp-deadbeef');
			await mkdir(orphanTmp, { recursive: true });
			await writeFile(path.join(orphanTmp, 'partial.json'), '{}');

			await writer.commit([snapshot('second')]);

			const stray = (await readdir(projectDir)).filter((n) => n.startsWith('.data.tmp-'));
			expect(stray).toEqual([]);
			expect((await readIndex(dataDir)).snapshots.map((e) => e.baseId)).toEqual(['second']);
		});

		it('does NOT recover when multiple data.bak-* exist (ambiguous): sweeps them', async () => {
			const writer = new FsSnapshotWriter(projectDir);
			await writer.commit([snapshot('seed')]);
			// Two backups + no data/ is ambiguous; recovery would have to guess, so
			// it sweeps both rather than picking the wrong one.
			await rename(dataDir, path.join(projectDir, 'data.bak-1-1-1'));
			await mkdir(path.join(projectDir, 'data.bak-2-2-2'), { recursive: true });
			expect(await exists(dataDir)).toBe(false);

			await writer.commit([snapshot('fresh')]);

			expect((await readIndex(dataDir)).snapshots.map((e) => e.baseId)).toEqual(['fresh']);
			const debris = (await readdir(projectDir)).filter((n) => n.startsWith('data.bak-'));
			expect(debris).toEqual([]);
		});

		it('uses a unique backup path per commit even under a frozen clock (FIX 4b)', async () => {
			// The backup name folds in a per-instance monotonic counter on top of
			// timestamp + pid. Freeze the clock so timestamp + pid would collide
			// across commits: without the counter, the second swap would rename a new
			// data/ onto the SAME backup path that still holds the first backup,
			// clobbering it (or, with a leftover, failing). With the counter each
			// commit picks a distinct backup, so a sequence of same-clock commits all
			// succeed and leave no leftover backup behind.
			const writer = new FsSnapshotWriter(projectDir);
			const frozen = Date.now();
			const realNow = Date.now;
			Date.now = () => frozen;
			try {
				await writer.commit([snapshot('one')]);
				await writer.commit([snapshot('two')]);
				await writer.commit([snapshot('three')]);
			} finally {
				Date.now = realNow;
			}

			// Each commit landed cleanly (the last wins) — no clobbered/merged state.
			expect((await readIndex(dataDir)).snapshots.map((e) => e.baseId)).toEqual(['three']);
			// No leftover backups despite the frozen clock — each used a distinct path.
			const debris = (await readdir(projectDir)).filter((n) => n.startsWith('data.bak-'));
			expect(debris).toEqual([]);
		});
	});
});
