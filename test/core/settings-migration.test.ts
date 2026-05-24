import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DEV_PORT,
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

	it('defaults: version, empty includes, port 4321, no overrides', () => {
		expect(defaultSettings()).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
		});
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
		});
	});

	it('drops malformed toolchain values back to a safe default port', () => {
		expect(migrate({ toolchain: { port: 'nope', nodePath: 42, astroBinPath: '' } })).toEqual({
			version: SETTINGS_SCHEMA_VERSION,
			site: { includes: [] },
			toolchain: { port: DEFAULT_DEV_PORT },
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
