import { describe, expect, it } from 'vitest';
import {
	applyBinding,
	availableNames,
	hasComponent,
	hasLayout,
	resolveAssignment,
	resolveBinding,
	resolveRegistry,
	AUTO,
	DEFAULT_LAYOUT,
} from '../../src/core/domain/registry';
import type { PublishTarget, ResolvedTarget } from '../../src/core/domain/types';

describe('resolveRegistry', () => {
	it('dedupes names and sorts them for a stable order', () => {
		const resolved = resolveRegistry({
			components: { theme: ['table', 'cards', 'list'], user: ['cards'] },
			layouts: { theme: ['BaseLayout'] },
		});
		expect(availableNames(resolved.components)).toEqual(['cards', 'list', 'table']);
		expect(availableNames(resolved.layouts)).toEqual(['BaseLayout']);
	});

	it('lets user shadow a theme default of the same name (FR-11j)', () => {
		const resolved = resolveRegistry({
			components: { theme: ['cards'], user: ['cards'] },
			layouts: {},
		});
		expect(resolved.components).toEqual([{ name: 'cards', tier: 'user' }]);
	});

	it('lets a vault (generated) note shadow both user and theme (FR-11j precedence)', () => {
		const resolved = resolveRegistry({
			components: { theme: ['cards'], user: ['cards'], generated: ['cards'] },
			layouts: {},
		});
		expect(resolved.components).toEqual([{ name: 'cards', tier: 'generated' }]);
	});

	it('keeps the winning tier per name across a mixed set', () => {
		const resolved = resolveRegistry({
			components: {
				theme: ['table', 'cards', 'list'],
				user: ['cards', 'BookCard'],
				generated: ['BookCard', 'table'],
			},
			layouts: { theme: ['BaseLayout'], user: ['Wide'] },
		});
		expect(resolved.components).toEqual([
			{ name: 'BookCard', tier: 'generated' },
			{ name: 'cards', tier: 'user' },
			{ name: 'list', tier: 'theme' },
			{ name: 'table', tier: 'generated' },
		]);
		expect(resolved.layouts).toEqual([
			{ name: 'BaseLayout', tier: 'theme' },
			{ name: 'Wide', tier: 'user' },
		]);
	});

	it('tolerates missing tiers entirely (C11 ships theme + user only)', () => {
		const resolved = resolveRegistry({ components: { theme: ['table'] }, layouts: {} });
		expect(availableNames(resolved.components)).toEqual(['table']);
		expect(resolved.layouts).toEqual([]);
	});

	it('reports membership via hasComponent / hasLayout', () => {
		const resolved = resolveRegistry({
			components: { theme: ['table'], user: ['BookCard'] },
			layouts: { theme: ['BaseLayout'] },
		});
		expect(hasComponent(resolved, 'BookCard')).toBe(true);
		expect(hasComponent(resolved, 'nope')).toBe(false);
		expect(hasLayout(resolved, 'BaseLayout')).toBe(true);
		expect(hasLayout(resolved, 'Wide')).toBe(false);
	});
});

describe('resolveBinding', () => {
	it('falls back an auto component to the view type and auto layout to the default', () => {
		expect(resolveBinding({ component: AUTO, layout: AUTO }, 'cards')).toEqual({
			component: 'cards',
			layout: DEFAULT_LAYOUT,
		});
	});

	it('treats an unset binding as auto', () => {
		expect(resolveBinding({}, 'table')).toEqual({
			component: 'table',
			layout: 'BaseLayout',
		});
	});

	it('honors an explicit component and layout binding', () => {
		expect(resolveBinding({ component: 'BookCard', layout: 'Wide' }, 'cards')).toEqual({
			component: 'BookCard',
			layout: 'Wide',
		});
	});

	it('keeps an unknown explicit name verbatim (never drops a user choice)', () => {
		expect(resolveBinding({ component: 'Mystery' }, 'list')).toEqual({
			component: 'Mystery',
			layout: 'BaseLayout',
		});
	});

	it('treats an empty-string binding as auto', () => {
		expect(resolveBinding({ component: '', layout: '' }, 'list')).toEqual({
			component: 'list',
			layout: 'BaseLayout',
		});
	});
});

describe('resolveAssignment', () => {
	const assignments: PublishTarget[] = [
		{ basePath: 'Books/books.base', viewName: 'Cards', component: 'BookCard' },
		{ basePath: 'Books/books.base', viewName: 'Table', layout: 'Wide' },
	];

	it('resolves an explicit component binding looked up by (basePath, viewName)', () => {
		expect(
			resolveAssignment(
				assignments,
				{ basePath: 'Books/books.base', viewName: 'Cards' },
				'cards',
			),
		).toEqual({ component: 'BookCard', layout: 'BaseLayout' });
	});

	it('resolves an explicit layout binding, leaving the component auto -> view type', () => {
		expect(
			resolveAssignment(
				assignments,
				{ basePath: 'Books/books.base', viewName: 'Table' },
				'table',
			),
		).toEqual({ component: 'table', layout: 'Wide' });
	});

	it('resolves an unmatched (basePath, viewName) as fully auto', () => {
		expect(
			resolveAssignment(assignments, { basePath: 'X.base', viewName: 'v' }, 'list'),
		).toEqual({ component: 'list', layout: 'BaseLayout' });
	});
});

describe('applyBinding', () => {
	it('returns a target whose render names are concrete (auto resolved away)', () => {
		const target: ResolvedTarget = {
			basePath: 'Books/books.base',
			viewName: 'Cards',
			route: '/books',
			component: 'auto',
			layout: 'auto',
		};
		expect(applyBinding(target, 'cards')).toEqual({
			...target,
			component: 'cards',
			layout: 'BaseLayout',
		});
	});

	it('preserves an explicit binding while keeping the rest of the target', () => {
		const target: ResolvedTarget = {
			basePath: 'Books/books.base',
			viewName: 'Cards',
			route: '/books',
			component: 'BookCard',
			layout: 'Wide',
		};
		expect(applyBinding(target, 'cards')).toEqual(target);
	});
});
