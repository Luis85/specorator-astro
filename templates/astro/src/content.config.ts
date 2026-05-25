/*
 * specorator-template-version: 1
 *
 * Content collections config (Astro 6). Registers two collections fed by the
 * custom Content Layer loaders (`content/loader.ts`), which read the committed
 * data set from `<project>/data/` (outside `src/`):
 *
 * - `snapshots` — one per published `(base, view)`, validated against
 *   `snapshotSchema` (docs/DESIGN.md §5.5). The entry id is the listing `route`.
 * - `pages` — standalone pages (FR-12), validated against `pageNodeSchema`. The
 *   entry id is the page `route` (the home page's is `/`).
 *
 * `[...slug].astro` derives one static page per entry across both collections.
 */
import { defineCollection } from 'astro:content';
import { pagesLoader, snapshotLoader } from './content/loader';
import { pageNodeSchema, snapshotSchema } from './content/schema';

const snapshots = defineCollection({
	loader: snapshotLoader(),
	schema: snapshotSchema,
});

const pages = defineCollection({
	loader: pagesLoader(),
	schema: pageNodeSchema,
});

export const collections = { snapshots, pages };
