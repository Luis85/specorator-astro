/**
 * Pure standalone-page domain logic (FR-12, FR-15, FR-8; DESIGN §5.7, §6).
 *
 * Beyond Bases-driven collections, the site has **standalone pages**: individual
 * vault notes designated as website pages. A note is *designated* either by
 * living in the configured `Site/pages` folder OR by an opt-in frontmatter flag
 * (`site: true` / `type: page` / `page: true`). Each designated note becomes a
 * route in the shared `[...slug]` namespace; exactly one may be the **home page**
 * (`/`).
 *
 * This module keeps the page **decisions** pure (no `obsidian`, no Node, no I/O):
 *
 * - {@link isDesignatedPage} — does a note opt in, given the pages folder + its
 *   frontmatter? It uses the C12 {@link isComponentLibraryNote} leakage predicate
 *   so a component-library note can never become a page (FR-11i).
 * - {@link derivePageRoute} — the deterministic route for a designated note:
 *   `slug`/`permalink` frontmatter wins; otherwise a `normalizePath`-cleaned
 *   path/basename fallback (FR-15). Home pages collapse to `/`.
 * - {@link selectHomePage} — which designated note is the home page (`/`): an
 *   explicit `home: true` (or a route that already normalizes to `/`, e.g. an
 *   `index`/`home` basename or a `permalink: /`), else **no** home (the bundled
 *   placeholder index stays). First-wins on conflicts, deterministic.
 * - {@link buildPageNodes} — folds raw designated notes into `PageNode`s: applies
 *   designation, route derivation, and home selection, returning the nodes + any
 *   non-fatal warnings (duplicate home claims). The vault read (which notes exist,
 *   their frontmatter + body) is the page-loader adapter's job.
 *
 * The placed routes feed the global {@link buildRouteTable} so page-vs-page and
 * page-vs-collection collisions are detected in one place and page-body
 * `[[wikilinks]]` resolve against the same table.
 */

import { isComponentLibraryNote } from './component-transpile';
import type { CellValue, EntryBody, PageNode } from './types';

/** Note basenames that, absent an explicit flag, designate the home page. */
const HOME_BASENAMES = new Set(['index', 'home']);

/** Frontmatter keys whose truthiness opts a note in as a page (FR-12). */
function hasPageFlag(frontmatter: Record<string, CellValue>): boolean {
	if (frontmatter.site === true) return true;
	if (frontmatter.page === true) return true;
	const type = frontmatter.type;
	return typeof type === 'string' && type.toLowerCase() === 'page';
}

/** Frontmatter `home: true` explicitly marks a note as the home page. */
function hasHomeFlag(frontmatter: Record<string, CellValue>): boolean {
	return frontmatter.home === true;
}

/** Strip a `.md`/`.base` extension and any folders → bare basename. */
function basenameOf(path: string): string {
	const clean = path.replace(/\\/g, '/').replace(/\/+$/g, '');
	const last = clean.slice(clean.lastIndexOf('/') + 1);
	return last.replace(/\.(md|base)$/i, '');
}

/**
 * Normalize a route to a single leading slash and no trailing slash (except the
 * root `/`). Mirrors `normalizePath` cleanup for site routes (FR-15).
 */
function normalizeRoute(route: string): string {
	const trimmed = route
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? '/' : `/${trimmed}`;
}

/**
 * A note's `slug`/`permalink` frontmatter override, if present and non-blank.
 * `permalink` is checked first (more explicit, full path), then `slug`.
 */
function explicitRoute(frontmatter: Record<string, CellValue>): string | undefined {
	const permalink = frontmatter.permalink;
	if (typeof permalink === 'string' && permalink.trim() !== '') {
		return permalink;
	}
	const slug = frontmatter.slug;
	if (typeof slug === 'string' && slug.trim() !== '') {
		return slug;
	}
	return undefined;
}

/** A raw designated-page note the loader read from the vault. */
export interface RawPageNote {
	/** Vault-relative path of the note, e.g. `Site/pages/About.md`. */
	path: string;
	/** The note's raw frontmatter (JSON-serializable subset). */
	frontmatter: Record<string, CellValue>;
	/** The note body (markdown, frontmatter already stripped), or undefined. */
	body?: EntryBody;
}

/**
 * Is this note a designated website page? True when it carries an opt-in
 * frontmatter flag OR lives in the configured pages folder — and is NOT a
 * component-library note (FR-11i: components never leak as pages).
 *
 * `pagesFolder`/`libraryFolder` are the configured `Site/pages`/`Site/components`
 * paths (blank → that designation source is off; a blank pages folder means only
 * the frontmatter flag designates).
 */
export function isDesignatedPage(
	path: string,
	frontmatter: Record<string, CellValue>,
	pagesFolder: string,
	libraryFolder: string,
): boolean {
	// FR-11i: a component-library note can never become a page, even if it also
	// sits in the pages folder or carries a page flag.
	if (isComponentLibraryNote(path, libraryFolder)) {
		return false;
	}
	if (hasPageFlag(frontmatter)) {
		return true;
	}
	return isInPagesFolder(path, pagesFolder);
}

/** Is `path` inside the configured pages folder? Blank folder → never. */
function isInPagesFolder(path: string, pagesFolder: string): boolean {
	const folder = pagesFolder
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/+/g, '/');
	if (folder === '') {
		return false;
	}
	const note = path
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/+/g, '/');
	return note === folder || note.startsWith(`${folder}/`);
}

