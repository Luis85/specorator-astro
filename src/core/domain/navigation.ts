/**
 * Pure navigation resolution + breadcrumb derivation (FR-13; D14; DESIGN §5.7).
 *
 * The site's navigation is an **ordered, nestable** menu **curated in the plugin
 * settings** — the single authoritative source (D14). Each {@link NavItem} has a
 * human title and optionally a target `route` (pointing at a page or collection
 * route) and/or nested `children`. Page-frontmatter hints (`nav: {title,order,
 * group}`) and folder structure are *optional auto-suggestions only*, never the
 * primary source (inferred nav is brittle); this module therefore resolves the
 * settings nav list and leaves frontmatter/folder as a documented seam.
 *
 * This module keeps the nav **decisions** pure (no `obsidian`, no Node, no I/O):
 *
 * - {@link resolveNavigation} folds the curated {@link NavItem} config into a
 *   resolved {@link NavigationTree} the writer commits and the template renders:
 *   it normalizes each route, validates it against the site's known routes, and
 *   marks an item whose route is **not on the site** as a non-link **label**
 *   (kept, not dropped — curation is never silently lost) with a warning, so the
 *   menu still renders the user's structure. Empty/blank-title items are dropped.
 * - {@link breadcrumbsFor} derives the ancestor trail for a route: the chain of
 *   resolved nodes from the top of the tree down to the node whose route matches,
 *   so every page renders breadcrumbs consistently. A home crumb (`/`) is always
 *   the first element when the tree (or the requested route) involves the root.
 *
 * The resolved tree is a JSON-serializable snapshot (`navigation.json`), so the
 * template's loader reads it and `BaseLayout.astro` renders the menu + crumbs
 * across all pages. The known-route set comes from the global route table built
 * during a sync, so nav targets are validated against the *actual* site.
 */

import { normalizeRoute } from './routing';

/**
 * One curated navigation item as stored in the plugin settings (FR-13; D14).
 * Ordered (its position in the parent's list is its order) and nestable
 * (`children`). `route` is optional: an item with no route (or an unknown route)
 * is a structural **label/group** rather than a link.
 */
export interface NavItem {
	/** Human-visible label for the menu entry. */
	title: string;
	/** Target page/collection route (leading slash); omitted → a label/group. */
	route?: string;
	/** Nested items, in order; omitted/empty → a leaf. */
	children?: NavItem[];
}

/** The curated navigation config persisted in settings: an ordered item list. */
export interface NavConfig {
	/** Top-level nav items, in display order. */
	items: NavItem[];
}

/**
 * A path that addresses one item in the (possibly nested) curated list: the
 * index trail from the top-level list down to the item (e.g. `[1, 0]` is the
 * first child of the second top-level item). Used by the pure curation helpers
 * below so the settings UI can edit a deep item without re-implementing the
 * tree walk. An empty path addresses the top-level list itself.
 */
export type NavPath = readonly number[];

/**
 * Append `item` to the children of the item at `parentPath` (or to the top-level
 * list when the path is empty), returning a NEW config (pure — the input is not
 * mutated). An out-of-range path is a no-op (returns a structural copy), so a
 * stale UI action can never corrupt the menu. The single seam the settings tab's
 * "add item" / "add child" / "add to nav" affordances drive (FR-13; D14).
 */
export function addNavItem(config: NavConfig, parentPath: NavPath, item: NavItem): NavConfig {
	const next = cloneItems(config.items);
	if (parentPath.length === 0) {
		next.push(cloneItem(item));
		return { items: next };
	}
	const parent = itemAt(next, parentPath);
	if (parent === null) {
		return { items: next };
	}
	parent.children = [...(parent.children ?? []), cloneItem(item)];
	return { items: next };
}

/**
 * Remove the item at `path`, returning a NEW config. An out-of-range path is a
 * no-op. Removing an item removes its whole subtree (its children go with it).
 */
