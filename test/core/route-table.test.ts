import { describe, expect, it } from 'vitest';
import {
	buildRouteTable,
	type RouteTablePage,
	type RouteTableTarget,
} from '../../src/core/domain/route-table';

/** Tiny helper to declare a target with bare-basename entries. */
function target(
	route: string,
	...entries: { path: string; basename: string; slug?: string }[]
): RouteTableTarget {
	return { route, entries };
}

/** Tiny helper to declare a standalone page. */
function page(path: string, route: string): RouteTablePage {
	return { path, route };
}

describe('buildRouteTable — placement', () => {
	it('places one listing route per target and one detail route per entry', () => {
		const table = buildRouteTable([
			target(
				'/books',
				{ path: 'Books/Dune.md', basename: 'Dune' },
				{ path: 'Books/Neuromancer.md', basename: 'Neuromancer' },
			),
		]);
		expect(table.routes).toEqual([
			{ route: '/books', kind: 'listing' },
			{ route: '/books/dune', kind: 'detail', entryPath: 'Books/Dune.md' },
			{ route: '/books/neuromancer', kind: 'detail', entryPath: 'Books/Neuromancer.md' },
		]);
		expect(table.warnings).toHaveLength(0);
	});

	it('derives detail routes deterministically by slugifying the basename under the listing', () => {
		const table = buildRouteTable([
			target('/books', {
				path: 'Books/The Left Hand of Darkness.md',
				basename: 'The Left Hand of Darkness',
			}),
		]);
		expect(table.detailRoutesByPath.get('Books/The Left Hand of Darkness.md')).toBe(
			'/books/the-left-hand-of-darkness',
		);
	});

	it('falls back to "entry" for a basename that slugifies away, under a root listing', () => {
		const table = buildRouteTable([target('/', { path: 'Notes/!!!.md', basename: '!!!' })]);
		expect(table.detailRoutesByPath.get('Notes/!!!.md')).toBe('/entry');
	});

	it('honors an explicit per-entry slug/permalink, normalized', () => {
		const table = buildRouteTable([
			target('/books', { path: 'Books/Dune.md', basename: 'Dune', slug: 'classics/dune/' }),
		]);
		expect(table.detailRoutesByPath.get('Books/Dune.md')).toBe('/classics/dune');
	});

	it('normalizes a listing route to a single leading slash', () => {
		const table = buildRouteTable([
			target('books/', { path: 'Books/Dune.md', basename: 'Dune' }),
		]);
		expect(table.routes[0]).toEqual({ route: '/books', kind: 'listing' });
	});
});

describe('buildRouteTable — collision detection across the shared namespace', () => {
	it('skips a later listing that collides with an earlier one (first wins)', () => {
		const table = buildRouteTable([target('/books'), target('/books')]);
		expect(table.routes.filter((r) => r.kind === 'listing')).toHaveLength(1);
		expect(table.warnings).toHaveLength(1);
		expect(table.warnings[0]).toContain('Listing route "/books"');
	});

	it('disambiguates two entries that slugify to the same detail route (entry-vs-entry)', () => {
		const table = buildRouteTable([
			target(
				'/notes',
				{ path: 'A/Hello World.md', basename: 'Hello World' },
				{ path: 'B/Hello_World.md', basename: 'Hello_World' },
			),
		]);
		const routes = table.routes.filter((r) => r.kind === 'detail').map((r) => r.route);
		expect(routes).toEqual(['/notes/hello-world', '/notes/hello-world-1']);
		expect(
			table.warnings.some((w) => w.includes('collides') && w.includes('hello-world-1')),
		).toBe(true);
		// Both entries still get a page (FR-21 — never dropped).
		expect(table.detailRoutesByPath.size).toBe(2);
	});

	it('disambiguates a detail route that collides with a listing (entry-vs-listing)', () => {
		// /books listing + an entry in another base whose slug would also be /books.
		const table = buildRouteTable([
			target('/books'),
			target('/library', { path: 'Lib/Books.md', basename: 'Books', slug: '/books' }),
		]);
		expect(table.detailRoutesByPath.get('Lib/Books.md')).toBe('/books-1');
		expect(table.warnings.some((w) => w.includes('listing'))).toBe(true);
	});

	it('chooses the next free numeric suffix when several disambiguations chain', () => {
		const table = buildRouteTable([
			target(
				'/n',
				{ path: 'a.md', basename: 'x' },
				{ path: 'b.md', basename: 'x' },
				{ path: 'c.md', basename: 'x' },
			),
		]);
		expect(table.routes.filter((r) => r.kind === 'detail').map((r) => r.route)).toEqual([
			'/n/x',
			'/n/x-1',
			'/n/x-2',
		]);
	});
});

