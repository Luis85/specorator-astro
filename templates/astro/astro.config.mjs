// @ts-check
import { defineConfig } from 'astro/config';

// Static output is mandatory: the published site is a deployable static bundle
// and @astrojs/sitemap (added in C15) crawls statically-generated routes
// (docs/DESIGN.md §5.7, REQUIREMENTS.md FR-14). Do not switch to SSR.
export default defineConfig({
	output: 'static',
});
