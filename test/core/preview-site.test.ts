import { describe, expect, it, vi } from 'vitest';
import { PreviewSite } from '../../src/core/usecases/preview-site';
import { SyncSite } from '../../src/core/usecases/sync-site';
import { UserFacingError } from '../../src/core/domain/errors';
import type {
	AstroProcessPort,
	BasesPort,
	CorePluginsPort,
	ProjectBootstrapPort,
	SettingsPort,
	SnapshotWriterPort,
	WebViewerPort,
} from '../../src/core/ports';

function corePluginsFake(state: { bases?: boolean; webViewer?: boolean } = {}): CorePluginsPort {
	return {
		isBasesEnabled: () => state.bases ?? true,
		isWebViewerEnabled: () => state.webViewer ?? true,
	};
}

/** A real `SyncSite` over fakes that records each `run()` into the shared order. */
function syncFake(order: string[]): SyncSite {
	const settings: SettingsPort = { readSiteConfig: async () => ({ includes: [] }) };
	const bases: BasesPort = { harvest: vi.fn() };
	const writer: SnapshotWriterPort = { commit: vi.fn(async () => {}) };
	const sync = new SyncSite(settings, bases, writer, corePluginsFake());
	vi.spyOn(sync, 'run').mockImplementation(async () => {
		order.push('sync');
		return { written: 0, pages: 0, warnings: [] };
	});
	return sync;
}

/** Wire a `PreviewSite` over fakes, recording the call order across ports. */
function buildPreview(overrides: { core?: CorePluginsPort; astro?: AstroProcessPort } = {}): {
	preview: PreviewSite;
	order: string[];
} {
	const order: string[] = [];
	const bootstrap: ProjectBootstrapPort = {
		ensureProject: vi.fn(async () => {
			order.push('ensureProject');
			return { projectDir: '/p' };
		}),
	};
	const astro: AstroProcessPort = overrides.astro ?? {
		startDev: vi.fn(async () => {
			order.push('startDev');
			return { url: 'http://localhost:4321' };
		}),
		build: vi.fn(),
		stop: vi.fn(),
	};
	const webViewer: WebViewerPort = {
		open: vi.fn(async () => {
			order.push('open');
		}),
	};
	const preview = new PreviewSite(
		bootstrap,
		overrides.core ?? corePluginsFake(),
		syncFake(order),
		astro,
		webViewer,
	);
	return { preview, order };
}

describe('PreviewSite', () => {
	it('runs ensureProject → sync → startDev → open in order on the first preview', async () => {
		const { preview, order } = buildPreview();

		const result = await preview.run();

		expect(order).toEqual(['ensureProject', 'sync', 'startDev', 'open']);
		expect(result.url).toBe('http://localhost:4321');
	});

	it('auto-syncs on the first preview but not on the second (per session)', async () => {
		const { preview, order } = buildPreview();

		await preview.run();
		await preview.run();

		// Two previews, but only ONE sync (auto-sync latches after the first).
		expect(order.filter((step) => step === 'sync')).toHaveLength(1);
		expect(order.filter((step) => step === 'startDev')).toHaveLength(2);
		expect(order.filter((step) => step === 'open')).toHaveLength(2);
	});

	it('opens the Web Viewer at the URL the dev server reports', async () => {
		const { preview } = buildPreview({
			astro: {
				startDev: vi.fn(async () => ({ url: 'http://localhost:5000' })),
				build: vi.fn(),
				stop: vi.fn(),
			},
		});

		const result = await preview.run();
		expect(result.url).toBe('http://localhost:5000');
	});

	it('refuses with a clear error when the Web Viewer plugin is disabled (FR-10)', async () => {
		const disabled = buildPreview({ core: corePluginsFake({ webViewer: false }) });
		await expect(disabled.preview.run()).rejects.toBeInstanceOf(UserFacingError);
		expect(disabled.order).toEqual([]);

		const again = buildPreview({ core: corePluginsFake({ webViewer: false }) });
		await expect(again.preview.run()).rejects.toThrow(/Web Viewer core plugin is disabled/);
	});

	it('refuses when Bases is disabled (preview needs it for the auto-sync harvest)', async () => {
		const { preview, order } = buildPreview({ core: corePluginsFake({ bases: false }) });

		await expect(preview.run()).rejects.toThrow(/Bases core plugin is disabled/);
		expect(order).toEqual([]);
	});

	it('coalesces concurrent run() calls onto one in-flight run (no double-spawn, FIX 1)', async () => {
		const order: string[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const startDev = vi.fn(async () => {
			order.push('startDev');
			await gate; // hold the first run() open so a second can race in.
			return { url: 'http://localhost:4321' };
		});
		const bootstrap: ProjectBootstrapPort = {
			ensureProject: vi.fn(async () => ({ projectDir: '/p' })),
		};
		const webViewer: WebViewerPort = { open: vi.fn(async () => {}) };
		const preview = new PreviewSite(
			bootstrap,
			corePluginsFake(),
			syncFake(order),
			{ startDev, build: vi.fn(), stop: vi.fn() },
			webViewer,
		);

		// Two overlapping invocations (e.g. a double-clicked command).
		const first = preview.run();
		const second = preview.run();
		release();
		const [a, b] = await Promise.all([first, second]);

		// Both callers got the same result, but the dev server was started ONCE.
		expect(a).toEqual(b);
		expect(startDev).toHaveBeenCalledTimes(1);
		expect(order.filter((s) => s === 'startDev')).toHaveLength(1);

		// After the in-flight run settles, the latch is cleared so a later preview
		// can start again (it skips the per-session auto-sync, but does start dev).
		await preview.run();
		expect(startDev).toHaveBeenCalledTimes(2);
	});

	it('propagates a dev-server failure without opening the preview', async () => {
		const { preview, order } = buildPreview({
			astro: {
				startDev: vi.fn(async () => {
					throw new Error('port in use');
				}),
				build: vi.fn(),
				stop: vi.fn(),
			},
		});

		await expect(preview.run()).rejects.toThrow('port in use');
		expect(order).not.toContain('open');
	});
});
