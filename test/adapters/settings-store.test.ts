import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { SettingsStore } from '../../src/adapters/settings-store';
import {
	DEFAULT_DEV_PORT,
	DEFAULT_LIVE_RESYNC,
	SETTINGS_SCHEMA_VERSION,
} from '../../src/core/domain/settings-migration';

function makePlugin(initial: unknown = null) {
	let stored = initial;
	const loadData = vi.fn(() => Promise.resolve(stored));
	const saveData = vi.fn((data: unknown) => {
		stored = data;
		return Promise.resolve();
	});
	const plugin = { loadData, saveData } as unknown as Plugin;
	return { plugin, loadData, saveData };
}

describe('SettingsStore', () => {
	it('defaults to an empty config when nothing is persisted', async () => {
		const { plugin } = makePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		expect(await store.readSiteConfig()).toEqual({ includes: [] });
	});

	it('forward-migrates the un-versioned { site } shape on load (NFR-8)', async () => {
		const { plugin } = makePlugin({
			site: {
				siteUrl: 'https://example.com',
				includes: [{ basePath: 'a.base', viewName: 'v' }],
			},
		});
		const store = new SettingsStore(plugin);
		await store.load();
		expect(store.current()).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: {
				siteUrl: 'https://example.com',
				includes: [{ basePath: 'a.base', viewName: 'v' }],
			},
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
		});
	});

	it('round-trips a valid persisted config', async () => {
		const { plugin } = makePlugin({
			site: {
				siteUrl: 'https://example.com',
				includes: [{ basePath: 'a.base', viewName: 'v' }],
			},
		});
		const store = new SettingsStore(plugin);
		await store.load();
		expect(await store.readSiteConfig()).toEqual({
			siteUrl: 'https://example.com',
			includes: [{ basePath: 'a.base', viewName: 'v' }],
		});
	});

	it('coerces a malformed includes value to an empty array', async () => {
		const { plugin } = makePlugin({ site: { includes: 'not-an-array' } });
		const store = new SettingsStore(plugin);
		await store.load();
		expect((await store.readSiteConfig()).includes).toEqual([]);
	});

	it('drops entries missing required fields', async () => {
		const { plugin } = makePlugin({
			site: {
				includes: [{ basePath: 'a.base', viewName: 'v' }, { basePath: 'b.base' }, null, 42],
			},
		});
		const store = new SettingsStore(plugin);
		await store.load();
		expect((await store.readSiteConfig()).includes).toEqual([
			{ basePath: 'a.base', viewName: 'v' },
		]);
	});

	it('exposes the toolchain config, defaulting the dev port', async () => {
		const { plugin } = makePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		expect(store.readToolchainConfig()).toEqual({ port: DEFAULT_DEV_PORT });
	});

	it('reads a persisted toolchain override', async () => {
		const { plugin } = makePlugin({
			site: { includes: [] },
			toolchain: { port: 5000, astroBinPath: '/opt/astro/bin/astro' },
		});
		const store = new SettingsStore(plugin);
		await store.load();
		expect(store.readToolchainConfig()).toEqual({
			port: 5000,
			astroBinPath: '/opt/astro/bin/astro',
		});
	});

	it('exposes the sync config, defaulting live-resync off', async () => {
		const { plugin } = makePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		expect(store.readSyncConfig()).toEqual({ liveResync: DEFAULT_LIVE_RESYNC });
	});

	it('reads a persisted live-resync toggle', async () => {
		const { plugin } = makePlugin({ site: { includes: [] }, sync: { liveResync: true } });
		const store = new SettingsStore(plugin);
		await store.load();
		expect(store.readSyncConfig()).toEqual({ liveResync: true });
	});

	it('persists edits to the in-memory config', async () => {
		const { plugin, saveData } = makePlugin(null);
		const store = new SettingsStore(plugin);
		await store.load();
		store.edit((settings) => {
			settings.site.includes.push({ basePath: 'a.base', viewName: 'v' });
		});
		expect(saveData).toHaveBeenCalledOnce();
		expect((await store.readSiteConfig()).includes).toHaveLength(1);
	});
});
