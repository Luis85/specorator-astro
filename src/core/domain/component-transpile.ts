/**
 * Pure **component-note transpiler** + **library leakage predicate** for the
 * vault-hosted code-fence component library (FR-11f/g/i/j; DESIGN §5.6). No I/O,
 * no `obsidian`, no Node — the vault reads and the `src/generated/` writes are
 * the adapter's thin job; the parse + transpile + path derivation are pure here.
 *
 * A **component note** is a fully Obsidian-compatible frontmatter markdown note
 * in the configured library folder. Its frontmatter carries a `component:` block
 * (`name`, `kind`, `appliesTo`, `props`) and its body holds exactly one fenced
 * ` ```astro ` block. {@link transpileComponentNote} extracts that block as the
 * template and produces the **contents of a real `.astro` file** under
 * `src/generated/` (the block written **verbatim**, with a generated props
 * comment + destructure prepended from the declared `props`) plus the target
 * project-relative path. The transpiled module is what Vite/Node executes at
 * build time — gated by one-time consent (see {@link ./consent}); this module
 * only decides *what* would be emitted, never *whether* (that is the gate).
 *
 * **Skipped, never thrown (FR-11g robustness):** a note that is not a
 * well-formed component — no `component:` frontmatter, missing `name`, not
 * exactly one ` ```astro ` fence, malformed metadata — yields a `skipped` result
 * with a reason. The adapter simply does not emit anything for it; it never
 * crashes the sync. Combined with {@link isComponentLibraryNote} (FR-11i), this
 * guarantees a stray note in the library folder neither becomes a generated
 * component nor leaks as a website page.
 */

import type { RegistryTier } from './registry';

/** The library component kinds (DESIGN §5.6): a view, a layout, or a partial. */
export type ComponentKind = 'view' | 'layout' | 'partial';

/** The recognized component kinds, used to validate the `kind` frontmatter. */
const COMPONENT_KINDS: readonly ComponentKind[] = ['view', 'layout', 'partial'];

/** The generated-tier subdirectory a kind transpiles into (under `src/generated/`). */
const KIND_DIR: Record<ComponentKind, string> = {
	view: 'views',
	layout: 'layouts',
	partial: 'components',
};

/**
 * The `component:` frontmatter metadata extracted from a component note. `name`
 * is the registry name (required); the rest are advisory (typing/docs) — only
 * `name`, `kind`, and the declared `props` shape what is emitted.
 */
export interface ComponentMeta {
	/** Registry name; becomes the generated `.astro` basename. */
	name: string;
	/** view | layout | partial (defaults to `view` when absent/unknown). */
	kind: ComponentKind;
	/** Base view types this applies to, or `page`/`layout` (advisory). */
	appliesTo: string[];
	/** Declared input prop names (drives the generated destructure). */
	props: string[];
}

/** A successful transpile: the generated file's project-relative path + contents. */
export interface TranspiledComponent {
	outcome: 'transpiled';
	/** The parsed component metadata. */
	meta: ComponentMeta;
	/**
	 * Project-relative path of the generated `.astro` file, e.g.
	 * `src/generated/views/BookCard.astro`. The `generated` tier shadows `user`
	 * and `theme` of the same name (FR-11j).
	 */
	path: string;
	/** The full `.astro` source to write (props script prepended, block verbatim). */
	contents: string;
}

/** A note that is not a well-formed component note (skipped, never an error). */
export interface SkippedNote {
	outcome: 'skipped';
	/** Why it was skipped (for an optional build/log warning). */
	reason: string;
}

/** The result of attempting to transpile one note. */
export type TranspileResult = TranspiledComponent | SkippedNote;

/** The registry tier the transpiler targets (so callers can reason about precedence). */
export const TRANSPILE_TIER: RegistryTier = 'generated';

function skip(reason: string): SkippedNote {
	return { outcome: 'skipped', reason };
}

/**
 * Split a note's raw markdown into its YAML frontmatter block (between the
 * leading `---` fences) and the remaining body. Returns `null` for the
 * frontmatter when the note has none. Tolerant of a leading BOM / blank lines.
 */
function splitFrontmatter(raw: string): { frontmatter: string | null; body: string } {
	const text = raw.replace(/^\uFEFF/, '');
	// Frontmatter must start at the very top (after optional leading newlines).
	const match = /^[\s]*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(text);
	if (match === null) {
		return { frontmatter: null, body: text };
	}
	return { frontmatter: match[1], body: match[2] ?? '' };
}

/**
 * Extract the value of the `component:` mapping from a YAML frontmatter block.
 * Returns the raw indented lines under `component:` (a block-style mapping). The
 * parser is intentionally small — it only understands the flat scalar / inline
 * list shapes the DESIGN §5.6 example uses (`name:`, `kind:`, `appliesTo: [..]`,
 * `props: [..]`), not arbitrary YAML — and degrades to `skipped` on anything it
 * cannot read, so a malformed note never crashes the build (FR-11g).
 */
