/**
 * Pure route table (FR-15; DESIGN §5.7). The single source of truth for the
 * site's `[...slug]` namespace and for resolving `[[wikilinks]]` to on-site
 * routes (C8/D8).
 *
 * Astro renders **listing** routes (one per published `(base, view)`) and
 * **detail** routes (one per published entry) into the *same* dynamic
 * `[...slug]` namespace. Two routes that collide there would make `getStaticPaths`
 * emit duplicate params (a build error) and would make a wikilink ambiguous, so
 * collision detection belongs in one pure place — here — not scattered across the
 * harvester and the template. This module:
 *
 * - derives every route **deterministically** (an explicit listing route from
 *   planning wins; a detail route is the entry's slug under its listing route,
 *   with a normalized basename fallback so a route always has a segment),
 * - detects **collisions** across the whole namespace (entry-vs-entry,
 *   entry-vs-listing, listing-vs-listing) and resolves them deterministically
 *   (**first wins**; a later listing is skipped — matching `planSync` — and a
 *   later detail route is disambiguated with a numeric suffix so every published
 *   entry still gets a page, FR-21), recording a warning for each, and
 * - exposes a **link resolver**: vault path / note name → on-site route | null,
 *   built from the entries it placed, so `[[wikilinks]]` resolve to routes
 *   (off-site links return `null` and degrade gracefully — C16 owns styling).
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The harvester feeds it the
 * resolved targets + harvested entries (vault path + basename) and uses the
 * resulting routes/resolver; the template never re-derives routes.
 */

import { joinRoute, slugifySegment } from './routing';

/** A minimal harvested entry the route table needs to place a detail route. */
export interface RouteTableEntry {
	/** Vault-relative path of the backing note, e.g. `Books/Dune.md`. */
	path: string;
	/** The note's basename (no folders, no extension), e.g. `Dune`. */
	basename: string;
	/** Optional explicit route override (a note's `slug`/`permalink`), normalized here. */
	slug?: string;
}

/** A resolved target whose entries feed the table. */
export interface RouteTableTarget {
	/** The authoritative, collision-checked listing route (leading slash). */
	route: string;
	/** The entries published under this listing, in display order. */
	entries: readonly RouteTableEntry[];
}

/**
 * A standalone page that claims a route in the shared `[...slug]` namespace
 * (FR-12, FR-15; DESIGN §5.7). Its `route` is the page's *preferred* route (the
 * home page's is `/`), already derived by {@link buildPageNodes}; the table
 * places it and detects collisions against every other route.
 */
export interface RouteTablePage {
	/** Vault-relative path of the backing note, e.g. `Site/pages/About.md`. */
	path: string;
	/** Preferred normalized route (leading slash; the home page is `/`). */
	route: string;
}

/** What kind of page a placed route renders. */
export type RouteKind = 'listing' | 'detail' | 'page';

/** One placed route in the namespace. */
export interface PlacedRoute {
	/** Normalized site route with a single leading slash, e.g. `/books/dune`. */
	route: string;
	kind: RouteKind;
	/** For a detail route, the vault path of the entry it renders; else `undefined`. */
	entryPath?: string;
	/** For a page route, the vault path of the backing note; else `undefined`. */
	pagePath?: string;
}

/**
 * Resolve a vault path or note name to its on-site route, or `null` when the
 * target is not published (off-site — degrades gracefully, C16 styles it).
 *
 * Used by the wikilink resolver. Lookups are case-insensitive on the note name
 * so `[[Dune]]`, `[[dune]]`, and `[[Books/Dune.md]]` all resolve to `/books/dune`.
 */
export type RouteResolver = (target: string) => string | null;

/** The full route table for one sync, plus any collision warnings. */
export interface RouteTable {
	/** Every placed route in the shared `[...slug]` namespace, in placement order. */
	routes: PlacedRoute[];
	/** Non-fatal collision warnings (skips / disambiguations). */
	warnings: string[];
	/** Per-target detail routes keyed by entry vault path (post-collision). */
	detailRoutesByPath: ReadonlyMap<string, string>;
	/** Per-page routes keyed by the page note's vault path (post-collision). */
	pageRoutesByPath: ReadonlyMap<string, string>;
	/** Resolve a vault path / note name to a route, or `null` (off-site). */
	resolve: RouteResolver;
}

/** Normalize a route to a single leading slash and no trailing slash (except root). */
function normalize(route: string): string {
	const trimmed = route.trim().replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? '/' : `/${trimmed}`;
}

/** The preferred (pre-collision) detail route for an entry under its listing. */
function preferredDetailRoute(listingRoute: string, entry: RouteTableEntry): string {
	if (entry.slug !== undefined && entry.slug.trim() !== '') {
		return normalize(entry.slug);
	}
	return joinRoute(listingRoute, slugifySegment(entry.basename));
}

/** Disambiguate `route` against taken routes by appending `-1`, `-2`, … */
function disambiguate(route: string, taken: ReadonlySet<string>): string {
	if (!taken.has(route)) {
		return route;
	}
	let n = 1;
	let candidate = `${route}-${String(n)}`;
	while (taken.has(candidate)) {
		n += 1;
		candidate = `${route}-${String(n)}`;
	}
	return candidate;
}

/** Strip a `.md`/`.base` extension from a note name for name-keyed lookups. */
function stripExt(name: string): string {
	return name.replace(/\.(md|base)$/i, '');
}