/**
 * Does this note designate itself the home page (`/`)? True when it carries an
 * explicit `home: true`, OR its explicit `slug`/`permalink` already points at the
 * root, OR (absent any explicit route) its basename is `index`/`home`.
 */
export function isHomeDesignation(
	path: string,
	frontmatter: Record<string, CellValue>,
	pagesFolder: string,
): boolean {
	if (hasHomeFlag(frontmatter)) {
		return true;
	}
	const explicit = explicitRoute(frontmatter);
	if (explicit !== undefined) {
		return normalizeRoute(explicit) === '/';
	}
	// Only a note inside the pages folder defaults to home by basename; a
	// flag-only page elsewhere must opt in explicitly via `home: true`.
	if (!isInPagesFolder(path, pagesFolder)) {
		return false;
	}
	return HOME_BASENAMES.has(basenameOf(path).toLowerCase());
}

/**
 * Derive the deterministic site route for a designated page (FR-15).
 *
 * - If the note is the home page → `/`.
 * - Else an explicit `slug`/`permalink` (normalized) wins.
 * - Else the note's path relative to the pages folder (folders preserved),
 *   slugified per segment; a flag-only page outside the folder falls back to its
 *   bare basename.
 */
export function derivePageRoute(
	path: string,
	frontmatter: Record<string, CellValue>,
	pagesFolder: string,
	isHome: boolean,
): string {
	if (isHome) {
		return '/';
	}
	const explicit = explicitRoute(frontmatter);
	if (explicit !== undefined) {
		return normalizeRoute(explicit);
	}
	const relative = pathRelativeToFolder(path, pagesFolder);
	const segments = relative
		.split('/')
		.map((seg) => slugifyPathSegment(seg.replace(/\.(md|base)$/i, '')))
		.filter((seg) => seg !== '');
	if (segments.length === 0) {
		return `/${slugifyPathSegment(basenameOf(path))}`;
	}
	return normalizeRoute(segments.join('/'));
}

/** A page's path relative to the pages folder (or its basename when outside it). */
function pathRelativeToFolder(path: string, pagesFolder: string): string {
	const folder = pagesFolder
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/+/g, '/');
	const note = path.replace(/\\/g, '/').replace(/^\/+/g, '');
	if (folder !== '' && (note === folder || note.startsWith(`${folder}/`))) {
		return note.slice(folder.length).replace(/^\/+/g, '');
	}
	// Flag-only page outside the folder: use just its basename so its route never
	// leaks its vault folder structure (which may be unrelated to the site).
	return basenameOf(note);
}

/**
 * URL-safe slug for one route segment, never collapsing to empty (a segment that
 * slugifies away falls back to `page`, mirroring routing.ts `slugifySegment`).
 */
function slugifyPathSegment(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'page'
	);
}

/** The home page for a title — frontmatter `title`, else the note basename. */
function titleOf(path: string, frontmatter: Record<string, CellValue>): string {
	const title = frontmatter.title;
	if (typeof title === 'string' && title.trim() !== '') {
		return title.trim();
	}
	return basenameOf(path);
}

/** The result of folding raw designated notes into `PageNode`s. */
export interface BuildPageNodesResult {
	/** One `PageNode` per designated note (component-library notes excluded). */
	pages: PageNode[];
	/** Non-fatal warnings (e.g. a second note claiming the home page). */
	warnings: string[];
}

/**
 * Select the home page among already-designated notes and fold every designated
 * note into a {@link PageNode} (FR-12, FR-15). Designation is decided here too:
 * non-designated and component-library notes are dropped (FR-11i).
 *
 * Home selection (documented rule): the **first** note (in input order) that
 * {@link isHomeDesignation}s claims `/`; any later home claim is demoted to its
 * own derived route with a warning, so the namespace never has two `/`s. Absent
 * any claim there is no home page and the bundled placeholder index stays.
 *
 * Routes are *preferred* routes here; cross-page/page-vs-collection collisions
 * are resolved later by {@link buildRouteTable} over the whole namespace.
 */
export function buildPageNodes(
	notes: readonly RawPageNote[],
	pagesFolder: string,
	libraryFolder: string,
): BuildPageNodesResult {
	const warnings: string[] = [];
	const pages: PageNode[] = [];
	let homeTaken = false;

	for (const note of notes) {
		if (!isDesignatedPage(note.path, note.frontmatter, pagesFolder, libraryFolder)) {
			continue;
		}
		let isHome = isHomeDesignation(note.path, note.frontmatter, pagesFolder);
		if (isHome && homeTaken) {
			warnings.push(
				`Multiple notes designate the home page; ${note.path} was demoted to its own ` +
					`route (the first home page wins).`,
			);
			isHome = false;
		}
		if (isHome) {
			homeTaken = true;
		}
		const route = derivePageRoute(note.path, note.frontmatter, pagesFolder, isHome);
		pages.push({
			path: note.path,
			route,
			title: titleOf(note.path, note.frontmatter),
			isHome,
			frontmatter: note.frontmatter,
			...(note.body !== undefined ? { body: note.body } : {}),
		});
	}

	return { pages, warnings };
}
