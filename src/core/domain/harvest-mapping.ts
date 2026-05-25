/**
 * Pure mapping from a mounted Bases view's evaluated output to a serializable
 * {@link ViewSnapshot} (FR-2; DESIGN §5.1, §6, §7).
 *
 * This module is the load-bearing core of the harvester: it owns *all* the
 * normalization rules (Bases `Value` → JSON `CellValue`, grouped data → ordered
 * `EntryGroup[]`, group-key normalization, view-config mirroring). The adapter
 * stays thin — it only mounts a view, hands the live Bases objects to these
 * functions (they already match the structural input interfaces below), and
 * persists the result.
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The Bases types are described
 * here structurally (duck-typed), so the real `Value`/`BasesEntry`/
 * `BasesViewConfig`/`BasesQueryResult` objects satisfy them without an import
 * and the mapper is unit-testable with plain in-memory fakes.
 */

import { joinRoute, slugifySegment } from './routing';
import type {
	BasesPropertyId,
	CellValue,
	EntryGroup,
	EntrySnapshot,
	ResolvedTarget,
	ViewSnapshot,
	ViewType,
} from './types';

/** The native Bases view types this plugin can render (DESIGN §2; FR-4). */
const SUPPORTED_VIEW_TYPES: readonly ViewType[] = ['table', 'cards', 'list'];

/**
 * Structural view of a parsed `.base` file (the relevant subset). A `.base` is
 * YAML with a top-level `views:` array; each view carries at least a `type` and
 * (optionally) a `name` and `groupBy`. The adapter parses the YAML via
 * `obsidian.parseYaml` and hands the plain object here; this stays pure.
 */
export interface ParsedBaseFile {
	views?: ParsedBaseView[];
}

/** One entry in a `.base` file's `views:` array (the subset we mirror). */
export interface ParsedBaseView {
	type?: string;
	name?: string;
	/** A property id, or `{ property, direction }` (Bases accepts both forms). */
	groupBy?: string | { property?: string; direction?: string };
}

/** The view facts the harvester mirrors from the chosen `.base` view. */
export interface SelectedViewConfig {
	type: ViewType;
	groupBy?: { property: BasesPropertyId; direction: 'ASC' | 'DESC' };
}

/**
 * Pick the target view out of a parsed `.base` file and normalize the facts the
 * snapshot mirrors: the native view `type` (defaulting to `table` for an unknown
 * or absent type, since table is the most general) and an optional `groupBy`.
 *
 * Matching is by `name`; if no view matches (or the base names no views) the
 * first view is used, then a `table` default. The map view is unsupported
 * (DESIGN §2), so it normalizes down to `table` rather than failing — Bases
 * still evaluates the data; only the *rendering* shape changes.
 */
export function selectViewConfig(base: ParsedBaseFile, viewName: string): SelectedViewConfig {
	const views = base.views ?? [];
	const match = views.find((view) => view.name === viewName) ?? views[0];
	const groupBy = normalizeGroupBy(match?.groupBy);
	return {
		type: normalizeViewType(match?.type),
		...(groupBy ? { groupBy } : {}),
	};
}

/** Coerce a raw `.base` view type to a supported {@link ViewType}, else `table`. */
function normalizeViewType(raw: string | undefined): ViewType {
	return SUPPORTED_VIEW_TYPES.includes(raw as ViewType) ? (raw as ViewType) : 'table';
}

/** Normalize a `.base` `groupBy` (string or object) into the snapshot shape. */
function normalizeGroupBy(
	raw: ParsedBaseView['groupBy'],
): { property: BasesPropertyId; direction: 'ASC' | 'DESC' } | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	const property = typeof raw === 'string' ? raw : raw.property;
	if (property === undefined || property === '') {
		return undefined;
	}
	const direction = typeof raw === 'object' && raw.direction === 'DESC' ? 'DESC' : 'ASC';
	return { property, direction };
}

