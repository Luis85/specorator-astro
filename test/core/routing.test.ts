import { describe, expect, it } from 'vitest';
import {
	deriveRoute,
	joinRoute,
	planSync,
	slugify,
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
