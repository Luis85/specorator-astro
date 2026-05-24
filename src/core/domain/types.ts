/**
 * Domain types for Specorator Astro Viewer.
 *
 * Pure data shapes shared across the core. No I/O, no `obsidian`, no Node.
 */

/** Prefixed Bases property id, e.g. `note.author`, `file.name`, `formula.ppu`. */
export type BasesPropertyId = string;

/** A normalized, JSON-serializable cell value harvested from a Bases entry. */
export type CellValue = string | number | boolean | null | string[];

/** The native Bases view types this plugin renders (map is out of scope). */
export type ViewType = 'table' | 'cards' | 'list';

/** One published `(base, view)` pair as declared in the site config note. */
export interface PublishTarget {
	/** Vault-relative path to the `.base` file, e.g. `Books/books.base`. */
	basePath: string;
	/** The view within the base to publish. */
	viewName: string;
	/** Optional explicit route; otherwise derived from the base/view. */
	route?: string;
	/** Optional component-name override (else resolved from the view type). */
	component?: string;
	/** Optional layout-name override. */
	layout?: string;
}

/** The user-curated site configuration (sourced from the vault config note). */
export interface SiteConfig {
	/** Absolute site URL; optional for dev, required at build for SEO. */
	siteUrl?: string;
	/** Curated list of published `(base, view)` targets, in display order. */
	includes: PublishTarget[];
}

/** A target after route/component resolution and collision handling. */
export interface ResolvedTarget {
	basePath: string;
	viewName: string;
	/** Normalized site route with a leading slash, e.g. `/books`. */
	route: string;
	/** Resolved component name, or `'auto'` to pick from the view type later. */
	component: string;
	/** Resolved layout name, or `'auto'`. */
	layout: string;
}

/** Result of planning a sync: what to harvest, plus non-fatal warnings. */
export interface SyncPlan {
	targets: ResolvedTarget[];
	warnings: string[];
}

/** One harvested entry (a note matching the base's filters). */
export interface EntrySnapshot {
	path: string;
	basename: string;
	route: string;
	values: Record<BasesPropertyId, CellValue>;
}

/** A group of entries (when the view uses `groupBy`); `key` is `null` if flat. */
export interface EntryGroup {
	key: string | null;
	entries: EntrySnapshot[];
}

/** The serialized output of harvesting one `(base, view)`. */
export interface ViewSnapshot {
	baseId: string;
	source: { kind: 'file' | 'codeblock'; path: string };
	view: {
		type: ViewType;
		name: string;
		order: BasesPropertyId[];
		groupBy?: { property: BasesPropertyId; direction: 'ASC' | 'DESC' };
	};
	render: { component: string; layout: string };
	groups: EntryGroup[];
	generatedAt: string;
}