function extractComponentBlock(frontmatter: string): string[] | null {
	const lines = frontmatter.split(/\r?\n/);
	const startIndex = lines.findIndex((line) => /^component\s*:\s*$/.test(line));
	if (startIndex === -1) {
		// Allow `component:` with no inline value only; an inline value (e.g.
		// `component: foo`) is not the mapping shape we support.
		return null;
	}
	const block: string[] = [];
	for (let i = startIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '') {
			block.push(line);
			continue;
		}
		// A non-indented line ends the `component:` mapping (a sibling top-level key).
		if (!/^\s/.test(line)) {
			break;
		}
		block.push(line);
	}
	return block;
}

/** Parse a YAML inline list (`[a, b]`) or a single scalar into a string array. */
function parseList(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed === '') {
		return [];
	}
	const inner = /^\[(.*)\]$/.exec(trimmed);
	const body = inner ? inner[1] : trimmed;
	return body
		.split(',')
		.map((item) => stripQuotes(item.trim()))
		.filter((item) => item !== '');
}

/** Strip a single pair of matching surrounding quotes from a scalar. */
function stripQuotes(value: string): string {
	const match = /^(['"])(.*)\1$/.exec(value);
	return match ? match[2] : value;
}

/** Read a `key: value` scalar from the indented component block lines, or null. */
function readScalar(block: readonly string[], key: string): string | null {
	const re = new RegExp(`^\\s+${key}\\s*:\\s*(.*)$`);
	for (const line of block) {
		const match = re.exec(line);
		if (match !== null) {
			// Drop a trailing inline comment (`# ...`) outside quotes — the DESIGN
			// example annotates fields inline.
			return stripInlineComment(match[1]).trim();
		}
	}
	return null;
}

/** Drop an unquoted trailing `# comment`, preserving `#` inside quotes/brackets. */
function stripInlineComment(value: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === '#' && !inSingle && !inDouble) {
			return value.slice(0, i);
		}
	}
	return value;
}

/** Coerce a raw `kind` scalar to a known {@link ComponentKind}, defaulting to view. */
function parseKind(raw: string | null): ComponentKind {
	const value = (raw ?? '').trim() as ComponentKind;
	return COMPONENT_KINDS.includes(value) ? value : 'view';
}

/**
 * A component `name` is used **verbatim** as the generated `.astro` basename and
 * flows into the filesystem path the adapter writes (`src/generated/<dir>/<name>.astro`).
 * It MUST therefore be a single, safe path segment: no `/`, no `\`, no `..`, no
 * separators of any kind. We accept only `[A-Za-z0-9_-]` so a hostile note (e.g.
 * `name: ../../../../src/user/Layout`) can never escape the generated tier and
 * clobber hand-written `src/user/` files or project config (NFR-9, the
 * generated-tier-only invariant + the consent disclosure). Slugging is *not* an
 * option here: two distinct names could slug to the same file and silently
 * shadow each other, so we skip instead.
 */
const SAFE_COMPONENT_NAME = /^[A-Za-z0-9_-]+$/;

/**
 * Parse the `component:` frontmatter into {@link ComponentMeta}, or `null` if the
 * note has no usable `component:` mapping or no `name`. Total + tolerant.
 */
export function parseComponentMeta(frontmatter: string): ComponentMeta | null {
	const block = extractComponentBlock(frontmatter);
	if (block === null) {
		return null;
	}
	const name = stripQuotes((readScalar(block, 'name') ?? '').trim());
	if (name === '') {
		return null;
	}
	return {
		name,
		kind: parseKind(readScalar(block, 'kind')),
		appliesTo: parseList(readScalar(block, 'appliesTo') ?? ''),
		props: parseList(readScalar(block, 'props') ?? ''),
	};
}

/**
 * Extract the single fenced ` ```astro ` block's inner contents from a note body.
 * Returns `null` when there is not **exactly one** such fence (zero → the note is
 * not a component; more than one → ambiguous, FR-11g skips it). The closing fence
 * is the matching ` ``` ` at the start of a line.
 */
