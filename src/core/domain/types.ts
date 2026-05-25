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

/**
 * One referenced vault attachment that was copied into the site (FR-16; DESIGN
 * §5.8). The asset pipeline records one of these per distinct source so the
 * build can copy `source` (vault-relative) to `url` (under `public/`).
 */
export interface AssetRef {
	/** Normalized vault-relative source path of the attachment. */
	source: string;
	/** Public URL the rewritten reference points at (e.g. `/assets/cover.png`). */
	url: string;
}

/**
 * The note body carried on an entry snapshot for its detail page (FR-21, D8;
 * DESIGN §6). Optional: present only when the entry needs its body rendered. The
 * `content` is Obsidian-flavored markdown with `[[wikilinks]]` **already
 * resolved to routes** against the route table before write (DESIGN §5.7) and
 * `![[embeds]]` resolved to asset URLs; callouts are rendered by the template's
 * remark/rehype step. Block refs, transclusions, and Dataview are out of scope
 * and degrade gracefully (D8).
 */
export interface EntryBody {
	format: 'markdown';
	content: string;
}

/** One harvested entry (a note matching the base's filters). */
export interface EntrySnapshot {
	path: string;
	basename: string;
	route: string;
	/**
	 * Property values. For image-typed properties (those listed in
	 * {@link ViewSnapshot.view.imageProperties}) the asset pipeline rewrites the
	 * raw reference to the resolved public URL (or a placeholder URL when the
	 * attachment is missing), so the renderer can emit `<img src=…>` directly.
	 */
	values: Record<BasesPropertyId, CellValue>;
	/** Optional rendered detail-page body (FR-21, D8). Absent → no body section. */
	body?: EntryBody;
}

/** A group of entries (when the view uses `groupBy`); `key` is `null` if flat. */
export interface EntryGroup {
	key: string | null;
	entries: EntrySnapshot[];
}

/** The serialized output of harvesting one `(base, view)`. */
export interface ViewSnapshot {
	baseId: string;
	/**
	 * The listing route for this view (the resolved, collision-checked route from
	 * planning, with a leading slash, e.g. `/books`). Authoritative for the
	 * rendered listing page; per-entry detail routes are derived from it.
	 */
	route: string;
	source: { kind: 'file' | 'codeblock'; path: string };
	view: {
		type: ViewType;
		name: string;
		order: BasesPropertyId[];
		groupBy?: { property: BasesPropertyId; direction: 'ASC' | 'DESC' };
		/**
		 * Property ids whose values are images (e.g. a card cover, `note.cover`).
		 * The renderer emits `<img src=…>` for these; their entry `values` already
		 * hold the resolved public URL (FR-16). Optional — absent means none.
		 */
		imageProperties?: BasesPropertyId[];
	};
	render: { component: string; layout: string };
	groups: EntryGroup[];
	/**
	 * Manifest of vault attachments referenced by this view's entries, resolved
	 * to public URLs (FR-16; DESIGN §5.8). The copier copies each `source` into
	 * the project's `public/` at `url`. Optional — absent/empty means no assets.
	 */
	assets?: AssetRef[];
	generatedAt: string;
}
