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
 *    resolver ({@link resolveWikilinks}); off-site links and out-of-scope syntax
 *    (block refs / transclusions / Dataview) degrade gracefully (D8).
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The harvester reads the raw
 * bodies (I/O) and attaches them to the snapshots; this pass only rewrites text
 * and returns the route-table warnings for the caller to surface.
 */

import { buildRouteTable, type RouteTableTarget } from '../domain/route-table';
import { resolveWikilinks } from '../domain/wikilinks';
import type { EntryGroup, EntrySnapshot, ViewSnapshot } from '../domain/types';

/** The result of the body-resolution pass. */
export interface ResolveBodiesResult {
	/** Snapshots with every entry body's `[[wikilinks]]` resolved to routes. */
	snapshots: ViewSnapshot[];
	/** Non-fatal route-table warnings (collisions/disambiguations). */
	warnings: string[];
}

/**
 * Resolve every entry body's wikilinks across the whole harvested set against a
 * single global route table. Snapshots without bodies pass through untouched
 * (the table is still built so collisions surface even when no body links exist).
 */
export function resolveSnapshotBodies(snapshots: readonly ViewSnapshot[]): ResolveBodiesResult {
	const targets: RouteTableTarget[] = snapshots.map((snapshot) => ({
		route: snapshot.route,
		entries: snapshot.groups.flatMap((group) =>
			group.entries.map((entry) => ({ path: entry.path, basename: entry.basename })),
		),
	}));

	const table = buildRouteTable(targets);

	const out = snapshots.map((snapshot) => ({
		...snapshot,
		groups: snapshot.groups.map((group) => resolveGroupBodies(group, table.resolve)),
	}));

	return { snapshots: out, warnings: table.warnings };
}

/** Resolve the bodies of every entry in one group. */
function resolveGroupBodies(
	group: EntryGroup,
	resolve: (target: string) => string | null,
): EntryGroup {
	return {
		...group,
		entries: group.entries.map((entry) => resolveEntryBody(entry, resolve)),
	};
}

/** Rewrite one entry body's wikilinks; entries without a body are unchanged. */
function resolveEntryBody(
	entry: EntrySnapshot,
	resolve: (target: string) => string | null,
): EntrySnapshot {
	if (entry.body === undefined) {
		return entry;
	}
	return {
		...entry,
		body: { ...entry.body, content: resolveWikilinks(entry.body.content, resolve) },
	};
}