/**
 * Structural view of a Bases `Value` (the real `obsidian.Value` satisfies this).
 *
 * `data` mirrors `PrimitiveValue<T>`'s wrapped scalar (string/number/boolean)
 * when present, letting us preserve numbers/booleans instead of stringifying
 * everything; `getValues()` mirrors `ListValue`'s elements so lists become
 * `string[]`. Both are optional, so a value exposing only `toString()` still
 * maps cleanly.
 */
export interface HarvestedValue {
	isEmpty(): boolean;
	toString(): string;
	/** Wrapped scalar for primitive values (`PrimitiveValue<T>.data`). */
	data?: unknown;
	/** Elements for list values (`ListValue`). */
	getValues?(): HarvestedValue[];
}

/** Structural view of a Bases entry (the real `obsidian.BasesEntry`). */
export interface HarvestedEntry {
	/** The backing file; only `path`/`basename` are read by the mapper. */
	file: { path: string; basename: string };
	/** Bases has already applied filters/formulas; returns `null` if absent. */
	getValue(propertyId: BasesPropertyId): HarvestedValue | null;
}

/** Structural view of a Bases entry group (`obsidian.BasesEntryGroup`). */
export interface HarvestedGroup {
	/** The groupBy key value for this group, if any. */
	key?: HarvestedValue;
	entries: HarvestedEntry[];
}

/** Structural view of `obsidian.BasesViewConfig` (the bits we mirror). */
export interface HarvestedConfig {
	/** The user-facing view name. */
	name: string;
	/** Ordered visible property ids (table columns / display order). */
	getOrder(): BasesPropertyId[];
	/** The friendly column label for a property id. */
	getDisplayName(propertyId: BasesPropertyId): string;
}

/** A normalized `route` lookup for a harvested entry, keyed by vault path. */
export type EntryRouteResolver = (entry: HarvestedEntry) => string;

/**
 * Convert a Bases `Value` into a JSON-serializable {@link CellValue}.
 *
 * Rules (DESIGN §7 value types):
 * - `null` or an empty `Value` → `null`.
 * - A list value (`getValues()`) → `string[]` of its elements' string forms,
 *   dropping empty elements.
 * - A primitive wrapping a `number`/`boolean` → that scalar (preserved as-is).
 * - Everything else → `value.toString()`.
 *
 * `ErrorValue`s are not special-cased away: Bases returns them from
 * `getValue()` like any other `Value`, and their `toString()` is the error
 * message, so they surface in the snapshot as a string rather than being
 * silently dropped (the entry is still harvested).
 */
export function mapValue(value: HarvestedValue | null): CellValue {
	if (value === null || value.isEmpty()) {
		return null;
	}

	if (typeof value.getValues === 'function') {
		return value
			.getValues()
			.filter((element) => !element.isEmpty())
			.map((element) => element.toString());
	}

	const scalar = value.data;
	if (typeof scalar === 'number' || typeof scalar === 'boolean') {
		return scalar;
	}

	return value.toString();
}

/**
 * Normalize a group's key into a stable string label, or `null` for the
 * implicit single group of an ungrouped view.
 *
 * Bases returns one group with an empty/absent key when no `groupBy` is set
 * (`BasesQueryResult.groupedData`), and a `NullValue` key for entries missing
 * the groupBy property — both normalize to `null` so the renderer treats them
 * as "ungrouped". A present, non-empty key becomes its string form.
 */
export function normalizeGroupKey(key: HarvestedValue | undefined): string | null {
	if (key === undefined || key.isEmpty()) {
		return null;
	}
	const cell = mapValue(key);
	if (cell === null) {
		return null;
	}
	return Array.isArray(cell) ? cell.join(', ') : String(cell);
}

/**
 * Map one Bases entry into an {@link EntrySnapshot}, reading every property id
 * in `order` (the value lookup, like all evaluation, is Bases' job). Property
 * ids absent from the entry map to `null`.
 */
