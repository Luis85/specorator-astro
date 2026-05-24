import { describe, expect, it, vi } from 'vitest';
import { SyncSite } from '../../src/core/usecases/sync-site';
import type { BasesPort, Logger, SnapshotWriterPort, VaultPort } from '../../src/core/ports';
import type { ResolvedTarget, SiteConfig, ViewSnapshot } from '../../src/core/domain/types';

function snapshotFor(target: ResolvedTarget): ViewSnapshot {
	return {
		baseId: target.basePath,
		source: { kind: 'file', path: target.basePath },
		view: { type: 'table', name: target.viewName, order: [] },
		render: { component: target.component, layout: target.layout },
		groups: [],
		generatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('SyncSite', () => {
	it('clears, then harvests and writes one snapshot per planned target', async () => {
		const config: SiteConfig = {
			includes: [
				{ basePath: 'Books/books.base', viewName: 'Cards' },
				{ basePath: 'Projects/projects.base', viewName: 'Table' },
			],
		};
		const written: ViewSnapshot[] = [];
		const clear = vi.fn(async () => {});
		const harvest = vi.fn(async (t: ResolvedTarget) => snapshotFor(t));
		const vault: VaultPort = { readSiteConfig: async () => config };
		const bases: BasesPort = { harvest };
		const writer: SnapshotWriterPort = {
			write: async (snapshot) => {
				written.push(snapshot);
			},
			clear,
		};
		const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

		const result = await new SyncSite(vault, bases, writer, logger).run();

		expect(clear).toHaveBeenCalledOnce();
		expect(harvest).toHaveBeenCalledTimes(2);
		expect(result.written).toBe(2);
		expect(written.map((s) => s.baseId)).toEqual([
			'Books/books.base',
			'Projects/projects.base',
		]);
	});

	it('forwards plan warnings to the logger and writes nothing', async () => {
		const warn = vi.fn();
		const vault: VaultPort = { readSiteConfig: async () => ({ includes: [] }) };
		const bases: BasesPort = { harvest: vi.fn() };
		const writer: SnapshotWriterPort = { write: vi.fn(), clear: vi.fn() };
		const logger: Logger = { info: vi.fn(), warn, error: vi.fn() };

		const result = await new SyncSite(vault, bases, writer, logger).run();

		expect(result.written).toBe(0);
		expect(warn).toHaveBeenCalledOnce();
	});
});
