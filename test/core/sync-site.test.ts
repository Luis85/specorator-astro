import { describe, expect, it, vi } from 'vitest';
import { SyncSite } from '../../src/core/usecases/sync-site';
import type { BasesPort, SettingsPort, SnapshotWriterPort } from '../../src/core/ports';
import type { ResolvedTarget, SiteConfig, ViewSnapshot } from '../../src/core/domain/types';

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

		const result = await new SyncSite(settings, bases, writer).run();

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

		const result = await new SyncSite(settings, bases, writer).run();

		expect(commit).toHaveBeenCalledWith([]);
		expect(result.written).toBe(0);
		expect(result.warnings).toHaveLength(1);
	});
});
