import { describe, expect, it } from 'vitest';
import {
	deriveRoute,
	joinRoute,
	normalizeRoute,
	planSync,
	slugify,
	slugifyRoute,
	slugifySegment,
} from '../../src/core/domain/routing';
import type { SiteConfig } from '../../src/core/domain/types';

describe('slugifySegment', () => {
	it('slugifies a basename for a single route segment', () => {
		expect(slugifySegment('The Left Hand of Darkness')).toBe('the-left-hand-of-darkness');
	});

	it('falls back to "entry" for a basename that slugifies away', () => {
		expect(slugifySegment('!!!')).toBe('entry');
		expect(slugifySegment('')).toBe('entry');
	});
});

describe('normalizeRoute', () => {
	it('adds a single leading slash and strips a trailing slash', () => {
		expect(normalizeRoute('books/')).toBe('/books');
		expect(normalizeRoute('/books')).toBe('/books');
	});

	it('collapses interior // runs so a route compares equal everywhere (FR-15)', () => {
		expect(normalizeRoute('a//b')).toBe('/a/b');
		expect(normalizeRoute('/a///b/')).toBe('/a/b');
	});

	it('maps a blank/root route to "/"', () => {
		expect(normalizeRoute('')).toBe('/');
		expect(normalizeRoute('/')).toBe('/');
		expect(normalizeRoute('   ')).toBe('/');
	});
});

describe('slugifyRoute', () => {
	it('slugifies each segment of an explicit multi-segment route', () => {
		expect(slugifyRoute('Classics/The Dune Saga/')).toBe('/classics/the-dune-saga');
	});

	it('makes a slug with a ) safe so it cannot close a markdown link early (FR-15)', () => {
		expect(slugifyRoute('foo)bar baz')).toBe('/foo-bar-baz');
	});

	it('strips a space, #, ?, and unicode out of an explicit slug (FR-15)', () => {
		expect(slugifyRoute('foo bar')).toBe('/foo-bar');
		expect(slugifyRoute('foo#frag')).toBe('/foo-frag');
		expect(slugifyRoute('foo?q=1')).toBe('/foo-q-1');
		expect(slugifyRoute('Über/Café')).toBe('/ber/caf');
	});

	it('collapses an interior // and keeps a single leading slash', () => {
		expect(slugifyRoute('a//b')).toBe('/a/b');
	});

	it('maps a root/empty route to "/"', () => {
		expect(slugifyRoute('/')).toBe('/');
		expect(slugifyRoute('')).toBe('/');
		expect(slugifyRoute('!!!')).toBe('/entry');
	});
});

describe('joinRoute', () => {
	it('joins a parent route with a child segment', () => {
		expect(joinRoute('/books', 'dune')).toBe('/books/dune');
	});

	it('treats an empty or root parent as the site root', () => {
		expect(joinRoute('', 'dune')).toBe('/dune');
		expect(joinRoute('/', 'dune')).toBe('/dune');
	});

	it('strips a trailing slash on the parent before joining', () => {
		expect(joinRoute('/books/', 'dune')).toBe('/books/dune');
	});
});

describe('slugify', () => {
	it('lowercases and dasherizes labels', () => {
		expect(slugify('My Reading List')).toBe('my-reading-list');
	});

	it('strips .base and .md extensions', () => {
		expect(slugify('books.base')).toBe('books');
		expect(slugify('About.md')).toBe('about');
	});

	it('collapses and trims separators', () => {
		expect(slugify('  Hello --- World!! ')).toBe('hello-world');
	});
});

describe('deriveRoute', () => {
	it('gives the primary view the base slug', () => {
		expect(deriveRoute({ basePath: 'Books/books.base', viewName: 'Cards' }, true)).toBe(
			'/books',
		);
	});

	it('nests secondary views under the base', () => {
		expect(deriveRoute({ basePath: 'Books/books.base', viewName: 'Table' }, false)).toBe(
			'/books/table',
		);
	});

	it('honors an explicit route', () => {
		expect(deriveRoute({ basePath: 'x.base', viewName: 'v', route: 'docs/guide' }, true)).toBe(
			'/docs/guide',
		);
	});

	it('normalizes an explicit root route to "/"', () => {
		expect(deriveRoute({ basePath: 'x.base', viewName: 'v', route: '/' }, true)).toBe('/');
	});
});

describe('planSync', () => {
	it('warns when nothing is published', () => {
		const plan = planSync({ includes: [] });
		expect(plan.targets).toHaveLength(0);
		expect(plan.warnings).toHaveLength(1);
	});

	it('routes primary and secondary views of one base', () => {
		const config: SiteConfig = {
			includes: [
				{ basePath: 'Books/books.base', viewName: 'Cards' },
				{ basePath: 'Books/books.base', viewName: 'Table' },
			],
		};
		const plan = planSync(config);
		expect(plan.targets.map((t) => t.route)).toEqual(['/books', '/books/table']);
		expect(plan.warnings).toHaveLength(0);
	});

	it('skips a second base whose slug collides with the first', () => {
		const plan = planSync({
			includes: [
				{ basePath: 'Books/books.base', viewName: 'Cards' },
				{ basePath: 'Archive/books.base', viewName: 'Cards' },
			],
		});
		expect(plan.targets.map((t) => t.route)).toEqual(['/books']);
		expect(plan.warnings).toHaveLength(1);
	});

	it('skips and warns on route collisions', () => {
		const plan = planSync({
			includes: [
				{ basePath: 'a.base', viewName: 'v', route: '/dup' },
				{ basePath: 'b.base', viewName: 'v', route: '/dup' },
			],
		});
		expect(plan.targets).toHaveLength(1);
		expect(plan.warnings).toHaveLength(1);
	});

	it('defaults component and layout to "auto"', () => {
		const plan = planSync({ includes: [{ basePath: 'a.base', viewName: 'v' }] });
		expect(plan.targets[0]).toMatchObject({ component: 'auto', layout: 'auto' });
	});
});