describe('buildRouteTable — link resolver', () => {
	const table = buildRouteTable([
		target(
			'/books',
			{ path: 'Books/Dune.md', basename: 'Dune' },
			{ path: 'Books/The Left Hand of Darkness.md', basename: 'The Left Hand of Darkness' },
		),
	]);

	it('resolves a bare note name (case-insensitive)', () => {
		expect(table.resolve('Dune')).toBe('/books/dune');
		expect(table.resolve('dune')).toBe('/books/dune');
	});

	it('resolves a full vault path with and without extension', () => {
		expect(table.resolve('Books/Dune.md')).toBe('/books/dune');
		expect(table.resolve('Books/Dune')).toBe('/books/dune');
	});

	it('resolves a multi-word note name', () => {
		expect(table.resolve('The Left Hand of Darkness')).toBe('/books/the-left-hand-of-darkness');
	});

	it('returns null for an off-site / unpublished target (graceful degradation)', () => {
		expect(table.resolve('Some Unpublished Note')).toBeNull();
		expect(table.resolve('')).toBeNull();
		expect(table.resolve('   ')).toBeNull();
	});

	it('resolves a leading-slash or ./-prefixed path the same way', () => {
		expect(table.resolve('./Books/Dune.md')).toBe('/books/dune');
		expect(table.resolve('/Books/Dune.md')).toBe('/books/dune');
	});

	it('first sighting of a duplicate note name wins (deterministic)', () => {
		const t = buildRouteTable([
			target(
				'/n',
				{ path: 'first/Dup.md', basename: 'Dup' },
				{ path: 'second/Dup.md', basename: 'Dup' },
			),
		]);
		// The name resolves to the first entry's route; the second is disambiguated.
		expect(t.resolve('Dup')).toBe('/n/dup');
	});
});

describe('buildRouteTable — standalone pages (FR-12, FR-15)', () => {
	it('places a page route (incl. the home page `/`) before listings and details', () => {
		const table = buildRouteTable(
			[target('/books', { path: 'Books/Dune.md', basename: 'Dune' })],
			[page('Site/pages/Home.md', '/'), page('Site/pages/About.md', '/about')],
		);
		expect(table.routes).toEqual([
			{ route: '/', kind: 'page', pagePath: 'Site/pages/Home.md' },
			{ route: '/about', kind: 'page', pagePath: 'Site/pages/About.md' },
			{ route: '/books', kind: 'listing' },
			{ route: '/books/dune', kind: 'detail', entryPath: 'Books/Dune.md' },
		]);
		expect(table.pageRoutesByPath.get('Site/pages/Home.md')).toBe('/');
		expect(table.pageRoutesByPath.get('Site/pages/About.md')).toBe('/about');
		expect(table.warnings).toHaveLength(0);
	});

	it('skips a later page that collides with an earlier page (page-vs-page, first wins)', () => {
		const table = buildRouteTable(
			[],
			[page('Site/pages/About.md', '/about'), page('Site/pages/About2.md', '/about')],
		);
		expect(table.routes.filter((r) => r.kind === 'page')).toHaveLength(1);
		expect(table.pageRoutesByPath.has('Site/pages/About2.md')).toBe(false);
		expect(table.warnings.some((w) => w.includes('Page route "/about"'))).toBe(true);
	});

	it('skips a listing that collides with a page (page-vs-collection: the page wins)', () => {
		const table = buildRouteTable([target('/about')], [page('Site/pages/About.md', '/about')]);
		// The page is placed; the same-route listing is skipped (page placed first).
		expect(table.routes.filter((r) => r.kind === 'page')).toHaveLength(1);
		expect(table.routes.filter((r) => r.kind === 'listing')).toHaveLength(0);
		expect(table.warnings.some((w) => w.includes('Listing route "/about"'))).toBe(true);
	});

	it('disambiguates a detail route that collides with a page (page-vs-detail)', () => {
		const table = buildRouteTable(
			[target('/books', { path: 'Books/About.md', basename: 'About', slug: '/about' })],
			[page('Site/pages/About.md', '/about')],
		);
		// The page owns `/about`; the colliding detail gets a numeric suffix.
		expect(table.detailRoutesByPath.get('Books/About.md')).toBe('/about-1');
		expect(table.warnings.some((w) => w.includes('page'))).toBe(true);
	});

	it('resolves a wikilink to a page by name and by path', () => {
		const table = buildRouteTable([], [page('Site/pages/About.md', '/about')]);
		expect(table.resolve('About')).toBe('/about');
		expect(table.resolve('Site/pages/About.md')).toBe('/about');
		expect(table.resolve('Site/pages/About')).toBe('/about');
	});

	it('resolves a wikilink to the home page note (`/`)', () => {
		const table = buildRouteTable([], [page('Site/pages/Home.md', '/')]);
		expect(table.resolve('Home')).toBe('/');
	});

	it('defaults to no pages (existing collection-only behavior unchanged)', () => {
		const table = buildRouteTable([target('/books')]);
		expect(table.pageRoutesByPath.size).toBe(0);
		expect(table.routes.every((r) => r.kind !== 'page')).toBe(true);
	});
});
