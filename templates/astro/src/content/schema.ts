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

/** One harvested entry (a note matching the base's filters). */
export const entrySchema = z.object({
	path: z.string(),
	basename: z.string(),
	route: z.string(),
	values: z.record(z.string(), cellValueSchema),
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
