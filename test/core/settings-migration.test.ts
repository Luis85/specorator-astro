import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DEV_PORT,
	DEFAULT_LIBRARY_FOLDER,
	DEFAULT_LIVE_RESYNC,
	DEFAULT_PAGES_FOLDER,
	SETTINGS_SCHEMA_VERSION,
	defaultSettings,
	migrate,
} from '../../src/core/domain/settings-migration';

/** The migration-safe default library block (folder set, consent NOT granted). */
const DEFAULT_LIBRARY = { folder: DEFAULT_LIBRARY_FOLDER, consent: { granted: false } };

/** The migration-safe default pages block (folder set). */
const DEFAULT_PAGES = { folder: DEFAULT_PAGES_FOLDER };

describe('settings migration', () => {
	it('returns safe defaults for junk / nothing persisted', () => {
		expect(migrate(null)).toEqual(defaultSettings());
		expect(migrate(undefined)).toEqual(defaultSettings());
		expect(migrate('garbage')).toEqual(defaultSettings());
		expect(migrate(42)).toEqual(defaultSettings());
		expect(migrate([])).toEqual(defaultSettings());
	});

	it('defaults: version, empty includes, port 4321, no overrides, live-resync off, no export path', () => {
		expect(defaultSettings()).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
			export: {},
			library: DEFAULT_LIBRARY,
			pages: DEFAULT_PAGES,
		});
		// Live re-sync ships off (opt-in), per FR-20 / D2.
		expect(DEFAULT_LIVE_RESYNC).toBe(false);
		// Component library: configurable folder set, consent NOT granted (FR-11f/18).
		expect(DEFAULT_LIBRARY_FOLDER).toBe('Site/components');
		expect(defaultSettings().library.consent.granted).toBe(false);
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
			export: {},
			library: DEFAULT_LIBRARY,
			pages: DEFAULT_PAGES,
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
			export: {},
			library: DEFAULT_LIBRARY,
			pages: DEFAULT_PAGES,
		});
	});

	it('drops malformed toolchain values back to a safe default port', () => {
		expect(migrate({ toolchain: { port: 'nope', nodePath: 42, astroBinPath: '' } })).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
			sync: { liveResync: DEFAULT_LIVE_RESYNC },
			export: {},
			library: DEFAULT_LIBRARY,
			pages: DEFAULT_PAGES,
		});
		expect(migrate({ toolchain: { port: -1 } }).toolchain.port).toBe(DEFAULT_DEV_PORT);
		expect(migrate({ toolchain: { port: 4321.5 } }).toolchain.port).toBe(DEFAULT_DEV_PORT);
	});

	it('defaults export config for pre-existing data that lacks it (migration-safe)', () => {
		const withoutExport = {
			version: 1,
			site: { includes: [] },
			toolchain: { port: 4321 },
			sync: { liveResync: false },
		};
		expect(migrate(withoutExport).export).toEqual({});
	});

	it('preserves and trims a persisted export path', () => {
		expect(migrate({ export: { exportPath: '  /Users/me/site  ' } }).export).toEqual({
			exportPath: '/Users/me/site',
		});
	});

	it('drops a malformed or empty export path back to no destination', () => {
		expect(migrate({ export: 'nope' }).export).toEqual({});
		expect(migrate({ export: { exportPath: '' } }).export).toEqual({});
		expect(migrate({ export: { exportPath: '   ' } }).export).toEqual({});
		expect(migrate({ export: { exportPath: 42 } }).export).toEqual({});
	});

	it('defaults the library block (folder set, consent NOT granted) for old data (migration-safe)', () => {
		const v1WithoutLibrary = {
			version: 1,
			site: { includes: [] },
			toolchain: { port: 4321 },
			sync: { liveResync: false },
			export: {},
		};
		expect(migrate(v1WithoutLibrary).library).toEqual(DEFAULT_LIBRARY);
		// FR-18: consent is fail-closed by default — no schema bump needed, just filled in.
		expect(migrate(v1WithoutLibrary).library.consent.granted).toBe(false);
	});

	it('preserves a configured library folder and a granted consent with provenance', () => {
		const persisted = {
			library: {
				folder: '  Components  ',
				consent: {
					granted: true,
					grantedVersion: 2,
					grantedAt: '2026-05-25T00:00:00.000Z',
				},
			},
		};
		expect(migrate(persisted).library).toEqual({
			folder: 'Components',
			consent: { granted: true, grantedVersion: 2, grantedAt: '2026-05-25T00:00:00.000Z' },
		});
	});

	it('FAIL-CLOSED: never reads a non-true granted flag as consent (FR-18 security)', () => {
		// A truthy non-boolean, a string, a number, junk — none authorize execution.
		expect(migrate({ library: { consent: { granted: 'yes' } } }).library.consent).toEqual({
			granted: false,
		});
		expect(migrate({ library: { consent: { granted: 1 } } }).library.consent.granted).toBe(
			false,
		);
		expect(migrate({ library: { consent: 'nope' } }).library.consent.granted).toBe(false);
		expect(migrate({ library: 'nope' }).library).toEqual(DEFAULT_LIBRARY);
	});

	it('drops malformed provenance but keeps a valid grant', () => {
		const r = migrate({
			library: { consent: { granted: true, grantedVersion: 'x', grantedAt: 42 } },
		});
		expect(r.library.consent).toEqual({ granted: true });
	});

	it('defaults a blank library folder back to the standard authoring layout', () => {
		expect(migrate({ library: { folder: '   ' } }).library.folder).toBe(DEFAULT_LIBRARY_FOLDER);
		expect(migrate({ library: { folder: 42 } }).library.folder).toBe(DEFAULT_LIBRARY_FOLDER);
	});

	it('defaults the pages folder for old data lacking it (migration-safe, FR-12)', () => {
		const v1WithoutPages = {
			version: 1,
			site: { includes: [] },
			toolchain: { port: 4321 },
			sync: { liveResync: false },
			export: {},
			library: DEFAULT_LIBRARY,
		};
		expect(migrate(v1WithoutPages).pages).toEqual(DEFAULT_PAGES);
	});

	it('preserves and trims a configured pages folder', () => {
		expect(migrate({ pages: { folder: '  Website/pages  ' } }).pages.folder).toBe(
			'Website/pages',
		);
	});

	it('defaults a blank/malformed pages folder back to the standard authoring layout', () => {
		expect(migrate({ pages: { folder: '   ' } }).pages.folder).toBe(DEFAULT_PAGES_FOLDER);
		expect(migrate({ pages: { folder: 42 } }).pages.folder).toBe(DEFAULT_PAGES_FOLDER);
		expect(migrate({ pages: 'nope' }).pages).toEqual(DEFAULT_PAGES);
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
