import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsSnapshotWriter } from '../../src/adapters/fs-snapshot-writer';
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
});
