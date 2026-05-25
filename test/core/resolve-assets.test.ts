import { describe, expect, it } from 'vitest';
import {
	resolveSnapshotAssets,
	type AssetLocation,
	type AssetLocator,
} from '../../src/core/usecases/resolve-assets';
import type { ViewSnapshot } from '../../src/core/domain/types';

/** Build a minimal cards snapshot with a single ungrouped entry's values. */
function snapshot(
	order: string[],
	entries: { path: string; basename: string; values: Record<string, unknown> }[],
): ViewSnapshot {
	return {
		baseId: 'films',
		route: '/films',
		source: { kind: 'file', path: 'Films/films.base' },
		view: { type: 'cards', name: 'Watchlist', order },
		render: { component: 'auto', layout: 'auto' },
		groups: [
			{
				key: null,
				entries: entries.map((e) => ({
					path: e.path,
					basename: e.basename,
					route: `/films/${e.basename.toLowerCase()}`,
					values: e.values as ViewSnapshot['groups'][number]['entries'][number]['values'],
				})),
			},
		],
		generatedAt: '2026-05-24T00:00:00.000Z',
	};
}

/** A locator backed by an in-memory map of vault-relative path → size. */
function fakeLocator(files: Record<string, number | undefined>): AssetLocator {
	return (reference, _fromNotePath): AssetLocation | null => {
		// The fake mirrors the metadata cache by matching the normalized basename
		// or the full reference against known files.
		const key = Object.keys(files).find(
			(p) =>
				p === reference ||
				p.endsWith(`/${stripWrap(reference)}`) ||
				p === stripWrap(reference),
		);
		if (key === undefined) return null;
		const size = files[key];
		return size === undefined ? { vaultPath: key } : { vaultPath: key, sizeBytes: size };
	};
}

function stripWrap(reference: string): string {
	const m = /^!?\[\[(.*)\]\]$/.exec(reference.trim());
	return (m ? m[1] : reference).split('|')[0].split('#')[0].trim();
}