export function removeNavItem(config: NavConfig, path: NavPath): NavConfig {
	const next = cloneItems(config.items);
	const { list, index } = locate(next, path);
	if (list !== null && index >= 0 && index < list.length) {
		list.splice(index, 1);
	}
	return { items: next };
}

/**
 * Move the item at `path` one slot earlier (`-1`) or later (`+1`) within its
 * sibling list, returning a NEW config. A move that would leave the bounds of
 * the sibling list is a no-op, so the first/last items stay put. The seam the
 * settings tab's reorder (up/down) buttons drive.
 */
export function moveNavItem(config: NavConfig, path: NavPath, delta: number): NavConfig {
	const next = cloneItems(config.items);
	const { list, index } = locate(next, path);
	if (list === null) {
		return { items: next };
	}
	const target = index + delta;
	if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
		return { items: next };
	}
	const [moved] = list.splice(index, 1);
	list.splice(target, 0, moved);
	return { items: next };
}

/**
 * Update the title and/or route of the item at `path`, returning a NEW config.
 * A blank/whitespace `route` clears the route (the item becomes a label). An
 * out-of-range path is a no-op.
 */
export function updateNavItem(
	config: NavConfig,
	path: NavPath,
	patch: { title?: string; route?: string },
): NavConfig {
	const next = cloneItems(config.items);
	const item = itemAt(next, path);
	if (item === null) {
		return { items: next };
	}
	if (patch.title !== undefined) {
		item.title = patch.title;
	}
	if (patch.route !== undefined) {
		const trimmed = patch.route.trim();
		if (trimmed === '') {
			delete item.route;
		} else {
			item.route = trimmed;
		}
	}
	return { items: next };
}

/** Deep-clone one nav item (so curation helpers never mutate their input). */
function cloneItem(item: NavItem): NavItem {
	const copy: NavItem = { title: item.title };
	if (item.route !== undefined) {
		copy.route = item.route;
	}
	if (item.children !== undefined) {
		copy.children = cloneItems(item.children);
	}
	return copy;
}

/** Deep-clone a list of nav items. */
function cloneItems(items: readonly NavItem[]): NavItem[] {
	return items.map(cloneItem);
}

/** The item addressed by `path`, or `null` when the path is out of range. */
function itemAt(items: NavItem[], path: NavPath): NavItem | null {
	const { list, index } = locate(items, path);
	if (list === null || index < 0 || index >= list.length) {
		return null;
	}
	return list[index];
}

/**
 * Resolve `path` to the sibling list that contains the addressed item and the
 * item's index within it. Returns `{ list: null, index: -1 }` when any ancestor
 * step is out of range. An empty path is invalid (it addresses no single item).
 */
function locate(items: NavItem[], path: NavPath): { list: NavItem[] | null; index: number } {
	if (path.length === 0) {
		return { list: null, index: -1 };
	}
	let list = items;
	for (let depth = 0; depth < path.length - 1; depth += 1) {
		const step = path[depth];
		const child = list[step]?.children;
		if (child === undefined) {
			return { list: null, index: -1 };
		}
		list = child;
	}
	return { list, index: path[path.length - 1] };
}

/**
 * One resolved navigation node in the committed {@link NavigationTree}. A node
 * carries a normalized `route` only when that route is **on the site** (known);
 * an item pointing nowhere or off-site keeps `route: undefined` and renders as a
 * plain label. `current` is computed per-page at render time (not stored), so it
 * is intentionally absent from the snapshot.
 */
export interface NavNode {
	/** Human-visible label. */
	title: string;
	/** Normalized on-site route (leading slash), or `undefined` for a label. */
	route?: string;
	/** Resolved children, in order; empty for a leaf. */
	children: NavNode[];
}

/**
 * The resolved navigation tree the writer commits to `data/navigation.json` and
 * the template renders as the site menu + breadcrumbs across all pages (FR-13).
 */
export interface NavigationTree {
	/** Resolved top-level nodes, in display order. */
	items: NavNode[];
}

