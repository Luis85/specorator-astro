import { describe, expect, it, vi } from 'vitest';
import { BuildSite } from '../../src/core/usecases/build-site';
import { SyncSite } from '../../src/core/usecases/sync-site';
import { UserFacingError } from '../../src/core/domain/errors';
import type {
	AstroProcessPort,
	BasesPort,
	CorePluginsPort,
	ProjectBootstrapPort,
	SettingsPort,
	SnapshotWriterPort,
} from '../../src/core/ports';

function corePluginsFake(state: { bases?: boolean; webViewer?: boolean } = {}): CorePluginsPort {
	return {
		isBasesEnabled: () => state.bases ?? true,
		isWebViewerEnabled: () => state.webViewer ?? true,
	};
}

/** A real `SyncSite` over fakes that records each `run()` into the shared order. */
function syncFake(
	order: string[],
	result = { written: 2, pages: 0, warnings: ['stale cover'] },
): SyncSite {
	const settings: SettingsPort = { readSiteConfig: async () => ({ includes: [] }) };
	const bases: BasesPort = { harvest: vi.fn() };
	const writer: SnapshotWriterPort = { commit: vi.fn(async () => {}) };
	const sync = new SyncSite(settings, bases, writer, corePluginsFake());
	vi.spyOn(sync, 'run').mockImplementation(async () => {
		order.push('sync');
		return result;
	});
	return sync;
}

/** Wire a `BuildSite` over fakes, recording the call order across ports. */
function buildBuild(
	overrides: {
		core?: CorePluginsPort;
		astro?: AstroProcessPort;
		sync?: SyncSite;
		order?: string[];
	} = {},
): { build: BuildSite; order: string[] } {
	const order = overrides.order ?? [];
	const bootstrap: ProjectBootstrapPort = {
		ensureProject: vi.fn(async () => {
			order.push('ensureProject');
			return { projectDir: '/p' };
		}),
	};
	const astro: AstroProcessPort = overrides.astro ?? {
		startDev: vi.fn(),
		build: vi.fn(async () => {
			order.push('build');
		}),
		stop: vi.fn(),
	};
	const build = new BuildSite(
		bootstrap,
		overrides.core ?? corePluginsFake(),
		overrides.sync ?? syncFake(order),
		astro,
	);
	return { build, order };
}

describe('BuildSite', () => {
	it('runs ensureProject → sync → build in order (auto-sync before build)', async () => {
		const { build, order } = buildBuild();

		await build.run();

		expect(order).toEqual(['ensureProject', 'sync', 'build']);
	});

	it('returns the pre-build sync result (count + warnings) for the root to surface', async () => {
		const order: string[] = [];
		const { build } = buildBuild({
			order,
			sync: syncFake(order, { written: 3, pages: 0, warnings: ['missing asset'] }),
		});

		const result = await build.run();

		expect(result).toEqual({ written: 3, warnings: ['missing asset'] });
	});

	it('re-syncs on every build (no session latch, unlike preview)', async () => {
		const order: string[] = [];
		const { build } = buildBuild({ order, sync: syncFake(order) });

		await build.run();
		await build.run();

		// Two builds → two syncs and two astro builds.
		expect(order.filter((step) => step === 'sync')).toHaveLength(2);
		expect(order.filter((step) => step === 'build')).toHaveLength(2);
	});

	it('refuses with a clear error when Bases is disabled (needed for the harvest)', async () => {
		const { build, order } = buildBuild({ core: corePluginsFake({ bases: false }) });

		await expect(build.run()).rejects.toBeInstanceOf(UserFacingError);
		await expect(
			buildBuild({ core: corePluginsFake({ bases: false }) }).build.run(),
		).rejects.toThrow(/Bases core plugin is disabled/);
		// Guarded before any project/sync/build work happens.
		expect(order).toEqual([]);
	});

	it('builds even when the Web Viewer is disabled (build never previews)', async () => {
		const { build, order } = buildBuild({ core: corePluginsFake({ webViewer: false }) });

		await build.run();

		expect(order).toEqual(['ensureProject', 'sync', 'build']);
	});

	it('propagates a build failure (the adapter rejects on a non-zero exit, FR-6)', async () => {
		const order: string[] = [];
		const { build } = buildBuild({
			order,
			sync: syncFake(order),
			astro: {
				startDev: vi.fn(),
				build: vi.fn(async () => {
					order.push('build');
					throw new Error('Astro build failed (exit code 1).');
				}),
				stop: vi.fn(),
			},
		});

		await expect(build.run()).rejects.toThrow(/Astro build failed/);
		// Ensure + sync still ran first, so the failure is purely the build step.
		expect(order).toEqual(['ensureProject', 'sync', 'build']);
	});

	it('does not build when the pre-build sync fails (sync-before-build ordering)', async () => {
		const order: string[] = [];
		const sync = syncFake(order);
		vi.spyOn(sync, 'run').mockImplementation(async () => {
			order.push('sync');
			throw new Error('harvest exploded');
		});
		const astroBuild = vi.fn(async () => {
			order.push('build');
		});
		const { build } = buildBuild({
			order,
			sync,
			astro: { startDev: vi.fn(), build: astroBuild, stop: vi.fn() },
		});

		await expect(build.run()).rejects.toThrow('harvest exploded');
		expect(astroBuild).not.toHaveBeenCalled();
		expect(order).toEqual(['ensureProject', 'sync']);
	});
});
