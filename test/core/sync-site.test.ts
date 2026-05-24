import { describe, expect, it, vi } from 'vitest';
import { SyncSite } from '../../src/core/usecases/sync-site';
import { UserFacingError } from '../../src/core/domain/errors';
import type {
	AssetSourcePort,
	BasesPort,
	CorePluginsPort,
	SettingsPort,
	SnapshotWriterPort,
} from '../../src/core/ports';
import type { ResolvedTarget, SiteConfig, ViewSnapshot } from '../../src/core/domain/types';

function corePluginsFake(basesEnabled = true): CorePluginsPort {
	return {
		isBasesEnabled: () => basesEnabled,
		isWebViewerEnabled: () => true,
	};
}

function snapshotFor(target: ResolvedTarget): ViewSnapshot {
	return {
		baseId: target.basePath,
		route: target.route,
		source: { kind: 'file', path: target.basePath },
		view: { type: 'table', name: target.viewName, order: [] },
		render: { component: target.component, layout: target.layout },
		groups: [],
		generatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('SyncSite', () => {
	it('harvests every planned target and commits them as one set', async () => {
		const config: SiteConfig = {
			includes: [
				{ basePath: 'Books/books.base', viewName: 'Cards' },
				{ basePath: 'Projects/projects.base', viewName: 'Table' },
			],
		};
		const committed: ViewSnapshot[][] = [];
		const harvest = vi.fn(async (t: ResolvedTarget) => snapshotFor(t));
		const settings: SettingsPort = { readSiteConfig: async () => config };
		const bases: BasesPort = { harvest };
		const writer: SnapshotWriterPort = {
			commit: async (snapshots) => {
				committed.push(snapshots);
			},
		};

		const result = await new SyncSite(settings, bases, writer, corePluginsFake()).run();

		expect(harvest).toHaveBeenCalledTimes(2);
		expect(committed).toHaveLength(1);
		expect(committed[0].map((s) => s.baseId)).toEqual([
			'Books/books.base',
			'Projects/projects.base',
		]);
		expect(result.written).toBe(2);
		expect(result.warnings).toHaveLength(0);
	});

	it('returns plan warnings and commits an empty set when nothing is published', async () => {
		const commit = vi.fn(async () => {});
		const settings: SettingsPort = { readSiteConfig: async () => ({ includes: [] }) };
		const bases: BasesPort = { harvest: vi.fn() };
		const writer: SnapshotWriterPort = { commit };

		const result = await new SyncSite(settings, bases, writer, corePluginsFake()).run();

		expect(commit).toHaveBeenCalledWith([]);
		expect(result.written).toBe(0);
		expect(result.warnings).toHaveLength(1);
	});

	it('runs the asset pipeline: rewrites image values, copies the plan, commits (FR-16)', async () => {
		const config: SiteConfig = {
			includes: [{ basePath: 'Films/films.base', viewName: 'Cards' }],
		};
		const harvested: ViewSnapshot = {
			baseId: 'films',
			route: '/films',
			source: { kind: 'file', path: 'Films/films.base' },
			view: { type: 'cards', name: 'Cards', order: ['note.cover', 'file.name'] },
			render: { component: 'auto', layout: 'auto' },
			groups: [
				{
					key: null,
					entries: [
						{
							path: 'Films/Stalker.md',
							basename: 'Stalker',
							route: '/films/stalker',
							values: { 'note.cover': '![[stalker.png]]', 'file.name': 'Stalker' },
						},
					],
				},
			],
			generatedAt: '2026-01-01T00:00:00.000Z',
		};

		const committed: ViewSnapshot[][] = [];
		const settings: SettingsPort = { readSiteConfig: async () => config };
		const bases: BasesPort = { harvest: async () => harvested };
		const writer: SnapshotWriterPort = {
			commit: async (snapshots) => {
				committed.push(snapshots);
			},
		};
		const copied: { source: string; url: string }[] = [];
		const assets: AssetSourcePort = {
			locate: (ref) =>
				ref.includes('stalker.png')
					? { vaultPath: 'Attachments/stalker.png', sizeBytes: 10 }
					: null,
			copyAll: async (tasks) => {
				copied.push(...tasks);
				return { warnings: [] };
			},
		};

		const result = await new SyncSite(settings, bases, writer, corePluginsFake(), assets).run();

		// The committed snapshot carries the rewritten public URL + manifest.
		const entry = committed[0][0].groups[0].entries[0];
		expect(entry.values['note.cover']).toBe('/assets/stalker.png');
		expect(committed[0][0].assets).toEqual([
			{ source: 'Attachments/stalker.png', url: '/assets/stalker.png' },
		]);
		// The copier received the deduped copy plan.
		expect(copied).toEqual([{ source: 'Attachments/stalker.png', url: '/assets/stalker.png' }]);
		expect(result.written).toBe(1);
	});

	it('surfaces asset copier warnings without failing the sync', async () => {
		const config: SiteConfig = {
			includes: [{ basePath: 'Films/films.base', viewName: 'Cards' }],
		};
		const settings: SettingsPort = { readSiteConfig: async () => config };
		const bases: BasesPort = {
			harvest: async (t) => snapshotFor(t),
		};
		const writer: SnapshotWriterPort = { commit: async () => {} };
		const assets: AssetSourcePort = {
			locate: () => null,
			copyAll: async () => ({ warnings: ['copy failed for foo.png'] }),
		};

		const result = await new SyncSite(settings, bases, writer, corePluginsFake(), assets).run();

		expect(result.warnings).toContain('copy failed for foo.png');
		expect(result.written).toBe(1);
	});

	it('refuses with a clear error and harvests nothing when Bases is disabled (FR-10)', async () => {
		const harvest = vi.fn();
		const commit = vi.fn();
		const settings: SettingsPort = {
			readSiteConfig: vi.fn(async () => ({ includes: [] })),
		};
		const bases: BasesPort = { harvest };
		const writer: SnapshotWriterPort = { commit };

		const sync = new SyncSite(settings, bases, writer, corePluginsFake(false));

		await expect(sync.run()).rejects.toBeInstanceOf(UserFacingError);
		await expect(sync.run()).rejects.toThrow(/Bases core plugin is disabled/);
		// Guard short-circuits before any read/harvest/commit.
		expect(harvest).not.toHaveBeenCalled();
		expect(commit).not.toHaveBeenCalled();
	});
});
