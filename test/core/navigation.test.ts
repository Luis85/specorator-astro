import { describe, expect, it } from 'vitest';
import {
	addNavItem,
	breadcrumbsFor,
	emptyNavigationTree,
	moveNavItem,
	removeNavItem,
	resolveNavigation,
	updateNavItem,
	type NavConfig,
	type NavigationTree,
} from '../../src/core/domain/navigation';

describe('resolveNavigation — ordering + nesting', () => {
	it('preserves top-level order and links items whose routes are on the site', () => {
		const config: NavConfig = {
			items: [
				{ title: 'Home', route: '/' },
				{ title: 'Books', route: '/books' },
				{ title: 'About', route: '/about' },
			],
		};
		const { tree, warnings } = resolveNavigation(config, ['/', '/books', '/about']);
		expect(tree.items).toEqual([
			{ title: 'Home', route: '/', children: [] },
			{ title: 'Books', route: '/books', children: [] },
			{ title: 'About', route: '/about', children: [] },
		]);
		expect(warnings).toHaveLength(0);
	});

	it('preserves nested children and their order', () => {
		const config: NavConfig = {
			items: [
				{
					title: 'Library',
					children: [
						{ title: 'Books', route: '/books' },
						{ title: 'Films', route: '/films' },
					],
				},
			],
		};
		const { tree } = resolveNavigation(config, ['/books', '/films']);
		expect(tree.items).toEqual([
			{
				title: 'Library',
				children: [
					{ title: 'Books', route: '/books', children: [] },
					{ title: 'Films', route: '/films', children: [] },
				],
			},
		]);
	});

	it('normalizes a nav route (trailing/double slash, backslashes) to match the route table', () => {
		const config: NavConfig = { items: [{ title: 'Books', route: 'books/' }] };
		const { tree, warnings } = resolveNavigation(config, ['/books']);
		expect(tree.items[0].route).toBe('/books');
		expect(warnings).toHaveLength(0);
	});
});

describe('resolveNavigation — unknown routes + labels', () => {
	it('keeps an item whose route is not on the site as a label (route cleared) with a warning', () => {
		const config: NavConfig = {
			items: [{ title: 'Ghost', route: '/not-published' }],
		};
		const { tree, warnings } = resolveNavigation(config, ['/books']);
		expect(tree.items).toEqual([{ title: 'Ghost', children: [] }]);
		expect(tree.items[0].route).toBeUndefined();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('Ghost');
		expect(warnings[0]).toContain('/not-published');
	});

	it('treats an item with no route as a structural label/group (no warning)', () => {
		const config: NavConfig = {
			items: [{ title: 'Section', children: [{ title: 'Books', route: '/books' }] }],
		};
		const { tree, warnings } = resolveNavigation(config, ['/books']);
		expect(tree.items[0].route).toBeUndefined();
		expect(tree.items[0].children).toHaveLength(1);
		expect(warnings).toHaveLength(0);
	});

	it('treats a blank/whitespace route as a label without warning', () => {
		const config: NavConfig = { items: [{ title: 'Group', route: '   ' }] };
		const { tree, warnings } = resolveNavigation(config, ['/books']);
		expect(tree.items[0].route).toBeUndefined();
		expect(warnings).toHaveLength(0);
	});

	it('drops a blank-title item with a warning (a nav entry must be labelled)', () => {
		const config: NavConfig = {
			items: [
				{ title: '  ', route: '/books' },
				{ title: 'Books', route: '/books' },
			],
		};
		const { tree, warnings } = resolveNavigation(config, ['/books']);
		expect(tree.items.map((i) => i.title)).toEqual(['Books']);
		expect(warnings.some((w) => w.includes('blank title'))).toBe(true);
	});

	it('drops a blank-title nested child too', () => {
		const config: NavConfig = {
			items: [{ title: 'Group', children: [{ title: '', route: '/books' }] }],
		};
		const { tree } = resolveNavigation(config, ['/books']);
		expect(tree.items[0].children).toEqual([]);
	});
});

describe('emptyNavigationTree', () => {
	it('is the migration-safe empty default', () => {
		expect(emptyNavigationTree()).toEqual({ items: [] });
		expect(resolveNavigation({ items: [] }, []).tree).toEqual({ items: [] });
	});
});