export function extractAstroFence(body: string): string | null {
	// Match an opening ```astro (optionally with trailing whitespace) on its own
	// line, capture until the closing ``` on its own line. Use a global scan to
	// count fences so >1 is rejected as ambiguous.
	const fenceRe = /(^|\n)[ \t]*```astro[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?=\n|$)/g;
	let match: RegExpExecArray | null;
	const blocks: string[] = [];
	while ((match = fenceRe.exec(body)) !== null) {
		blocks.push(match[2]);
	}
	if (blocks.length !== 1) {
		return null;
	}
	return blocks[0];
}

/**
 * Generate the props destructure prepended to the transpiled component. Astro
 * components read inputs from `Astro.props`; we add a small generated comment +
 * (when props are declared) a destructure so the authored block can use the
 * declared names. This is **prepended**, the authored block follows **verbatim**.
 *
 * Crucially the generated script does NOT add a second frontmatter fence: if the
 * authored block already opens with its own `---` script, our generated lines
 * are merged into that script; otherwise we emit a standalone script fence. Both
 * keep the authored code byte-for-byte intact inside the result.
 */
function buildPropsScript(meta: ComponentMeta): string {
	const header = `// Generated from the vault component note "${meta.name}" (kind: ${meta.kind}).\n// DO NOT EDIT — regenerated from the library on sync (DESIGN §5.6, FR-11g).`;
	if (meta.props.length === 0) {
		return header;
	}
	// A defensive destructure: pull declared props off Astro.props so the authored
	// block can reference them. Authored code may re-destructure; that is fine.
	const names = meta.props.join(', ');
	return `${header}\nconst { ${names} } = Astro.props as Record<string, unknown>;`;
}

/**
 * Compose the generated `.astro` source: the props script, then the authored
 * fenced block **verbatim**. If the authored block already starts with its own
 * `---` frontmatter script, the generated lines are inserted at the top of that
 * script (so there is exactly one script fence). Otherwise we wrap the generated
 * lines in their own `---` script fence above the markup.
 */
function composeAstro(meta: ComponentMeta, fence: string): string {
	const script = buildPropsScript(meta);
	const leading = /^\s*---\r?\n/.exec(fence);
	if (leading !== null) {
		// Authored block opens with a frontmatter script: splice our lines in after
		// the opening `---`, leaving the rest of the authored source untouched.
		const insertAt = leading.index + leading[0].length;
		return `${fence.slice(0, insertAt)}${script}\n${fence.slice(insertAt)}`;
	}
	// No authored script fence: emit our generated script, then the authored block.
	return `---\n${script}\n---\n${fence}`;
}

/** The generated path for a component (`src/generated/<dir>/<Name>.astro`). */
export function generatedPath(meta: ComponentMeta): string {
	return `src/generated/${KIND_DIR[meta.kind]}/${meta.name}.astro`;
}

/**
 * Transpile one component note's **raw markdown** into a generated `.astro` file
 * (its project-relative path + contents), or skip it with a reason if it is not
 * a well-formed component note (FR-11g — never throws). The authored fenced
 * block is written **verbatim**; a generated props comment/destructure is
 * prepended. This is the pure half; the adapter does the vault read + the
 * `src/generated/` write, only when consent is granted (the hard gate).
 */
export function transpileComponentNote(raw: string): TranspileResult {
	const { frontmatter, body } = splitFrontmatter(raw);
	if (frontmatter === null) {
		return skip('no frontmatter; not a component note');
	}
	const meta = parseComponentMeta(frontmatter);
	if (meta === null) {
		return skip('no usable component: frontmatter (missing component block or name)');
	}
	// Path-traversal guard (NFR-9): the name becomes the generated `.astro`
	// basename on disk, so reject anything that is not a single safe segment
	// before it can reach the filesystem path the adapter writes. Skip (never
	// throw, never slug) so a hostile or malformed note can neither escape the
	// generated tier nor silently collide with another component.
	if (!SAFE_COMPONENT_NAME.test(meta.name)) {
		return skip(
			`component name "${meta.name}" must be a single path segment ([A-Za-z0-9_-]); skipping`,
		);
	}
	const fence = extractAstroFence(body);
	if (fence === null) {
		return skip('expected exactly one ```astro code-fence block');
	}
	return {
		outcome: 'transpiled',
		meta,
		path: generatedPath(meta),
		contents: composeAstro(meta, fence),
	};
}

/**
 * Normalize a vault folder path to a trailing-slash-free, leading-slash-free,
 * forward-slash form for prefix comparison. (`normalizePath` proper is an
 * Obsidian adapter concern; this pure helper only needs consistent separators.)
 */
function normalizeFolder(folder: string): string {
	return folder
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+|\/+$/g, '')
		.replace(/\/+/g, '/');
}

/**
 * **Leakage predicate (FR-11i):** is this note path inside the configured
 * component-library folder? Pure + total. Page detection (C13) MUST exclude
 * notes for which this returns `true`, so a component note never becomes a
 * website page. Matches the folder itself and anything beneath it, case- and
 * separator-tolerant; an empty/blank library folder matches nothing (so leakage
 * exclusion is opt-in via a configured folder, never accidental).
 */
export function isComponentLibraryNote(notePath: string, libraryFolder: string): boolean {
	const folder = normalizeFolder(libraryFolder);
	if (folder === '') {
		return false;
	}
	const note = normalizeFolder(notePath);
	return note === folder || note.startsWith(`${folder}/`);
}
