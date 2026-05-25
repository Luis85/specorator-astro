/*
 * specorator-template-version: 1
 *
 * Template-side navigation helpers (FR-13; DESIGN §5.7). The plugin resolves the
 * curated settings menu against the route table and commits the result to
 * `data/navigation.json`; the `navigation` content collection loads it (one
 * entry keyed `'site'`). `BaseLayout.astro` reads that tree and renders the menu
 * + breadcrumbs on EVERY page, so navigation is consistent site-wide.
 *
 * Breadcrumb derivation mirrors the pure `breadcrumbsFor` in
 * `src/core/domain/navigation.ts` (the standalone Astro build can't import plugin
 * source). Resolution/validation already happened in the plugin, so here we only
 * walk the resolved tree to find the active node's ancestor trail and to mark the
 * current item — no route validation, kept deliberately small.
 */
import type { NavNode, NavigationTree } from '../content/schema';

/** A breadcrumb crumb: a shallow label/link (children stripped). */
export interface Crumb {
	title: string;
	route?: string;
}

/** Normalize a route to a single leading slash, no trailing slash (except `/`). */
export function normalizeRoute(route: string): string {
	const trimmed = route
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? '/' : `/${trimmed}`;
}

/**
 * Derive the breadcrumb trail for `route` against a resolved {@link NavigationTree}
 * (mirrors core `breadcrumbsFor`). A synthetic home crumb (`/`) leads every
 * non-home trail; the home route's trail is just `[Home]`; an off-menu route
 * falls back to `[Home]`.
 */
export function breadcrumbsFor(route: string, tree: NavigationTree): Crumb[] {
	const target = normalizeRoute(route);
	const home: Crumb = { title: 'Home', route: '/' };
	if (target === '/') {
		return [home];
	}
	const trail = findTrail(tree.items, target);
	if (trail === null) {
		return [home];
	}
	if (trail.length > 0 && trail[0].route === '/') {
		return trail;
	}
	return [home, ...trail];
}

/** Depth-first search for the ancestor chain (root→match) to `target`. */
function findTrail(items: readonly NavNode[], target: string): Crumb[] | null {
	for (const node of items) {
		const crumb: Crumb =
			node.route === undefined
				? { title: node.title }
				: { title: node.title, route: node.route };
		if (node.route !== undefined && normalizeRoute(node.route) === target) {
			return [crumb];
		}
		const deeper = findTrail(node.children, target);
		if (deeper !== null) {
			return [crumb, ...deeper];
		}
	}
	return null;
}

/**
 * Is `nodeRoute` the page currently being rendered? Used to mark the active menu
 * item (`aria-current="page"`). A `route`-less label is never current.
 */
export function isCurrent(nodeRoute: string | undefined, currentRoute: string): boolean {
	return nodeRoute !== undefined && normalizeRoute(nodeRoute) === normalizeRoute(currentRoute);
}
