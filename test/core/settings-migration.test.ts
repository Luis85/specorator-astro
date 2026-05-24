import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DEV_PORT,
	DEFAULT_LIVE_RESYNC,
	SETTINGS_SCHEMA_VERSION,
	defaultSettings,
	migrate,
} from '../../src/core/domain/settings-migration';

describe('settings migration', () => {
	it('returns safe defaults for junk / nothing persisted', () => {
		expect(migrate(null)).toEqual(defaultSettings());
		expect(migrate(undefined)).toEqual(defaultSettings());
		expect(migrate('garbage')).toEqual(defaultSettings());
		expect(migrate(42)).toEqual(defaultSettings());
		expect(migrate([])).toEqual(defaultSettings());
	});

	it('defaults: version, empty includes, port 4321, no overrides, live-resync off', () => {
		expect(defaultSettings()).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
		});
		// Live re-sync ships off (opt-in), per FR-20 / D2.
		expect(DEFAULT_LIVE_RESYNC).toBe(false);
	});

	it('upgrades the original un-versioned { site } shape, defaulting new fields', () => {
		const old = {
			site: {
				siteUrl: 'https://example.com',
				includes: [{ basePath: 'Books/books.base', viewName: 'Reading' }],
			},
		};
		expect(migrate(old)).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: {
				siteUrl: 'https://example.com',
				includes: [{ basePath: 'Books/books.base', viewName: 'Reading' }],
			},
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
		});
	});

	it('defaults sync.liveResync for pre-existing v1 data that lacks it (migration-safe)', () => {
		const v1WithoutSync = {
			version: 1,
			site: { includes: [{ basePath: 'a.base', viewName: 'v' }] },
			toolchain: { port: 4321 },
		};
		expect(migrate(v1WithoutSync).sync).toEqual({ liveResync: DEFAULT_LIVE_RESYNC });
	});

	it('preserves a persisted live-resync toggle', () => {
		expect(migrate({ sync: { liveResync: true } }).sync).toEqual({ liveResync: true });
		expect(migrate({ sync: { liveResync: false } }).sync).toEqual({ liveResync: false });
	});

	it('defaults a malformed sync block back to the safe default', () => {
		expect(migrate({ sync: 'nope' }).sync).toEqual({ liveResync: DEFAULT_LIVE_RESYNC });
		expect(migrate({ sync: { liveResync: 'yes' } }).sync).toEqual({
			liveResync: DEFAULT_LIVE_RESYNC,
		});
	});

	it('preserves persisted toolchain config and trims path overrides', () => {
		const persisted = {
			version: 1,
			site: { includes: [] },
			toolchain: {
				port: 5000,
				nodePath: '  /usr/local/bin/node  ',
				astroBinPath: '/opt/astro/bin/astro',
			},
		};
		expect(migrate(persisted)).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: {
				port: 5000,
				nodePath: '/usr/local/bin/node',
				astroBinPath: '/opt/astro/bin/astro',
			},
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
		});
	});

	it('drops malformed toolchain values back to a safe default port', () => {
		expect(migrate({ toolchain: { port: 'nope', nodePath: 42, astroBinPath: '' } })).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
		});
		expect(migrate({ toolchain: { port: -1 } }).toolchain.port).toBe(DEFAULT_DEV_PORT);
		expect(migrate({ toolchain: { port: 4321.5 } }).toolchain.port).toBe(DEFAULT_DEV_PORT);
	});

	it('drops malformed includes and keeps optional fields only when non-empty', () => {
		const persisted = {
			site: {
				includes: [
					{
						basePath: 'a.base',
						viewName: 'v',
						route: '/a',
						component: 'cards',
						layout: '',
					},
					{ basePath: 'b.base' },
					null,
					42,
				],
			},
		};
		expect(migrate(persisted).site.includes).toEqual([
			{ basePath: 'a.base', viewName: 'v', route: '/a', component: 'cards' },
		]);
	});

	it('is idempotent: migrating an already-current document is a no-op', () => {
		const once = migrate({
			site: { siteUrl: 'https://x.test', includes: [{ basePath: 'a.base', viewName: 'v' }] },
			toolchain: { port: 4322, nodePath: '/n' },
		});
		expect(migrate(once)).toEqual(once);
	});
});