export function mapEntry(
	entry: HarvestedEntry,
	order: readonly BasesPropertyId[],
	resolveRoute: EntryRouteResolver,
): EntrySnapshot {
	const values: Record<BasesPropertyId, CellValue> = {};
	for (const propertyId of order) {
		values[propertyId] = mapValue(entry.getValue(propertyId));
	}
	return {
		path: entry.file.path,
		basename: entry.file.basename,
		route: resolveRoute(entry),
		values,
	};
}

/**
 * Map the view's grouped data into ordered {@link EntryGroup}s, preserving the
 * order Bases already applied (sort/limit/groupBy are evaluated upstream — we
 * never re-sort). Each entry's cells are read against `order`.
 */
export function mapGroups(
	groupedData: readonly HarvestedGroup[],
	order: readonly BasesPropertyId[],
	resolveRoute: EntryRouteResolver,
): EntryGroup[] {
	return groupedData.map((group) => ({
		key: normalizeGroupKey(group.key),
		entries: group.entries.map((entry) => mapEntry(entry, order, resolveRoute)),
	}));
}

/**
 * Mirror the chosen view's display config into the snapshot `view` block:
 * the ordered visible property ids plus their friendly labels (FR-2 — we read
 * the config Bases exposes, never reimplementing filters/formulas).
 */
export function mapViewProperties(config: HarvestedConfig): {
	order: BasesPropertyId[];
	properties: Record<BasesPropertyId, { displayName: string }>;
} {
	const order = config.getOrder();
	const properties: Record<BasesPropertyId, { displayName: string }> = {};
	for (const propertyId of order) {
		properties[propertyId] = { displayName: config.getDisplayName(propertyId) };
	}
	return { order, properties };
}

/** Everything the pure mapper needs to assemble a {@link ViewSnapshot}. */
export interface HarvestInputs {
	/** The resolved target (route/component/layout) that drove this harvest. */
	target: ResolvedTarget;
	/** The view's display config (`obsidian.BasesViewConfig`). */
	config: HarvestedConfig;
	/** The grouped, evaluated data (`BasesQueryResult.groupedData`). */
	groupedData: readonly HarvestedGroup[];
	/** The native view type read from the `.base` (table/cards/list). */
	viewType: ViewType;
	/** Optional `groupBy` config mirrored from the `.base`. */
	groupBy?: { property: BasesPropertyId; direction: 'ASC' | 'DESC' };
	/** ISO timestamp; injected so the function stays pure/deterministic. */
	generatedAt: string;
}

/**
 * Assemble a complete {@link ViewSnapshot} from a mounted view's evaluated
 * output. This is the single pure seam the adapter calls after mounting: the
 * adapter supplies live Bases objects (which satisfy the structural inputs),
 * the resolved target, the view type/groupBy read from the `.base`, and a
 * timestamp; everything else is derived here.
 */
export function buildViewSnapshot(inputs: HarvestInputs): ViewSnapshot {
	const { target, config, groupedData, viewType, groupBy, generatedAt } = inputs;
	const { order } = mapViewProperties(config);
	const resolveRoute: EntryRouteResolver = (entry) =>
		joinRoute(target.route, slugifySegment(entry.file.basename));

	return {
		baseId: baseIdFromPath(target.basePath),
		route: target.route,
		source: { kind: 'file', path: target.basePath },
		view: {
			type: viewType,
			name: config.name,
			order,
			...(groupBy ? { groupBy } : {}),
		},
		render: { component: target.component, layout: target.layout },
		groups: mapGroups(groupedData, order, resolveRoute),
		generatedAt,
	};
}

/** Derive a stable `baseId` from a `.base` path (basename without extension). */
function baseIdFromPath(basePath: string): string {
	const segments = basePath.split('/');
	const last = segments[segments.length - 1] ?? basePath;
	return last.replace(/\.[^.]+$/, '');
}
