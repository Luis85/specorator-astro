import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { SettingsStore } from '../../src/adapters/settings-store';

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