/** Result of {@link resolveNavigation}: the tree plus any non-fatal warnings. */
export interface ResolveNavigationResult {
	tree: NavigationTree;
	/** Warnings (e.g. an item pointing at a route not on the site). */
	warnings: string[];
}

/** An empty navigation tree (the migration-safe default, FR-13). */
export function emptyNavigationTree(): NavigationTree {
	return { items: [] };
}

/**
 * Resolve the curated {@link NavConfig} into a {@link NavigationTree} (FR-13).
 *
 * For each item, in order:
 * - a blank title is dropped (a nav entry must be labelled), with a warning;
 * - a present `route` is normalized and checked against `knownRoutes`; if it is
 *   **on the site** the node links to it, otherwise the node is kept as a plain
 *   **label** (route cleared) with a warning — curation is never silently lost;
 * - `children` recurse with the same rules, so nesting + ordering are preserved.
 *
 * `knownRoutes` is the set of every placed route (listing/detail/page) from the
 * global route table built during a sync, normalized the same way, so validation
 * compares like with like.
 */
export function resolveNavigation(
	config: NavConfig,
	knownRoutes: Iterable<string>,
): ResolveNavigationResult {
	const known = new Set<string>();
	for (const route of knownRoutes) {
		known.add(normalizeRoute(route));
	}
	const warnings: string[] = [];

	const resolveItems = (items: readonly NavItem[]): NavNode[] => {
		const nodes: NavNode[] = [];
		for (const item of items) {
			const title = item.title.trim();
			if (title === '') {
				warnings.push('A navigation item with a blank title was dropped.');
				continue;
			}

			let route: string | undefined;
			if (item.route !== undefined && item.route.trim() !== '') {
				const normalized = normalizeRoute(item.route);
				if (known.has(normalized)) {
					route = normalized;
				} else {
					warnings.push(
						`Navigation item "${title}" points at "${normalized}", which is not ` +
							`a route on this site; it renders as a label.`,
					);
				}
			}

			const children = item.children === undefined ? [] : resolveItems(item.children);
			nodes.push(route === undefined ? { title, children } : { title, route, children });
		}
		return nodes;
	};

	return { tree: { items: resolveItems(config.items) }, warnings };
}

/**
 * Derive the breadcrumb trail (ancestor chain) for `route` against a resolved
 * {@link NavigationTree} (FR-13; DESIGN §5.7). Returns the ordered list of nodes
 * from the top of the tree down to and including the node whose route matches
 * `route`, so the template can render `Home / Section / Page`.
 *
 * Rules (documented):
 * - A home crumb (`{ title: 'Home', route: '/' }`) is always prepended unless the
 *   target *is* the home route (then the trail is just `[Home]` when home is the
 *   request) — so every non-home page shows a path back to `/`.
 * - The deepest matching node wins; the first such match in document order is
 *   used (deterministic). A route not anywhere in the tree yields just the home
 *   crumb (a sensible "you are somewhere off the menu" fallback).
 * - Label nodes (no route) are valid intermediate crumbs but never the target.
 */
export function breadcrumbsFor(route: string, tree: NavigationTree): NavNode[] {
	const target = normalizeRoute(route);
	const home: NavNode = { title: 'Home', route: '/', children: [] };

	// The home route's trail is just the home crumb.
	if (target === '/') {
		return [home];
	}

	const trail = findTrail(tree.items, target);
	if (trail === null) {
		// Off-menu route: still give a path back home.
		return [home];
	}

	// Prepend a home crumb unless the trail already starts at the root route.
	if (trail.length > 0 && trail[0].route === '/') {
		return trail;
	}
	return [home, ...trail];
}

/**
 * Depth-first search for the trail to the node whose normalized route equals
 * `target`. Returns the chain (root→match) of *shallow* nodes (children
 * stripped, so a crumb is a lightweight label) or `null` when not found.
 */
function findTrail(items: readonly NavNode[], target: string): NavNode[] | null {
	for (const node of items) {
		const crumb: NavNode =
			node.route === undefined
				? { title: node.title, children: [] }
				: { title: node.title, route: node.route, children: [] };
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
