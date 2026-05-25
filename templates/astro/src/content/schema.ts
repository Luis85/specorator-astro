/*
 * specorator-template-version: 1
 *
 * Zod 4 schema for the on-disk snapshot format (docs/DESIGN.md §5.5, §6). Each
 * `data/snapshots/<slug>.json` is one `ViewSnapshot` produced by the plugin's
 * snapshot writer (C2); the Content Layer loader (`loader.ts`) validates every
 * file against `snapshotSchema` before it reaches a page. Keep this in lockstep
 * with `src/core/domain/types.ts` in the plugin repo (do NOT import it — the
 * Astro project is a standalone build with no access to plugin source).
 *
 * `z` is imported from `astro/zod` (Astro 6 bundles Zod 4); using it keeps the
 * schema on exactly the version Astro validates collections with. (Importing
 * `z` from `astro:content` is deprecated in Astro 6 — see the v6 upgrade guide.)
 */
import { z } from 'astro/zod';

/** A normalized, JSON-serializable cell value harvested from a Bases entry. */
export const cellValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.string()),
]);
export type CellValue = z.infer<typeof cellValueSchema>;

/** The native Bases view types this template renders (map is out of scope). */
export const viewTypeSchema = z.enum(['table', 'cards', 'list']);
export type ViewType = z.infer<typeof viewTypeSchema>;

/**
 * One referenced vault attachment copied into the site (FR-16; DESIGN §5.8). The
 * asset pipeline (C7) records one per distinct source so the build can serve the
 * copied file. Optional on the snapshot so pre-C7 fixtures stay valid.
 */
export const assetRefSchema = z.object({
	source: z.string(),
	url: z.string(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

/**
 * A rendered detail-page body carried on an entry (FR-21, D8; DESIGN §6). The
 * `content` is markdown with `[[wikilinks]]` already resolved to routes and
 * `![[embeds]]` to asset URLs by the plugin before write; the detail page renders
 * it through the markdown + callout pipeline. Optional so pre-C8 fixtures stay
 * valid.
 */
export const entryBodySchema = z.object({
	format: z.literal('markdown'),
	content: z.string(),
});
export type EntryBody = z.infer<typeof entryBodySchema>;

/** One harvested entry (a note matching the base's filters). */
export const entrySchema = z.object({
	path: z.string(),
	basename: z.string(),
	route: z.string(),
	values: z.record(z.string(), cellValueSchema),
	/** Optional rendered detail-page body (FR-21, D8). Absent → no body section. */
	body: entryBodySchema.optional(),
});
export type EntrySnapshot = z.infer<typeof entrySchema>;

/** A group of entries; `key` is `null` when the view is ungrouped (flat). */
export const groupSchema = z.object({
	key: z.string().nullable(),
	entries: z.array(entrySchema),
});
export type EntryGroup = z.infer<typeof groupSchema>;

/**
 * The full per-`(base, view)` snapshot. `route` is the authoritative listing
 * route; per-entry `route`s drive detail pages (C8, out of scope here).
 */
export const snapshotSchema = z.object({
	baseId: z.string(),
	route: z.string(),
	source: z.object({
		kind: z.enum(['file', 'codeblock']),
		path: z.string(),
	}),
	view: z.object({
		type: viewTypeSchema,
		name: z.string(),
		order: z.array(z.string()),
		groupBy: z
			.object({
				property: z.string(),
				direction: z.enum(['ASC', 'DESC']),
			})
			.optional(),
		/**
		 * Property ids whose values are image references rewritten to public URLs
		 * by the asset pipeline (C7/FR-16); the views render these as `<img>`.
		 * Optional so pre-C7 snapshots stay valid.
		 */
		imageProperties: z.array(z.string()).optional(),
	}),
	render: z.object({
		component: z.string(),
		layout: z.string(),
	}),
	groups: z.array(groupSchema),
	/** Manifest of referenced attachments resolved to public URLs (FR-16). */
	assets: z.array(assetRefSchema).optional(),
	generatedAt: z.string(),
});
export type ViewSnapshot = z.infer<typeof snapshotSchema>;

/**
 * A standalone website page derived from a designated vault note (FR-12; DESIGN
 * §5.7, §6). One PageNode per page; the `isHome` page renders at `/`. The `body`
 * is markdown with `[[wikilinks]]` already resolved to routes by the plugin
 * before write (absent → a title-only page). Keep in lockstep with
 * `PageNode` in `src/core/domain/types.ts` (do NOT import it — standalone build).
 */
export const pageNodeSchema = z.object({
	path: z.string(),
	route: z.string(),
	title: z.string(),
	isHome: z.boolean(),
	frontmatter: z.record(z.string(), cellValueSchema),
	/** The page body (markdown, frontmatter stripped). Absent → an empty page. */
	body: entryBodySchema.optional(),
});
export type PageNode = z.infer<typeof pageNodeSchema>;

/** Shape of `data/pages.json`, the standalone-pages manifest (FR-12). */
export const pagesManifestSchema = z.object({
	version: z.number(),
	generatedAt: z.string(),
	pages: z.array(pageNodeSchema),
});
export type PagesManifest = z.infer<typeof pagesManifestSchema>;

/** One entry of the data-dir manifest (`data/index.json`). */
export const indexEntrySchema = z.object({
	baseId: z.string(),
	view: z.string(),
	route: z.string(),
	/** Path to the snapshot JSON, relative to the data dir (POSIX separators). */
	file: z.string(),
});
export type SnapshotIndexEntry = z.infer<typeof indexEntrySchema>;

/** Shape of `data/index.json`, the snapshot manifest the loader enumerates. */
export const indexSchema = z.object({
	version: z.number(),
	generatedAt: z.string(),
	snapshots: z.array(indexEntrySchema),
});
export type SnapshotIndex = z.infer<typeof indexSchema>;

/**
 * One resolved navigation node (FR-13; DESIGN §5.7). The plugin resolves the
 * curated settings menu against the route table before commit, so a node's
 * `route` (when present) is a real on-site route; an item pointing nowhere /
 * off-site arrives as a `route`-less **label**. `children` are ordered. Keep in
 * lockstep with `NavNode` in `src/core/domain/navigation.ts` (do NOT import it —
 * standalone build). Zod 4 needs an explicit type for the recursive `children`.
 */
export interface NavNode {
	title: string;
	route?: string;
	children: NavNode[];
}
export const navNodeSchema: z.ZodType<NavNode> = z.lazy(() =>
	z.object({
		title: z.string(),
		route: z.string().optional(),
		children: z.array(navNodeSchema),
	}),
);

/** The resolved navigation tree the template renders as menu + breadcrumbs. */
export const navigationTreeSchema = z.object({
	items: z.array(navNodeSchema),
});
export type NavigationTree = z.infer<typeof navigationTreeSchema>;

/** Shape of `data/navigation.json`, the navigation manifest (FR-13). */
export const navigationManifestSchema = z.object({
	version: z.number(),
	generatedAt: z.string(),
	navigation: navigationTreeSchema,
});
export type NavigationManifest = z.infer<typeof navigationManifestSchema>;