/**
 * Build the full route table from the resolved targets, their harvested entries,
 * and any standalone pages. Placement order is **pages → listings → details**:
 *
 * 1. **Pages** are placed first (FR-12): a standalone page is an authored,
 *    explicit route — including the home page `/` — so it owns its route first
 *    (first-wins). A later page that collides with an earlier page or listing is
 *    skipped, matching `planSync`'s listing-collision style.
 * 2. **Listing** routes next (already de-duped by `planSync`, but a defensive
 *    check keeps the namespace consistent); a listing colliding with a page or
 *    another listing is skipped — first wins.
 * 3. **Detail** routes last; one that collides with anything already placed (a
 *    page, a listing, or an earlier detail) is disambiguated with a numeric
 *    suffix and a warning, so every published entry still renders (FR-21).
 *
 * The placed page/detail routes both feed the link resolver, so a `[[wikilink]]`
 * to a page or a collection entry resolves to the right route.
 */
export function buildRouteTable(
	targets: readonly RouteTableTarget[],
	pages: readonly RouteTablePage[] = [],
): RouteTable {
	const warnings: string[] = [];
	const routes: PlacedRoute[] = [];
	const taken = new Map<string, PlacedRoute>();
	const detailRoutesByPath = new Map<string, string>();
	const pageRoutesByPath = new Map<string, string>();

	// Index for the link resolver: lowercased vault path AND lowercased note name
	// → route. The path key is exact; the name key resolves bare `[[wikilinks]]`.
	const byPath = new Map<string, string>();
	const byName = new Map<string, string>();

	const place = (placed: PlacedRoute): void => {
		taken.set(placed.route, placed);
		routes.push(placed);
	};

	const addLinkKeys = (notePath: string, route: string): void => {
		byPath.set(notePath.toLowerCase(), route);
		const name = stripExt(basenameOf(notePath)).toLowerCase();
		if (!byName.has(name)) {
			byName.set(name, route);
		}
	};

	// 1) Standalone pages first. A page is an explicit authored route (the home
	//    page is `/`); a later page colliding with an earlier page/listing is
	//    skipped — first wins, matching `planSync`'s collision style.
	for (const page of pages) {
		const route = normalize(page.route);
		const existing = taken.get(route);
		if (existing) {
			warnings.push(
				`Page route "${route}" for ${page.path} collides with an already-placed ` +
					`${existing.kind} route; the later page was skipped.`,
			);
			continue;
		}
		place({ route, kind: 'page', pagePath: page.path });
		pageRoutesByPath.set(page.path, route);
		addLinkKeys(page.path, route);
	}

	// 2) Listing routes. `planSync` already de-duped them, but a listing that
	//    still collides here (a page's route, or another listing) is skipped —
	//    first wins, matching `planSync`'s collision style.
	for (const target of targets) {
		const route = normalize(target.route);
		const existing = taken.get(route);
		if (existing) {
			warnings.push(
				`Listing route "${route}" collides with an already-placed ` +
					`${existing.kind} route; the later listing was skipped.`,
			);
			continue;
		}
		place({ route, kind: 'listing' });
	}

	// 3) Detail routes. A detail route that collides with anything already placed
	//    (a page, a listing, or an earlier detail) is disambiguated with a numeric
	//    suffix and a warning, so every published entry still renders (FR-21).
	for (const target of targets) {
		const listingRoute = normalize(target.route);
		for (const entry of target.entries) {
			const preferred = preferredDetailRoute(listingRoute, entry);
			const route = disambiguate(preferred, new Set(taken.keys()));
			if (route !== preferred) {
				const clash = taken.get(preferred);
				warnings.push(
					`Detail route "${preferred}" for ${entry.path} collides with an ` +
						`already-placed ${clash?.kind ?? 'route'}; using "${route}" instead.`,
				);
			}
			place({ route, kind: 'detail', entryPath: entry.path });
			detailRoutesByPath.set(entry.path, route);

			// Link-resolution keys. First sighting of a name wins (deterministic);
			// the exact-path key is always unambiguous.
			byPath.set(entry.path.toLowerCase(), route);
			const name = stripExt(entry.basename).toLowerCase();
			if (!byName.has(name)) {
				byName.set(name, route);
			}
		}
	}

	const resolve: RouteResolver = (target) => resolveLink(target, byPath, byName);

	return { routes, warnings, detailRoutesByPath, pageRoutesByPath, resolve };
}

/** Bare basename (drop folders) for a vault path, separator-tolerant. */
function basenameOf(path: string): string {
	const clean = path.replace(/\\/g, '/').replace(/\/+$/g, '');
	return clean.slice(clean.lastIndexOf('/') + 1);
}

/**
 * Resolve one wikilink target string (the inner part of `[[ … ]]`, already
 * stripped of `|alias` and `#subpath` by the caller) to a route, or `null`.
 *
 * Tries, in order: an exact vault-path match (`Books/Dune.md` or `Books/Dune`),
 * then a bare note-name match (`Dune`). Case-insensitive throughout. A target
 * that matches nothing is off-site → `null` (graceful degradation).
 */
function resolveLink(
	target: string,
	byPath: ReadonlyMap<string, string>,
	byName: ReadonlyMap<string, string>,
): string | null {
	const cleaned = target.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
	if (cleaned === '') {
		return null;
	}
	const lower = cleaned.toLowerCase();

	// Exact path, with and without a `.md`/`.base` extension.
	const pathHit = byPath.get(lower) ?? byPath.get(`${stripExt(lower)}.md`);
	if (pathHit !== undefined) {
		return pathHit;
	}

	// Bare note name (last path segment, extension stripped).
	const lastSegment = stripExt(lower.slice(lower.lastIndexOf('/') + 1));
	return byName.get(lastSegment) ?? null;
}