describe('breadcrumbsFor', () => {
	const tree: NavigationTree = {
		items: [
			{ title: 'Home', route: '/', children: [] },
			{
				title: 'Library',
				children: [
					{
						title: 'Books',
						route: '/books',
						children: [{ title: 'Dune', route: '/books/dune', children: [] }],
					},
				],
			},
		],
	};

	it('returns just the home crumb for the home route', () => {
		expect(breadcrumbsFor('/', tree)).toEqual([{ title: 'Home', route: '/', children: [] }]);
	});

	it('prepends a synthetic home crumb for a non-home route', () => {
		const trail = breadcrumbsFor('/books', tree);
		expect(trail.map((c) => c.title)).toEqual(['Home', 'Library', 'Books']);
		expect(trail.map((c) => c.route)).toEqual(['/', undefined, '/books']);
	});

	it('derives the full ancestor chain for a deeply nested route', () => {
		const trail = breadcrumbsFor('/books/dune', tree);
		expect(trail.map((c) => c.title)).toEqual(['Home', 'Library', 'Books', 'Dune']);
		expect(trail[trail.length - 1].route).toBe('/books/dune');
		// Crumbs are shallow (children stripped) so they stay lightweight labels.
		expect(trail.every((c) => c.children.length === 0)).toBe(true);
	});

	it('does NOT double-prepend home when the trail already starts at the root route', () => {
		const rootFirst: NavigationTree = {
			items: [
				{
					title: 'Home',
					route: '/',
					children: [{ title: 'Books', route: '/books', children: [] }],
				},
			],
		};
		const trail = breadcrumbsFor('/books', rootFirst);
		expect(trail.map((c) => c.route)).toEqual(['/', '/books']);
	});

	it('falls back to just the home crumb for an off-menu route', () => {
		expect(breadcrumbsFor('/nowhere', tree)).toEqual([
			{ title: 'Home', route: '/', children: [] },
		]);
	});

	it('normalizes the requested route before matching', () => {
		const trail = breadcrumbsFor('books/', tree);
		expect(trail.map((c) => c.title)).toEqual(['Home', 'Library', 'Books']);
	});

	it('returns the first match in document order when a route appears twice', () => {
		const dup: NavigationTree = {
			items: [
				{ title: 'First', route: '/dup', children: [] },
				{ title: 'Second', route: '/dup', children: [] },
			],
		};
		const trail = breadcrumbsFor('/dup', dup);
		expect(trail.map((c) => c.title)).toEqual(['Home', 'First']);
	});
});

describe('curation helpers (pure config edits)', () => {
	const base: NavConfig = {
		items: [
			{ title: 'Books', route: '/books' },
			{ title: 'Library', children: [{ title: 'Films', route: '/films' }] },
		],
	};

	it('addNavItem appends to the top-level list without mutating the input', () => {
		const next = addNavItem(base, [], { title: 'About', route: '/about' });
		expect(next.items.map((i) => i.title)).toEqual(['Books', 'Library', 'About']);
		// The input is untouched (pure).
		expect(base.items).toHaveLength(2);
	});

	it('addNavItem appends a child to a parent at a path', () => {
		const next = addNavItem(base, [1], { title: 'Tasks', route: '/tasks' });
		expect(next.items[1].children?.map((c) => c.title)).toEqual(['Films', 'Tasks']);
	});

	it('addNavItem creates a children list for a leaf parent', () => {
		const next = addNavItem(base, [0], { title: 'Dune', route: '/books/dune' });
		expect(next.items[0].children?.map((c) => c.title)).toEqual(['Dune']);
	});

	it('addNavItem is a no-op for an out-of-range parent path', () => {
		const next = addNavItem(base, [9], { title: 'Ghost' });
		expect(next.items.map((i) => i.title)).toEqual(['Books', 'Library']);
	});

	it('removeNavItem drops a top-level item and its subtree', () => {
		const next = removeNavItem(base, [1]);
		expect(next.items.map((i) => i.title)).toEqual(['Books']);
	});

	it('removeNavItem drops a nested child', () => {
		const next = removeNavItem(base, [1, 0]);
		expect(next.items[1].children).toEqual([]);
	});

	it('removeNavItem is a no-op for an out-of-range or empty path', () => {
		expect(removeNavItem(base, [9]).items).toHaveLength(2);
		expect(removeNavItem(base, []).items).toHaveLength(2);
		expect(removeNavItem(base, [5, 0]).items).toHaveLength(2);
	});

	it('moveNavItem reorders within the sibling list', () => {
		const down = moveNavItem(base, [0], +1);
		expect(down.items.map((i) => i.title)).toEqual(['Library', 'Books']);
		const up = moveNavItem(down, [1], -1);
		expect(up.items.map((i) => i.title)).toEqual(['Books', 'Library']);
	});

	it('moveNavItem clamps at the bounds (first up / last down are no-ops)', () => {
		expect(moveNavItem(base, [0], -1).items.map((i) => i.title)).toEqual(['Books', 'Library']);
		expect(moveNavItem(base, [1], +1).items.map((i) => i.title)).toEqual(['Books', 'Library']);
	});

	it('moveNavItem is a no-op for an out-of-range path', () => {
		expect(moveNavItem(base, [9], +1).items).toHaveLength(2);
		expect(moveNavItem(base, [], +1).items).toHaveLength(2);
	});

	it('updateNavItem patches title and route, and a blank route clears it (becomes a label)', () => {
		const renamed = updateNavItem(base, [0], { title: 'My Books' });
		expect(renamed.items[0].title).toBe('My Books');
		const cleared = updateNavItem(base, [0], { route: '   ' });
		expect(cleared.items[0].route).toBeUndefined();
		const retargeted = updateNavItem(base, [0], { route: '/new' });
		expect(retargeted.items[0].route).toBe('/new');
	});

	it('updateNavItem patches a nested child and is a no-op out of range', () => {
		const next = updateNavItem(base, [1, 0], { title: 'Cinema' });
		expect(next.items[1].children?.[0].title).toBe('Cinema');
		expect(updateNavItem(base, [9], { title: 'x' }).items).toHaveLength(2);
	});
});