describe('resolveSnapshotAssets', () => {
	it('rewrites a located image value to its public URL and plans the copy', () => {
		const snap = snapshot(
			['note.cover', 'file.name'],
			[
				{
					path: 'Films/Stalker.md',
					basename: 'Stalker',
					values: { 'note.cover': '![[stalker.png]]', 'file.name': 'Stalker' },
				},
			],
		);
		const result = resolveSnapshotAssets(
			[snap],
			fakeLocator({ 'Attachments/stalker.png': 1000 }),
		);

		const entry = result.snapshots[0].groups[0].entries[0];
		expect(entry.values['note.cover']).toBe('/assets/stalker.png');
		expect(result.snapshots[0].view.imageProperties).toEqual(['note.cover']);
		expect(result.snapshots[0].assets).toEqual([
			{ source: 'Attachments/stalker.png', url: '/assets/stalker.png' },
		]);
		expect(result.copyPlan).toEqual([
			{ source: 'Attachments/stalker.png', url: '/assets/stalker.png' },
		]);
		expect(result.warnings).toEqual([]);
	});

	it('leaves non-image values untouched and records no assets', () => {
		const snap = snapshot(
			['file.name', 'note.author'],
			[
				{
					path: 'Books/Dune.md',
					basename: 'Dune',
					values: { 'file.name': 'Dune', 'note.author': 'Frank Herbert' },
				},
			],
		);
		const result = resolveSnapshotAssets([snap], fakeLocator({}));

		expect(result.snapshots[0].groups[0].entries[0].values['note.author']).toBe(
			'Frank Herbert',
		);
		expect(result.snapshots[0].view.imageProperties).toBeUndefined();
		expect(result.snapshots[0].assets).toBeUndefined();
		expect(result.copyPlan).toEqual([]);
	});

	it('degrades a missing asset to the placeholder URL + a warning (not fatal)', () => {
		const snap = snapshot(
			['note.cover'],
			[
				{
					path: 'Films/Solaris.md',
					basename: 'Solaris',
					values: { 'note.cover': 'missing.png' },
				},
			],
		);
		const result = resolveSnapshotAssets([snap], fakeLocator({}));

		expect(result.snapshots[0].groups[0].entries[0].values['note.cover']).toBe(
			'/assets/_missing.svg',
		);
		// Missing assets are not copied and not in the manifest.
		expect(result.copyPlan).toEqual([]);
		expect(result.snapshots[0].assets).toBeUndefined();
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('not found');
		// Still flagged as an image property so the renderer emits the placeholder.
		expect(result.snapshots[0].view.imageProperties).toEqual(['note.cover']);
	});

	it('degrades an oversized asset to the placeholder when over maxSizeBytes', () => {
		const snap = snapshot(
			['note.cover'],
			[{ path: 'Films/Big.md', basename: 'Big', values: { 'note.cover': 'big.png' } }],
		);
		const result = resolveSnapshotAssets([snap], fakeLocator({ 'big.png': 5_000_000 }), {
			maxSizeBytes: 1_000_000,
		});

		expect(result.snapshots[0].groups[0].entries[0].values['note.cover']).toBe(
			'/assets/_missing.svg',
		);
		expect(result.copyPlan).toEqual([]);
		expect(result.warnings[0]).toContain('too large');
	});

	it('dedupes two references to the same vault file into one copy task', () => {
		const a = snapshot(
			['note.cover'],
			[
				{ path: 'A/1.md', basename: 'One', values: { 'note.cover': '![[shared.png]]' } },
				{
					path: 'A/2.md',
					basename: 'Two',
					values: { 'note.cover': 'Attachments/shared.png' },
				},
			],
		);
		// Both references resolve (via the cache) to the same concrete file, so
		// dedup keys on the located path — not the differing raw references.
		const result = resolveSnapshotAssets([a], fakeLocator({ 'Attachments/shared.png': 100 }));

		const entries = result.snapshots[0].groups[0].entries;
		expect(entries[0].values['note.cover']).toBe('/assets/shared.png');
		expect(entries[1].values['note.cover']).toBe('/assets/shared.png');
		expect(result.copyPlan).toEqual([
			{ source: 'Attachments/shared.png', url: '/assets/shared.png' },
		]);
		expect(result.snapshots[0].assets).toHaveLength(1);
	});

	it('disambiguates two distinct vault files that share a basename', () => {
		const a = snapshot(
			['note.cover'],
			[
				{ path: 'A/1.md', basename: 'One', values: { 'note.cover': 'Books/cover.png' } },
				{ path: 'A/2.md', basename: 'Two', values: { 'note.cover': 'Films/cover.png' } },
			],
		);
		const result = resolveSnapshotAssets(
			[a],
			fakeLocator({ 'Books/cover.png': 1, 'Films/cover.png': 1 }),
		);
		const entries = result.snapshots[0].groups[0].entries;
		expect(entries[0].values['note.cover']).toBe('/assets/cover.png');
		expect(entries[1].values['note.cover']).toBe('/assets/cover-1.png');
		expect(result.copyPlan).toHaveLength(2);
	});

	it('uses the located vault path (not the raw ref) as the copy source', () => {
		const snap = snapshot(
			['note.cover'],
			[
				{
					path: 'Films/Stalker.md',
					basename: 'Stalker',
					values: { 'note.cover': '![[poster.png]]' },
				},
			],
		);
		// The cache resolves the bare `poster.png` to a concrete subfolder path.
		const result = resolveSnapshotAssets([snap], fakeLocator({ 'Media/poster.png': 200 }));

		expect(result.copyPlan[0].source).toBe('Media/poster.png');
		expect(result.snapshots[0].assets?.[0].source).toBe('Media/poster.png');
	});

	it('treats a located-but-non-asset vault path as missing (placeholder)', () => {
		const snap = snapshot(
			['note.cover'],
			[{ path: 'x.md', basename: 'X', values: { 'note.cover': '![[cover.png]]' } }],
		);
		// A locator that returns a non-normalizable (empty) vault path — e.g. a
		// degenerate cache hit — has no copyable source and degrades gracefully.
		const result = resolveSnapshotAssets([snap], () => ({ vaultPath: '' }));
		expect(result.snapshots[0].groups[0].entries[0].values['note.cover']).toBe(
			'/assets/_missing.svg',
		);
		expect(result.copyPlan).toEqual([]);
		expect(result.warnings).toHaveLength(1);
	});

	it('does not flag an image property when nothing resolved for it', () => {
		// `isImageReference` is false for plain text, so the property stays text-only.
		const snap = snapshot(
			['note.cover'],
			[{ path: 'x.md', basename: 'X', values: { 'note.cover': 'not an image' } }],
		);
		const result = resolveSnapshotAssets([snap], fakeLocator({}));
		expect(result.snapshots[0].view.imageProperties).toBeUndefined();
		expect(result.warnings).toEqual([]);
	});
});
