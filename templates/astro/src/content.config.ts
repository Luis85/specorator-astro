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
 * - `navigation` — the single resolved navigation tree (FR-13), validated
 *   against `navigationTreeSchema`, stored under the fixed id `'site'`.
 *
 * `[...slug].astro` derives one static page per entry across the snapshot +
 * pages collections; `BaseLayout` reads `navigation` to render the menu +
 * breadcrumbs on every page.
 */
import { defineCollection } from 'astro:content';
import { navigationLoader, pagesLoader, snapshotLoader } from './content/loader';
import { navigationTreeSchema, pageNodeSchema, snapshotSchema } from './content/schema';

const snapshots = defineCollection({
	loader: snapshotLoader(),
	schema: snapshotSchema,
});

const pages = defineCollection({
	loader: pagesLoader(),
	schema: pageNodeSchema,
});

const navigation = defineCollection({
	loader: navigationLoader(),
	schema: navigationTreeSchema,
});

export const collections = { snapshots, pages, navigation };
