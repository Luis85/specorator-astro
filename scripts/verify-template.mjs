// @ts-check
/**
 * verify:template gate (C1 — IMPLEMENTATION_PLAN §0.1.1 [template]).
 *
 * Proves the bundled Astro template (templates/astro/**, the editable source of
 * truth) is a real, runnable Astro 6 project: it stages a working copy, overlays
 * a minimal fixture (test/fixtures/astro-template/**), installs deps with
 * `--legacy-peer-deps` (FR-17), then runs `astro check` and `astro build` and
 * asserts the fixture route built to static HTML (output: 'static').
 *
 * Kept out of the fast `npm run verify` loop (it installs Astro + builds);
 * runs as its own CI step.
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const templateRoot = path.join(repoRoot, 'templates', 'astro');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'astro-template');
const keep = process.argv.includes('--keep');

/** Run a command, streaming output; reject on non-zero exit. */
function run(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(undefined);
			else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${String(code)}`));
		});
	});
}

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/** Assert `needle` appears in `haystack`, else throw a labelled error. */
function assertIncludes(haystack, needle, label) {
	if (!haystack.includes(needle)) {
		throw new Error(`${label}: expected to find ${JSON.stringify(needle)} in built HTML.`);
	}
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
	let count = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) break;
		count += 1;
		from = at + needle.length;
	}
	return count;
}

/** Return the substring from the first `start` up to the next `end` (exclusive of end). */
function sliceBetween(haystack, start, end) {
	const a = haystack.indexOf(start);
	if (a === -1) return '';
	const b = haystack.indexOf(end, a);
	return b === -1 ? haystack.slice(a) : haystack.slice(a, b);
}

/** Assert the index order of `first` precedes `second` in `haystack`. */
function assertOrder(haystack, first, second, label) {
	const a = haystack.indexOf(first);
	const b = haystack.indexOf(second);
	if (a === -1 || b === -1 || a > b) {
		throw new Error(
			`${label}: expected ${JSON.stringify(first)} to appear before ${JSON.stringify(second)}.`,
		);
	}
}

/**
 * Verify the C5 listing routes (table/cards/list) emitted by the fixture data
 * dir. Asserts on the built dist/**\/index.html: the correct view component, the
 * column/field order from `view.order`, group headings for the grouped view,
 * and one row/card/list-item per entry.
 */
async function assertSnapshotRoutes(dist) {
	// --- /books — table, grouped by status (keyed groups) ---
	const booksHtml = await readFile(path.join(dist, 'books', 'index.html'), 'utf8');
	assertIncludes(booksHtml, 'data-view="table"', '/books');
	// Columns render in `view.order` (file.name, note.author, formula.ppu): assert
	// the header cells' property order and that each label is humanized.
	assertOrder(
		booksHtml,
		'<th scope="col" data-property="file.name"',
		'<th scope="col" data-property="note.author"',
		'/books column order (Name→Author)',
	);
	assertOrder(
		booksHtml,
		'<th scope="col" data-property="note.author"',
		'<th scope="col" data-property="formula.ppu"',
		'/books column order (Author→Ppu)',
	);
	assertIncludes(booksHtml, '> Name <', '/books column header (humanized)');
	assertIncludes(booksHtml, '> Author <', '/books column header (humanized)');
	assertIncludes(booksHtml, '> Ppu <', '/books column header (humanized)');
	// Group headings for the two keyed groups, in index order. Match the heading
	// element so the assertion can't be satisfied by the view-name <h1>.
	if (countOccurrences(booksHtml, 'class="sp-group-heading"') !== 2) {
		throw new Error('/books: expected 2 group headings (one per keyed group).');
	}
	assertIncludes(booksHtml, '>Reading</h2>', '/books group heading');
	assertIncludes(booksHtml, '>Finished</h2>', '/books group heading');
	assertOrder(booksHtml, '>Reading</h2>', '>Finished</h2>', '/books group order');
	// One row per entry (two entries across two groups).
	if (countOccurrences(booksHtml, '<tr data-entry=') !== 2) {
		throw new Error('/books: expected exactly 2 table rows (one per entry).');
	}
	assertIncludes(booksHtml, 'Frank Herbert', '/books cell value');
	assertIncludes(booksHtml, 'William Gibson', '/books cell value');

	// --- /films — cards, ungrouped (single null-key group) ---
	const filmsHtml = await readFile(path.join(dist, 'films', 'index.html'), 'utf8');
	assertIncludes(filmsHtml, 'data-view="cards"', '/films');
	// One card per entry (two entries), with no group heading element (flat). The
	// CSS class name appears in <style>; assert on the rendered <h2> element.
	if (countOccurrences(filmsHtml, 'class="sp-card"') !== 2) {
		throw new Error('/films: expected exactly 2 cards (one per entry).');
	}
	if (filmsHtml.includes('<h2 class="sp-group-heading"')) {
		throw new Error('/films: ungrouped view must not emit a group heading element.');
	}
	assertIncludes(filmsHtml, '>Stalker</h3>', '/films card title');
	assertIncludes(filmsHtml, '>Solaris</h3>', '/films card title');
	// Field labels humanized from view.order (director/year), in order. file.name
	// is the card title; note.cover is the card cover image — both excluded from
	// the field list. The cover label must NOT appear as a field <dt>.
	assertIncludes(filmsHtml, '>Director</dt>', '/films field label');
	assertIncludes(filmsHtml, '>Year</dt>', '/films field label');
	assertOrder(filmsHtml, '>Director</dt>', '>Year</dt>', '/films field order');
	if (filmsHtml.includes('>Cover</dt>')) {
		throw new Error('/films: the image-typed cover must render as <img>, not a text field.');
	}

	// C7 asset pipeline: the image-typed `note.cover` renders as a card cover
	// <img>, pointing at the rewritten public URL. The resolved cover and the
	// missing-asset placeholder both appear (graceful degradation, FR-16).
	if (countOccurrences(filmsHtml, 'class="sp-card-cover"') !== 2) {
		throw new Error('/films: expected one card-cover <img> per entry (FR-16).');
	}
	assertIncludes(filmsHtml, 'src="/assets/stalker-cover.png"', '/films resolved cover URL');
	assertIncludes(filmsHtml, 'src="/assets/_missing.svg"', '/films missing-asset placeholder');

	// --- /tasks — list, ungrouped ---
	const tasksHtml = await readFile(path.join(dist, 'tasks', 'index.html'), 'utf8');
	assertIncludes(tasksHtml, 'data-view="list"', '/tasks');
	// One list item per entry (two entries).
	if (countOccurrences(tasksHtml, 'class="sp-list-item"') !== 2) {
		throw new Error('/tasks: expected exactly 2 list items (one per entry).');
	}
	if (tasksHtml.includes('<h2 class="sp-group-heading"')) {
		throw new Error('/tasks: ungrouped view must not emit a group heading element.');
	}
	assertIncludes(tasksHtml, '>Ship C5<', '/tasks item');
	assertIncludes(tasksHtml, '>Write docs<', '/tasks item');
	assertIncludes(tasksHtml, '>Priority:<', '/tasks secondary field label');

	console.log(
		'[verify:template] OK — table/cards/list listing routes built with correct order/grouping.',
	);
}

/**
 * Verify the C8 detail pages: `getStaticPaths` emits one page per entry `route`
 * in the shared `[...slug]` namespace, and the page renders the entry body at
 * core fidelity — markdown, an Obsidian **callout** as callout markup, and a
 * `[[wikilink]]` already resolved to the linked entry's route (FR-21, D8).
 * Also proves graceful degradation: a block ref / Dataview snippet in the body
 * does not fail the build and ships as passed-through content.
 */
async function assertDetailRoutes(dist) {
	// Every published entry got its own detail page (one per entry across bases).
	const detailRoutes = [
		['books', 'dune'],
		['books', 'neuromancer'],
		['films', 'stalker'],
		['films', 'solaris'],
		['tasks', 'ship-c5'],
		['tasks', 'write-docs'],
	];
	for (const segs of detailRoutes) {
		const file = path.join(dist, ...segs, 'index.html');
		if (!(await exists(file))) {
			throw new Error(`Detail page missing for /${segs.join('/')} (FR-21): ${file}`);
		}
	}

	// The /books/dune detail page: body rendered, callout markup, resolved link.
	const duneHtml = await readFile(path.join(dist, 'books', 'dune', 'index.html'), 'utf8');
	assertIncludes(duneHtml, 'class="sp-detail"', '/books/dune detail article');
	assertIncludes(duneHtml, 'class="sp-detail-body"', '/books/dune rendered body');
	// Frontmatter/values shown on the detail page (humanized field label + value).
	assertIncludes(duneHtml, 'Frank Herbert', '/books/dune field value');
	// The Obsidian callout `> [!note] Spice` renders as callout markup.
	assertIncludes(duneHtml, 'data-callout="note"', '/books/dune callout');
	assertIncludes(duneHtml, 'class="sp-callout-title"', '/books/dune callout title');
	assertIncludes(duneHtml, 'The spice must flow.', '/books/dune callout body');
	// The on-site wikilink (resolved to a route by the plugin before write) is a
	// real link out to the target's detail route.
	assertIncludes(duneHtml, 'href="/books/neuromancer"', '/books/dune resolved on-site wikilink');
	// C16 (FR-24, D17): an OFF-SITE `[[wikilink]]` was resolved by the plugin to a
	// styled, NON-clickable "not published" marker — a <span class="sp-unpublished">,
	// NOT an <a href>. Assert the marker shipped with its visible text, and that the
	// off-site target is never linked (no href to a /private-note route exists).
	assertIncludes(duneHtml, 'class="sp-unpublished"', '/books/dune off-site wikilink marker');
	assertIncludes(duneHtml, '>Private Note</span>', '/books/dune off-site wikilink text');
	if (duneHtml.includes('href="/private-note"') || duneHtml.includes('>Private Note</a>')) {
		throw new Error(
			'/books/dune: an off-site wikilink rendered as a clickable link — it must be ' +
				'non-clickable "not published" text (FR-24, privacy-safe).',
		);
	}
	// The .sp-unpublished marker is styled (the global token sheet ships a rule for it).
	const dCss = await readBundledCss(dist);
	assertIncludes(dCss, '.sp-unpublished', '/books/dune off-site marker styled');
	// Graceful degradation (D8): the unresolved block ref + Dataview block ship as
	// passed-through content; their presence proves the build did not fail on them.
	assertIncludes(duneHtml, '#^missing', '/books/dune block-ref degraded (no crash)');
	assertIncludes(duneHtml, 'dataview', '/books/dune dataview degraded (no crash)');

	console.log('[verify:template] OK — per-entry detail pages built; body/callout/link rendered.');
}

/**
 * Verify the C11 registry precedence (docs/DESIGN.md §5.6; FR-11b/j): a
 * `src/user/views/*` component shadows the bundled `src/theme/views/*` default
 * of the same name. The fixture overlays a user-owned `placeholder.astro` (a
 * sentinel marker) and routes the `/showcase` snapshot to
 * `render.component: "placeholder"`; this asserts the built page rendered the
 * USER override, not the theme placeholder's copy — proving the registry barrel
 * picked the higher-precedence tier via `import.meta.glob`.
 */
async function assertRegistryPrecedence(dist) {
	const file = path.join(dist, 'showcase', 'index.html');
	if (!(await exists(file))) {
		throw new Error(`Registry precedence route /showcase missing (FR-11b): ${file}`);
	}
	const html = await readFile(file, 'utf8');
	// The user override rendered (its sentinel marker), proving user > theme.
	assertIncludes(html, 'data-shadow-marker="user-wins"', '/showcase user override rendered');
	assertIncludes(html, 'data-view="user-placeholder"', '/showcase user override view');
	// The theme placeholder's copy must NOT appear — the theme default was shadowed.
	if (html.includes('No collections synced yet')) {
		throw new Error('/showcase: theme placeholder rendered — user override did not shadow it.');
	}
	console.log(
		'[verify:template] OK — user component shadows the same-named theme default (FR-11b/j).',
	);
}

/**
 * Verify the C12 generated-tier precedence (docs/DESIGN.md §5.6; FR-11j): a
 * transpiled vault component under `src/generated/views/*` shadows a same-named
 * `src/user/views/*` (and the theme default), proving the registry barrel's
 * highest-precedence tier wins (generated → user → theme). The fixture overlays
 * BOTH `generated/views/LibraryCard.astro` (sentinel `generated-wins`) and
 * `user/views/LibraryCard.astro` (a marker that must NOT appear) and routes the
 * `/library` snapshot to `render.component: "LibraryCard"`; this asserts the
 * built page rendered the GENERATED component, not the user copy.
 */
async function assertGeneratedShadows(dist) {
	const file = path.join(dist, 'library', 'index.html');
	if (!(await exists(file))) {
		throw new Error(`Generated-shadows route /library missing (FR-11j): ${file}`);
	}
	const html = await readFile(file, 'utf8');
	// The generated (vault) component rendered — generated beats user + theme.
	assertIncludes(html, 'data-shadow-marker="generated-wins"', '/library generated override');
	assertIncludes(html, 'data-view="generated-library-card"', '/library generated view');
	// The same-named USER component must NOT appear — it was shadowed by generated.
	if (html.includes('user-libcard-should-be-shadowed')) {
		throw new Error(
			'/library: user LibraryCard rendered — generated did not shadow it (FR-11j broken).',
		);
	}
	console.log(
		'[verify:template] OK — generated (vault) component shadows the same-named user/theme (FR-11j).',
	);
}

/**
 * Verify the C13 standalone pages (docs/DESIGN.md §5.7; FR-12, FR-15): the home
 * page (`isHome: true`, route `/`) renders at `/` via index.astro, and a normal
 * page (`/about`) renders its body — with a `[[wikilink]]` already resolved to
 * an on-site entry route by the plugin (here, the fixture's pre-resolved link).
 */
async function assertPageRoutes(dist) {
	// --- / — the home page renders its body (not the bundled placeholder) ---
	const homeHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
	assertIncludes(homeHtml, 'class="sp-page"', '/ home page article');
	assertIncludes(homeHtml, 'data-home="true"', '/ home page flag');
	assertIncludes(homeHtml, 'This is the', '/ home page body');
	assertIncludes(homeHtml, '<strong>home page</strong>', '/ home page markdown rendered');
	// The home body's callout renders as callout markup.
	assertIncludes(homeHtml, 'data-callout="tip"', '/ home callout');
	// The resolved on-site link in the home body points at the listing route.
	assertIncludes(homeHtml, 'href="/books"', '/ home resolved link');
	// The bundled placeholder must NOT appear — the home page shadowed it.
	if (homeHtml.includes('No collections synced yet')) {
		throw new Error('/: placeholder rendered — the synced home page did not replace it.');
	}

	// --- /about — a normal page renders its body + the resolved wikilink ---
	const aboutFile = path.join(dist, 'about', 'index.html');
	if (!(await exists(aboutFile))) {
		throw new Error(`Standalone page route /about missing (FR-12): ${aboutFile}`);
	}
	const aboutHtml = await readFile(aboutFile, 'utf8');
	assertIncludes(aboutHtml, 'class="sp-page"', '/about page article');
	assertIncludes(aboutHtml, 'About this site', '/about page title');
	assertIncludes(aboutHtml, 'About body.', '/about page body');
	// The wikilink (resolved to a route by the plugin before write) links out to
	// an existing fixture entry's detail route.
	assertIncludes(aboutHtml, 'href="/books/dune"', '/about resolved wikilink');

	console.log(
		'[verify:template] OK — home page renders at /; standalone page route built (FR-12).',
	);
}

/**
 * Verify the C14 navigation (docs/DESIGN.md §5.7; FR-13): the curated, resolved
 * navigation tree committed to data/navigation.json renders as a primary menu on
 * EVERY page type (home, listing, detail, standalone page) with the right order
 * and nesting, and breadcrumbs render the ancestor trail on a nested route. The
 * nav is rendered by BaseLayout, so it must appear consistently across pages.
 */
async function assertNavigation(dist) {
	// The nav menu renders on every page type — home, a listing, a detail page,
	// and a standalone page — proving BaseLayout renders it site-wide.
	const pageTypes = {
		home: path.join(dist, 'index.html'),
		listing: path.join(dist, 'books', 'index.html'),
		detail: path.join(dist, 'books', 'dune', 'index.html'),
		page: path.join(dist, 'about', 'index.html'),
	};
	for (const [label, file] of Object.entries(pageTypes)) {
		const html = await readFile(file, 'utf8');
		assertIncludes(html, 'class="sp-site-nav"', `nav menu present on ${label} page`);
		// The top-level menu items render in curated order: Home → Books → Library →
		// About. Astro pads element text with spaces, so match the spaced labels.
		assertOrder(html, '> Home </a>', '> Books </a>', `${label} nav order (Home→Books)`);
		assertOrder(html, '> Books </a>', 'sp-nav-label', `${label} nav order (Books→Library)`);
		assertOrder(html, 'sp-nav-label', '> About </a>', `${label} nav order (Library→About)`);
		// Nesting: the nested "Dune" (under Books) and the "Films"/"Tasks" (under
		// the route-less "Library" label) render as sub-list items.
		assertIncludes(html, 'href="/books/dune"', `${label} nested nav link (Dune)`);
		assertIncludes(html, 'href="/films"', `${label} nested nav link (Films)`);
		assertIncludes(html, 'href="/tasks"', `${label} nested nav link (Tasks)`);
		// The route-less "Library" item renders as a label, never a link.
		assertIncludes(html, 'class="sp-nav-label"', `${label} route-less label rendered`);
	}

	// The active page's menu link is marked aria-current="page" (the listing page
	// is /books, so its own Books link is current).
	const booksHtml = await readFile(pageTypes.listing, 'utf8');
	assertIncludes(booksHtml, 'aria-current="page"', '/books active nav item marked aria-current');

	// Breadcrumbs render the ancestor trail on a nested route: /books/dune is
	// Home / Books / Dune, inside a semantic <nav aria-label="Breadcrumb">. Assert
	// on the breadcrumb <ol> slice so the menu's links can't satisfy the order.
	const duneHtml = await readFile(pageTypes.detail, 'utf8');
	assertIncludes(duneHtml, 'class="sp-breadcrumbs"', '/books/dune breadcrumbs present');
	assertIncludes(duneHtml, 'aria-label="Breadcrumb"', '/books/dune breadcrumb landmark');
	const crumbList = sliceBetween(duneHtml, 'sp-breadcrumb-list', '</ol>');
	assertOrder(crumbList, 'href="/"', 'href="/books"', '/books/dune crumb order (Home→Books)');
	assertOrder(
		crumbList,
		'href="/books"',
		'aria-current="page"',
		'/books/dune crumb order (→Dune)',
	);
	// The final crumb (the current page) is the route-less, aria-current Dune span.
	assertIncludes(crumbList, '>Dune</span>', '/books/dune final crumb text');

	console.log(
		'[verify:template] OK — nav menu renders site-wide with order/nesting; breadcrumbs on a nested route (FR-13).',
	);
}

/** Read every bundled stylesheet under dist/_astro and concatenate in name order. */
async function readBundledCss(dist) {
	const astroDir = path.join(dist, '_astro');
	const names = (await readdir(astroDir)).filter((n) => n.endsWith('.css')).sort();
	if (names.length === 0) {
		throw new Error(
			'theme cascade: no bundled CSS found under dist/_astro (expected token sheet).',
		);
	}
	const parts = await Promise.all(names.map((n) => readFile(path.join(astroDir, n), 'utf8')));
	return parts.join('\n/* --- next bundle --- */\n');
}

/**
 * Verify the C9 token cascade (docs/DESIGN.md §5.6, D9; FR-11a/NFR-7): the
 * template's default tokens load FIRST and the user-owned src/user/theme.css
 * loads LAST, so a `--sp-*` token redefined in theme.css wins over the default
 * with NO component edits. The fixture's overlaid theme.css redefines
 * `--sp-color-accent` to a sentinel (#abcdef) and adds an unminifiable marker
 * property; this asserts STRUCTURALLY on the built CSS bundle that the override
 * shipped and is ordered after the default token block (so it wins by cascade).
 */
async function assertThemeOverrideCascade(dist) {
	const css = await readBundledCss(dist);

	// 1) The default token sheet shipped: the light `:root` accent default is present.
	const defaultAccent = '--sp-color-accent: #3b5bdb';
	assertIncludes(css, defaultAccent, 'theme cascade default token');

	// 2) The user override shipped: the fixture theme.css sentinel value is present,
	//    and its unminifiable marker proves theme.css content reached the bundle.
	const overrideAccent = '--sp-color-accent: #abcdef';
	assertIncludes(css, overrideAccent, 'theme cascade user override value');
	assertIncludes(
		css,
		'--sp-fixture-override-marker: applied',
		'theme cascade user override marker',
	);

	// 3) Cascade order: the default `:root` accent appears BEFORE the user override.
	//    Same-specificity rules ⇒ the later (theme.css) wins. This is the structural
	//    proof that theme.css loads after the default tokens, so the user value wins
	//    without touching any component (BaseLayout imports tokens.css then theme.css).
	assertOrder(
		css,
		defaultAccent,
		overrideAccent,
		'theme cascade order (tokens before theme.css)',
	);

	// 4) Dark mode is token-driven too: the dark palette is present via both the
	//    prefers-color-scheme media query and the explicit [data-theme] hook (D9).
	assertIncludes(css, 'prefers-color-scheme:dark', 'theme dark mode (OS preference)');
	assertIncludes(css, '[data-theme=dark]', 'theme dark mode (explicit hook)');

	// 5) Responsiveness: fluid type tokens use clamp() so type scales phone→desktop.
	assertIncludes(css, 'clamp(', 'theme fluid responsive type');

	console.log(
		'[verify:template] OK — user theme.css overrides default tokens (cascade: tokens→theme.css); dark + fluid tokens present.',
	);
}

/**
 * Verify the C15 SEO + sitemap (docs/DESIGN.md §5.7; FR-14, FR-23): with a site
 * URL configured in the staged fixture's data/site.json, astro.config.mjs reads it
 * at build time, sets Astro's `site`, and registers `@astrojs/sitemap`. This asserts
 * the build (still `output: 'static'`) emitted a sitemap covering BOTH a static
 * listing route (/books) and a `[...slug]` detail route (/books/dune), and that
 * BaseLayout emitted the canonical/OpenGraph tags off the site URL + page path.
 */
async function assertSeoAndSitemap(dist) {
	// 1) The sitemap files were emitted by the integration (sitemap index + the
	//    enumerated url set). @astrojs/sitemap writes sitemap-index.xml plus one or
	//    more sitemap-N.xml; the index references the url-set file.
	const indexFile = path.join(dist, 'sitemap-index.xml');
	if (!(await exists(indexFile))) {
		throw new Error(
			`Sitemap missing: expected ${indexFile} (FR-14). The sitemap integration did not run — is data/site.json's siteUrl set?`,
		);
	}
	const sitemapIndex = await readFile(indexFile, 'utf8');
	assertIncludes(sitemapIndex, '<sitemapindex', 'sitemap index root element');
	// Resolve the referenced url-set file (sitemap-0.xml by default) and read it.
	const urlSetMatch = sitemapIndex.match(/sitemap-\d+\.xml/);
	if (!urlSetMatch) {
		throw new Error('sitemap-index.xml did not reference a sitemap-N.xml url set.');
	}
	const urlSetFile = path.join(dist, urlSetMatch[0]);
	if (!(await exists(urlSetFile))) {
		throw new Error(`Sitemap url set missing: expected ${urlSetFile} (FR-14).`);
	}
	const urlSet = await readFile(urlSetFile, 'utf8');
	assertIncludes(urlSet, '<urlset', 'sitemap url-set root element');
	// The configured site URL is the origin of every <loc> (proves Astro.site wired
	// the canonical origin from data/site.json into the sitemap, not a placeholder).
	assertIncludes(urlSet, 'https://example.com/', 'sitemap uses configured site origin');
	// Coverage: a static listing route AND a `[...slug]` detail route both appear,
	// so the sitemap crawls the full statically-generated route table (FR-14). Astro
	// emits canonical <loc>s with its default trailing slash, so match that form.
	assertIncludes(urlSet, '<loc>https://example.com/books/</loc>', 'sitemap static route /books');
	assertIncludes(
		urlSet,
		'<loc>https://example.com/books/dune/</loc>',
		'sitemap [...slug] route /books/dune',
	);

	// 2) `output: 'static'` is preserved — proven structurally by dist/ being a
	//    pre-rendered static bundle (no SSR server entry). A static build emits
	//    index.html files (asserted throughout) and never a _worker.js/entry.mjs
	//    server adapter artifact at the dist root.
	for (const ssrArtifact of ['_worker.js', 'entry.mjs', 'server']) {
		if (await exists(path.join(dist, ssrArtifact))) {
			throw new Error(
				`output must stay 'static': found SSR artifact dist/${ssrArtifact} — config switched to SSR.`,
			);
		}
	}

	// 3) Canonical + OpenGraph tags (FR-23): BaseLayout emits them off Astro.site +
	//    the page path ONLY when a site URL is configured. Assert on two route types.
	const seoPages = {
		listing: [path.join(dist, 'books', 'index.html'), 'https://example.com/books/'],
		detail: [path.join(dist, 'books', 'dune', 'index.html'), 'https://example.com/books/dune/'],
	};
	for (const [label, [file, canonical]] of Object.entries(seoPages)) {
		const html = await readFile(file, 'utf8');
		assertIncludes(
			html,
			`<link rel="canonical" href="${canonical}"`,
			`${label} canonical link`,
		);
		assertIncludes(html, `property="og:url" content="${canonical}"`, `${label} og:url`);
		assertIncludes(html, 'property="og:title"', `${label} og:title`);
		assertIncludes(html, 'property="og:type" content="website"', `${label} og:type`);
	}

	console.log(
		'[verify:template] OK — sitemap.xml covers static + [...slug] routes; canonical/OG from site URL; output stayed static (FR-14/FR-23).',
	);
}

async function main() {
	const work = await mkdtemp(path.join(tmpdir(), 'specorator-template-'));
	console.log(`[verify:template] Staging template in ${work}`);
	try {
		// Stage the template, then overlay the fixture (extra route + any data).
		await cp(templateRoot, work, { recursive: true });
		if (await exists(fixtureRoot)) {
			await cp(fixtureRoot, work, { recursive: true });
		}

		await run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], work);

		const astroBin = path.join(
			work,
			'node_modules',
			'.bin',
			process.platform === 'win32' ? 'astro.cmd' : 'astro',
		);

		console.log('[verify:template] astro check');
		await run(astroBin, ['check'], work);

		console.log('[verify:template] astro build');
		await run(astroBin, ['build'], work);

		// Assert the static build emitted the template + fixture routes.
		const dist = path.join(work, 'dist');
		const indexHtml = path.join(dist, 'index.html');
		const fixtureHtml = path.join(dist, 'fixture', 'index.html');
		for (const file of [indexHtml, fixtureHtml]) {
			if (!(await exists(file))) {
				throw new Error(`Expected built static file is missing: ${file}`);
			}
		}
		const fixtureMarkup = await readFile(fixtureHtml, 'utf8');
		if (!fixtureMarkup.includes('Fixture build OK')) {
			throw new Error('Fixture route built but did not render the expected content.');
		}

		// C5: assert the snapshot-driven listing routes built from the fixture data
		// dir (test/fixtures/astro-template/data/**) with correct view, column
		// order, grouping, and one row/card/list-item per entry.
		await assertSnapshotRoutes(dist);

		// C8: assert per-entry detail pages built across the shared `[...slug]`
		// namespace, with the body rendered at core fidelity (markdown + callouts
		// + resolved wikilinks) and block-ref/Dataview degrading gracefully (D8).
		await assertDetailRoutes(dist);

		// C7: the referenced attachment placed under public/assets/ (simulating the
		// post-copy state the plugin's copier produces) is emitted into dist/, and
		// the template's missing-asset placeholder ships too (FR-16; DESIGN §5.8).
		for (const asset of ['assets/stalker-cover.png', 'assets/_missing.svg']) {
			const built = path.join(dist, ...asset.split('/'));
			if (!(await exists(built))) {
				throw new Error(`Expected copied asset missing from build output: ${built}`);
			}
		}
		console.log('[verify:template] OK — referenced assets + placeholder emitted into dist/.');

		// C9: assert the token cascade — the user-owned src/user/theme.css (overlaid
		// by the fixture with a sentinel token override) wins over the template's
		// default tokens in the built CSS, with no component edits (D9; FR-11a/NFR-7).
		await assertThemeOverrideCascade(dist);

		// C11: assert the registry precedence — a user-owned src/user/views component
		// shadows the same-named theme default via the glob-based registry barrel
		// (FR-11b/j), proven by the /showcase route rendering the user override.
		await assertRegistryPrecedence(dist);

		// C12: assert the generated-tier precedence — a transpiled vault component
		// under src/generated/views/* shadows the same-named src/user/views/* (and
		// theme), proven by the /library route rendering the generated override.
		await assertGeneratedShadows(dist);

		// C13: assert the standalone pages — the synced home page renders at / (not
		// the bundled placeholder) and a normal page (/about) renders its body with
		// a plugin-resolved wikilink (FR-12, FR-15; DESIGN §5.7).
		await assertPageRoutes(dist);

		// C14: assert the navigation — the resolved nav tree renders as a primary
		// menu on every page type with correct order/nesting, and breadcrumbs render
		// the ancestor trail on a nested route (FR-13; DESIGN §5.7).
		await assertNavigation(dist);

		// C15: assert the SEO + sitemap. With a site URL in data/site.json,
		// astro.config.mjs sets Astro's site and registers @astrojs/sitemap, so the
		// static build emits sitemap.xml covering static + [...slug] routes and
		// BaseLayout emits canonical/OG tags; output stays static (FR-14/FR-23).
		await assertSeoAndSitemap(dist);

		console.log('[verify:template] OK — astro check + build succeeded; static routes emitted.');
	} finally {
		if (keep) {
			console.log(`[verify:template] Keeping work dir: ${work}`);
		} else {
			await rm(work, { recursive: true, force: true });
		}
	}
}

await mkdir(tmpdir(), { recursive: true }).catch(() => {});
main().catch((error) => {
	console.error(`[verify:template] FAILED: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
