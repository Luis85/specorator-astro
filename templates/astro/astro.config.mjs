// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// SEO site URL (C15 — FR-14, FR-23; docs/DESIGN.md §5.7). The plugin's snapshot
// writer commits a `site.json` sidecar into the data dir in the SAME atomic swap
// as pages.json/navigation.json: `{ version, generatedAt, siteUrl? }`. We read it
// SYNCHRONOUSLY here at config load (build time — this file is NOT in src/core, so
// node:fs is fine) and mirror the Content Layer loader's data-dir resolution: the
// loader does `new URL('data/', config.root)`, and `config.root` is the directory
// holding this config file, so `new URL('data/site.json', import.meta.url)` lands
// on the very same file regardless of cwd.
//
// Degrade gracefully (warn-don't-fail): a missing/empty `siteUrl` means no canonical
// URL is known, so we leave Astro's `site` unset and skip the sitemap integration.
// The build still succeeds; BaseLayout omits canonical/OG tags when `Astro.site` is
// undefined. Only when a non-empty `siteUrl` is present do we set `site` + register
// `sitemap()`, which crawls the statically-generated routes (static + [...slug]).
const DATA_DIR = 'data';
const SITE_FILE = 'site.json';

/** Read the configured site URL from the data-dir sidecar, or undefined. */
function readSiteUrl() {
	const sitePath = fileURLToPath(new URL(`${DATA_DIR}/${SITE_FILE}`, import.meta.url));
	let raw;
	try {
		raw = readFileSync(sitePath, 'utf8');
	} catch (error) {
		// No sidecar committed yet (first run, before any sync) is not fatal. Mirror
		// the Content Layer loader's ENOENT narrowing (src/content/loader.ts).
		const code = /** @type {{ code?: string }} */ (error)?.code;
		if (code === 'ENOENT') return undefined;
		console.warn(`[specorator] Could not read ${sitePath}; skipping SEO site URL.`, error);
		return undefined;
	}
	try {
		const parsed = JSON.parse(raw);
		const url = typeof parsed?.siteUrl === 'string' ? parsed.siteUrl.trim() : '';
		return url.length > 0 ? url : undefined;
	} catch (error) {
		console.warn(`[specorator] Could not parse ${sitePath}; skipping SEO site URL.`, error);
		return undefined;
	}
}

const siteUrl = readSiteUrl();
if (!siteUrl) {
	console.warn(
		'[specorator] No site URL configured (data/site.json) — canonical/OpenGraph tags and sitemap.xml are disabled. Set the site URL in plugin settings to enable SEO.',
	);
}

// Static output is mandatory: the published site is a deployable static bundle
// and @astrojs/sitemap (C15) crawls statically-generated routes (docs/DESIGN.md
// §5.7, REQUIREMENTS.md FR-14). Do not switch to SSR.
export default defineConfig({
	output: 'static',
	...(siteUrl ? { site: siteUrl, integrations: [sitemap()] } : {}),
});
