import { TFile, normalizePath, parseYaml, type App } from 'obsidian';
import { toBody } from '../core/domain/harvest-mapping';
import { isComponentLibraryNote } from '../core/domain/component-transpile';
import type { CellValue } from '../core/domain/types';
import type { RawPageNote } from '../core/domain/pages';
import type { PageLoaderPort } from '../core/ports';

/**
 * Frontmatter keys whose truthiness opts a note in as a standalone page (FR-12).
 * Mirrors the pure `hasPageFlag` predicate in `core/domain/pages.ts` so the
 * adapter's pre-filter matches exactly what the pure core will re-decide. (The
 * core is canonical; this is only a *candidate* filter for efficiency.)
 */
function hasPageFlag(frontmatter: Record<string, unknown>): boolean {
	if (frontmatter.site === true) return true;
	if (frontmatter.page === true) return true;
	const type = frontmatter.type;
	return typeof type === 'string' && type.toLowerCase() === 'page';
}

/**
 * Reads candidate standalone-page notes from the vault (FR-12; DESIGN §5.7).
 *
 * The thin I/O half of standalone pages: the pure `buildPageNodes` /
 * `isDesignatedPage` decide *which* notes are designated pages, their routes,
 * and the home selection; this adapter only supplies the raw candidate notes.
 * It scans markdown notes via the Vault API and, as an efficiency pre-filter,
 * keeps only notes that either live in the configured pages folder OR carry an
 * opt-in frontmatter flag (`site:true`/`type:page`/`page:true`) — and never a
 * component-library note (FR-11i: components can't leak as pages). Designation
 * is ultimately re-decided by the pure core, so supplying a superset is
 * harmless; this pre-filter just avoids reading every note in the vault.
 *
 * Per candidate it reads frontmatter (the metadata cache, falling back to
 * `parseYaml` of the raw markdown) and the body (`cachedRead` + the shared
 * `toBody`, which strips the frontmatter block). Wikilinks in the body are
 * resolved later, globally, against the route table (`SyncSite`); this only
 * ships raw markdown.
 */
export class PageLoaderAdapter implements PageLoaderPort {
	constructor(
		private readonly app: App,
		private readonly readPagesFolder: () => string,
		private readonly readLibraryFolder: () => string,
	) {}

	async loadPages(): Promise<RawPageNote[]> {
		const pagesFolder = normalizePath(this.readPagesFolder());
		const libraryFolder = this.readLibraryFolder();
		const notes: RawPageNote[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!(file instanceof TFile)) continue;
			// FR-11i: a component-library note can never become a page; skip it up
			// front (the pure core enforces this too, but skipping avoids a read).
			if (isComponentLibraryNote(file.path, libraryFolder)) continue;

			// A note in the pages folder is always a candidate without a read; a note
			// elsewhere needs its frontmatter flag, so only those require a read.
			const inFolder = isInFolder(file.path, pagesFolder);
			const cachedFrontmatter = this.cachedFrontmatter(file);
			if (!inFolder && cachedFrontmatter !== null && !hasPageFlag(cachedFrontmatter)) {
				continue;
			}

			let raw: string;
			try {
				raw = await this.app.vault.cachedRead(file);
			} catch {
				// Unreadable note → skip it entirely (never fatal). A note we can't
				// read has no frontmatter/body to contribute.
				continue;
			}

			// Frontmatter: prefer the parsed metadata cache; fall back to parsing the
			// raw markdown's leading `---` block (e.g. a freshly created note the
			// cache hasn't indexed yet).
			const frontmatter = cachedFrontmatter ?? parseFrontmatter(raw);

			// Re-check the flag once the (possibly freshly parsed) frontmatter is in
			// hand, so a flagged-but-uncached note outside the folder still counts.
			if (!inFolder && !hasPageFlag(frontmatter)) continue;

			const body = toBody(raw);
			notes.push({
				path: file.path,
				frontmatter: toCellValueRecord(frontmatter),
				...(body !== undefined ? { body } : {}),
			});
		}

		// Stable order so the page set + home selection are deterministic.
		notes.sort((a, b) => a.path.localeCompare(b.path));
		return notes;
	}

	/**
	 * The note's frontmatter from Obsidian's parsed metadata cache, or `null` when
	 * the cache has none yet (caller falls back to parsing the raw markdown).
	 */
	private cachedFrontmatter(file: TFile): Record<string, unknown> | null {
		const cached = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return cached ?? null;
	}
}

/**
 * Parse a note's leading YAML frontmatter block (`---` … `---`) with `parseYaml`,
 * returning `{}` for a note with no/empty/malformed block (degrades gracefully —
 * never throws). Used only as a fallback when the metadata cache has no entry.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	if (match === null) return {};
	try {
		const parsed: unknown = parseYaml(match[1]);
		return typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** Is `path` the folder itself or nested under it? Blank folder → never. */
function isInFolder(path: string, folder: string): boolean {
	const clean = folder.replace(/^\/+|\/+$/g, '');
	if (clean === '') return false;
	const note = path.replace(/^\/+/, '');
	return note === clean || note.startsWith(`${clean}/`);
}

/**
 * Narrow Obsidian's loosely-typed frontmatter record to the JSON-serializable
 * {@link CellValue} subset the pure core consumes. Scalars and string arrays
 * are kept as-is; anything else is coerced to its string form (so a date/object
 * still yields a usable title/route hint rather than leaking a non-serializable
 * value into the committed page set).
 */
function toCellValueRecord(raw: Record<string, unknown>): Record<string, CellValue> {
	const out: Record<string, CellValue> = {};
	for (const [key, value] of Object.entries(raw)) {
		out[key] = toCellValue(value);
	}
	return out;
}

function toCellValue(value: unknown): CellValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(scalarString);
	}
	return scalarString(value);
}

/**
 * String form of a non-CellValue frontmatter value. A `Date`-like value uses its
 * ISO/locale string; a plain object is JSON-stringified (never the useless
 * `[object Object]`); everything else uses `String(...)`.
 */
function scalarString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return '';
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'symbol') return value.toString();
	if (typeof value === 'function') return '';
	try {
		return JSON.stringify(value);
	} catch {
		return '';
	}
}
