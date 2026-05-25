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
 * non-home trail; the home route's trail is just `[Home]`; the home route's trail
 * is just `[Home]`.
 *
 * When `route` is a literal node in the curated nav, the curated ancestor chain is
 * used. Most detail routes (e.g. `/films/stalker`) are NOT curated nav nodes, so
 * the curated walk returns nothing and `Breadcrumbs.astro`'s `crumbs.length > 1`
 * guard would suppress the trail. To keep detail pages navigable, fall back to a
 * **structural** trail derived from the route's path segments (Home › Section ›
 * Entry): each leading segment becomes an ancestor crumb, reusing the curated
 * title/link when a segment's route is itself a known nav node, otherwise a
 * humanized label; the final segment is the current (route-less) page crumb.
 */
export function breadcrumbsFor(route: string, tree: NavigationTree): Crumb[] {
	const target = normalizeRoute(route);
	const home: Crumb = { title: 'Home', route: '/' };
	if (target === '/') {
		return [home];
	}
	const trail = findTrail(tree.items, target);
	if (trail !== null) {
		if (trail.length > 0 && trail[0].route === '/') {
			return trail;
		}
		return [home, ...trail];
	}
	// Off-menu route: derive a structural trail from the path segments so detail
	// pages (and any uncurated route) still get a multi-crumb breadcrumb.
	return [home, ...structuralTrail(target, tree)];
}

/**
 * Build a Section › … › Entry trail from a normalized route's path segments. Each
 * cumulative prefix is an ancestor: if that prefix route is a known nav node, its
 * curated title + link is reused; otherwise the segment is humanized into a label.
 * The deepest segment is the current page — route-less so `Breadcrumbs.astro` marks
 * it `aria-current="page"` rather than linking it.
 */
function structuralTrail(target: string, tree: NavigationTree): Crumb[] {
	const segments = target.split('/').filter((s) => s !== '');
	const crumbs: Crumb[] = [];
	let prefix = '';
	for (let i = 0; i < segments.length; i++) {
		prefix = `${prefix}/${segments[i]}`;
		const route = normalizeRoute(prefix);
		const isLast = i === segments.length - 1;
		const curated = findNode(tree.items, route);
		const title = curated?.title ?? humanizeSegment(segments[i]);
		// The deepest segment is the current page: route-less so it is not linked.
		crumbs.push(isLast ? { title } : { title, route });
	}
	return crumbs;
}

/** Find the nav node whose route matches `target` (depth-first), or null. */
function findNode(items: readonly NavNode[], target: string): NavNode | null {
	for (const node of items) {
		if (node.route !== undefined && normalizeRoute(node.route) === target) {
			return node;
		}
		const deeper = findNode(node.children, target);
		if (deeper !== null) {
			return deeper;
		}
	}
	return null;
}

/** Humanize a route segment into a crumb title (`my-entry` → `My Entry`). */
function humanizeSegment(segment: string): string {
	const words = segment
		.replace(/[-_]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter((w) => w !== '');
	if (words.length === 0) {
		return segment;
	}
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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
