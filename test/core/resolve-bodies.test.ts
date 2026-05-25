import { describe, expect, it } from 'vitest';
import { resolveSnapshotBodies } from '../../src/core/usecases/resolve-bodies';
import type { EntrySnapshot, ViewSnapshot } from '../../src/core/domain/types';

/** Build a minimal one-group snapshot for a base at `route` with given entries. */
function snapshot(route: string, entries: EntrySnapshot[]): ViewSnapshot {
	return {
		baseId: route.replace(/^\//, ''),
		route,
		source: { kind: 'file', path: `${route}.base` },
		view: { type: 'table', name: route, order: ['file.name'] },
		render: { component: 'auto', layout: 'auto' },
		groups: [{ key: null, entries }],
		generatedAt: '2026-05-25T00:00:00.000Z',
	};
}

function entry(path: string, basename: string, content?: string): EntrySnapshot {
	return {
		path,
		basename,
		route: '',
		values: { 'file.name': basename },
		...(content !== undefined ? { body: { format: 'markdown' as const, content } } : {}),
	};
}

describe('resolveSnapshotBodies', () => {
	it('resolves an on-site wikilink in a body to the linked entry route', () => {
		const snaps = [
			snapshot('/books', [
				entry('Books/Dune.md', 'Dune', 'See [[Neuromancer]].'),
				entry('Books/Neuromancer.md', 'Neuromancer'),
			]),
		];
		const { snapshots } = resolveSnapshotBodies(snaps);
		expect(snapshots[0]?.groups[0]?.entries[0]?.body?.content).toBe(
			'See [Neuromancer](/books/neuromancer).',
		);
	});

	it('resolves a cross-base wikilink against the global route table', () => {
		const snaps = [
			snapshot('/books', [entry('Books/Dune.md', 'Dune', 'Adapted as [[Dune (film)]].')]),
			snapshot('/films', [entry('Films/Dune (film).md', 'Dune (film)')]),
		];
		const { snapshots } = resolveSnapshotBodies(snaps);
		expect(snapshots[0]?.groups[0]?.entries[0]?.body?.content).toBe(
			'Adapted as [Dune (film)](/films/dune-film).',
		);
	});

	it('degrades an off-site wikilink to plain text (graceful, D8)', () => {
		const snaps = [
			snapshot('/books', [entry('Books/Dune.md', 'Dune', 'See [[Private Note]].')]),
		];
		const { snapshots } = resolveSnapshotBodies(snaps);
		expect(snapshots[0]?.groups[0]?.entries[0]?.body?.content).toBe('See Private Note.');
	});

	it('leaves entries without a body unchanged', () => {
		const snaps = [snapshot('/books', [entry('Books/Dune.md', 'Dune')])];
		const { snapshots } = resolveSnapshotBodies(snaps);
		expect(snapshots[0]?.groups[0]?.entries[0]).not.toHaveProperty('body');
	});

	it('surfaces route-table collision warnings even when there are no body links', () => {
		const snaps = [snapshot('/dup', []), snapshot('/dup', [])];
		const { warnings } = resolveSnapshotBodies(snaps);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0]).toContain('/dup');
	});

	it('does not throw on Dataview / transclusion content in a body', () => {
		const body = 'Body with ![[transclude]] and\n\n```dataview\nLIST\n```';
		const snaps = [snapshot('/n', [entry('a.md', 'A', body)])];
		expect(() => resolveSnapshotBodies(snaps)).not.toThrow();
		// Embeds and Dataview pass straight through unchanged.
		expect(
			resolveSnapshotBodies(snaps).snapshots[0]?.groups[0]?.entries[0]?.body?.content,
		).toBe(body);
	});
});
