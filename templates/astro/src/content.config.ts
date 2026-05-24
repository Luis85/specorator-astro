/*
 * specorator-template-version: 1
 *
 * Content collections config (Astro 6). Registers the `snapshots` collection
 * fed by the custom Content Layer loader (`content/loader.ts`), which reads the
 * committed snapshot set from `<project>/data/` (outside `src/`) and validates
 * each file against `snapshotSchema` (docs/DESIGN.md §5.5). The collection's
 * entry id is each snapshot's authoritative listing `route`; `[...slug].astro`
 * derives one static page per entry from it.
 */
import { defineCollection } from 'astro:content';
import { snapshotLoader } from './content/loader';
import { snapshotSchema } from './content/schema';

const snapshots = defineCollection({
	loader: snapshotLoader(),
	schema: snapshotSchema,
});

export const collections = { snapshots };
