/**
 * Pure body-link resolution pass (FR-15, FR-21, D8; DESIGN §5.7, §6).
 *
 * Detail-page bodies arrive from the harvester as Obsidian-flavored markdown
 * with raw `[[wikilinks]]`. DESIGN §5.7 requires those links resolved **against
 * the route table** before the snapshot is written — and the route table is
 * **global** (cross-base links resolve too), so this pass runs once over the
 * whole harvested set, *after* all targets are harvested:
 *
 * 1. build the global {@link RouteTable} from every snapshot's listing route +
 *    entries (the single source of truth for the `[...slug]` namespace), then
 * 2. rewrite each entry body's `[[wikilinks]]` to routes via the table's
 *    resolver ({@link resolveWikilinks}); an **off-site (unpublished) link**
 *    becomes styled "not published" text and is surfaced in the returned
 *    `warnings` (FR-24, D17) — it is NEVER auto-published; out-of-scope syntax
 *    (block refs / transclusions / Dataview) degrades gracefully (D8).
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The harvester reads the raw
 * bodies (I/O) and attaches them to the snapshots; this pass only rewrites text
 * and returns the route-table + unpublished-link warnings for the caller to
 * surface (via the same `warnings` channel `SyncSite` already bubbles up).
 */

import {
	buildRouteTable,
	type RouteResolver,
	type RouteTablePage,
	type RouteTableTarget,
} from '../domain/route-table';
import { resolveWikilinks, type OffSiteLink } from '../domain/wikilinks';
import type { EntryGroup, EntrySnapshot, PageNode, ViewSnapshot } from '../domain/types';

/** The result of the body-resolution pass. */
export interface ResolveBodiesResult {
	/** Snapshots with every entry body's `[[wikilinks]]` resolved to routes. */
	snapshots: ViewSnapshot[];
	/**
	 * Non-fatal warnings: route-table collisions/disambiguations AND every
	 * off-site (unpublished) `[[wikilink]]` rendered as "not published" text
	 * (FR-24, D17). Each off-site warning names the link + its source note.
	 */
	warnings: string[];
}

/** Format one off-site link as a build warning naming its source note (FR-24). */
function offSiteWarning(link: OffSiteLink, sourcePath: string): string {
	const shown =
		link.text === link.target ? `[[${link.target}]]` : `[[${link.target}|${link.text}]]`;
	return (
		`Unpublished link ${shown} in ${sourcePath} points to a note that is not on ` +
		`the site; it renders as "not published" text (the target was not published).`
	);
}

/** The result of resolving snapshot AND standalone-page bodies (FR-12; C13). */
export interface ResolveSiteBodiesResult extends ResolveBodiesResult {
	/** Standalone pages with their body `[[wikilinks]]` resolved to routes. */
	pages: PageNode[];
	/**
	 * Every placed route in the global `[...slug]` namespace (listing/detail/page),
	 * in placement order. Exposed so the caller can validate the curated navigation
	 * against the *actual* site without rebuilding the table (FR-13).
	 */
	knownRoutes: string[];
}

/**
 * Resolve every entry body's wikilinks across the whole harvested set against a
 * single global route table. Snapshots without bodies pass through untouched
 * (the table is still built so collisions surface even when no body links exist).
 */
export function resolveSnapshotBodies(snapshots: readonly ViewSnapshot[]): ResolveBodiesResult {
	const { snapshots: out, warnings } = resolveSiteBodies(snapshots, []);
	return { snapshots: out, warnings };
}

/**
 * Resolve `[[wikilinks]]` in BOTH entry bodies and standalone-page bodies against
 * ONE global route table built from the snapshots AND the pages (FR-12, FR-15;
 * DESIGN §5.7). Building the table over the whole namespace is what lets a page
 * body link to a collection entry (and vice versa), and surfaces page-vs-page /
 * page-vs-listing collisions in one place. Bodies without links and pages
 * without a body pass through untouched; the table is still built so collisions
 * surface regardless.
 */
export function resolveSiteBodies(
	snapshots: readonly ViewSnapshot[],
	pages: readonly PageNode[],
): ResolveSiteBodiesResult {
	const targets: RouteTableTarget[] = snapshots.map((snapshot) => ({
		route: snapshot.route,
		entries: snapshot.groups.flatMap((group) =>
			group.entries.map((entry) => ({ path: entry.path, basename: entry.basename })),
		),
	}));
	const routePages: RouteTablePage[] = pages.map((page) => ({
		path: page.path,
		route: page.route,
	}));

	const table = buildRouteTable(targets, routePages);

	// Off-site (unpublished) `[[wikilinks]]` are collected here as the bodies are
	// resolved, each formatted as a warning naming its source note (FR-24, D17).
	// They are surfaced via the SAME `warnings` channel as route-table collisions
	// (which `SyncSite` already bubbles up) — never auto-published.
	const offSiteWarnings: string[] = [];

	const outSnapshots = snapshots.map((snapshot) => ({
		...snapshot,
		groups: snapshot.groups.map((group) =>
			resolveGroupBodies(group, table.resolve, offSiteWarnings),
		),
	}));
	const outPages = pages.map((page) => resolvePageBody(page, table.resolve, offSiteWarnings));

	return {
		snapshots: outSnapshots,
		pages: outPages,
		knownRoutes: table.routes.map((placed) => placed.route),
		warnings: [...table.warnings, ...offSiteWarnings],
	};
}

/** Rewrite one standalone page's body wikilinks; a page without a body is unchanged. */
function resolvePageBody(page: PageNode, resolve: RouteResolver, warnings: string[]): PageNode {
	if (page.body === undefined) {
		return page;
	}
	const onOffSite = (link: OffSiteLink): void => {
		warnings.push(offSiteWarning(link, page.path));
	};
	return {
		...page,
		body: { ...page.body, content: resolveWikilinks(page.body.content, resolve, onOffSite) },
	};
}

/** Resolve the bodies of every entry in one group. */
function resolveGroupBodies(
	group: EntryGroup,
	resolve: RouteResolver,
	warnings: string[],
): EntryGroup {
	return {
		...group,
		entries: group.entries.map((entry) => resolveEntryBody(entry, resolve, warnings)),
	};
}

/** Rewrite one entry body's wikilinks; entries without a body are unchanged. */
function resolveEntryBody(
	entry: EntrySnapshot,
	resolve: RouteResolver,
	warnings: string[],
): EntrySnapshot {
	if (entry.body === undefined) {
		return entry;
	}
	const onOffSite = (link: OffSiteLink): void => {
		warnings.push(offSiteWarning(link, entry.path));
	};
	return {
		...entry,
		body: { ...entry.body, content: resolveWikilinks(entry.body.content, resolve, onOffSite) },
	};
}
