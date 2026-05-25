/**
 * Pure asset-reference resolver (FR-16; DESIGN §5.8).
 *
 * Card covers (`note.cover`), image-typed entry values, and `![[embeds]]` point
 * at **vault attachments**. Before the build can show them, the harvester must
 * copy each referenced attachment into the Astro project's `public/` and rewrite
 * the reference to the public URL it lands at. This module owns the *pure* half
 * of that pipeline:
 *
 * - **normalize** a raw reference (a vault-relative path, or the inner target of
 *   an `![[embed|alt]]`/wikilink-embed) into a clean vault source path, and
 * - derive a **stable, percent-safe public URL** under `/assets/…` for it,
 * - **dedupe** so the same source always maps to the same URL, and
 * - **disambiguate** basename collisions (two different sources sharing a
 *   basename get distinct URLs).
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The metadata-cache lookup that
 * turns a wiki target into a concrete vault file, the content hashing, and the
 * file copy all live in an adapter behind a port; this module only decides the
 * mapping. The actual copy is driven from the manifest this resolver produces.
 */

/** A reference rewritten to a public URL, plus the source to copy. */
export interface ResolvedAsset {
	/** Normalized vault-relative source path (forward slashes, no `![[ ]]`). */
	sourcePath: string;
	/** Stable public URL the build serves the copied asset at (`/assets/…`). */
	url: string;
}

/** Image file extensions an entry value is treated as a card cover / image. */
const IMAGE_EXTENSIONS: readonly string[] = [
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'avif',
	'bmp',
	'ico',
];

/**
 * Whether a raw value looks like a vault **image** reference worth resolving as
 * a card cover / image-typed cell (FR-16, MVP per D7): an `![[embed]]` of an
 * image, or a vault-relative path ending in an image extension. Already-public
 * (`/assets/…`) and remote (`http(s)://`, `data:`) refs are not vault sources
 * to copy, so they are not flagged. Used by the harvester to decide which entry
 * values to route through the asset pipeline; non-image text is left untouched.
 */
export function isImageReference(value: unknown): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	const trimmed = value.trim();
	if (trimmed === '') {
		return false;
	}
	// Remote / already-public references are not copyable vault sources.
	if (/^(?:[a-z]+:)?\/\//i.test(trimmed) || /^data:/i.test(trimmed) || trimmed.startsWith('/')) {
		return false;
	}
	const source = normalizeReference(trimmed);
	if (source === null) {
		return false;
	}
	const base = source.slice(source.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	if (dot <= 0) {
		return false;
	}
	return IMAGE_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

/**
 * Accumulates resolved assets across many references so the same source maps to
 * one URL (dedupe) and distinct sources never share a URL (collision-safe).
 *
 * Construct one per snapshot/sync; feed it each reference via {@link resolve}.
 * It tracks two indices: `bySource` (dedupe — second sighting of a source
 * returns the URL chosen the first time) and `usedUrls` (collision — a new
 * source whose preferred URL is taken gets a numbered variant). Both keep the
 * resolver pure: state is held in the instance, not in module-level globals.
 */
export class AssetResolver {
	/** source path → already-chosen URL (dedupe). */
	private readonly bySource = new Map<string, string>();
	/** URLs already handed out (collision detection). */
	private readonly usedUrls = new Set<string>();

	/** Public URL path prefix; every asset URL is `${prefix}/<name>`. */
	private readonly prefix: string;

	constructor(prefix = '/assets') {
		// Normalize to a single leading slash and no trailing slash.
		this.prefix = `/${prefix.replace(/^\/+|\/+$/g, '')}`;
	}

	/**
	 * Resolve a raw reference to a {@link ResolvedAsset}, or `null` when the
	 * reference is empty / not an asset (so the caller leaves the value as-is).
	 *
	 * - Strips an `![[ ... ]]` / `[[ ... ]]` embed wrapper and any `| alias` or
	 *   `# subpath` suffix, keeping only the target path.
	 * - Returns `null` for an empty/whitespace-only reference.
	 * - Dedupes: the same normalized source always yields the same URL.
	 * - Disambiguates: a *different* source whose preferred URL is taken gets a
	 *   numbered URL (`name.png` → `name-1.png`).
	 */
	resolve(reference: string): ResolvedAsset | null {
		const sourcePath = normalizeReference(reference);
		if (sourcePath === null) {
			return null;
		}

		const existing = this.bySource.get(sourcePath);
		if (existing !== undefined) {
			return { sourcePath, url: existing };
		}

		const url = this.assignUrl(sourcePath);
		this.bySource.set(sourcePath, url);
		this.usedUrls.add(url);
		return { sourcePath, url };
	}

	/**
	 * The deduped manifest of every asset resolved so far, in first-seen order:
	 * `{ source, url }[]`. This is exactly the copy list — the adapter copies
	 * each `source` to `url` under `public/` (missing sources skipped, FR-16).
	 */
	manifest(): { source: string; url: string }[] {
		return [...this.bySource.entries()].map(([source, url]) => ({ source, url }));
	}

	/** Choose a fresh, percent-safe URL for a source, disambiguating collisions. */
	private assignUrl(sourcePath: string): string {
		const base = publicBasename(sourcePath);
		const dot = base.lastIndexOf('.');
		const stem = dot > 0 ? base.slice(0, dot) : base;
		const ext = dot > 0 ? base.slice(dot) : '';

		let candidate = `${this.prefix}/${stem}${ext}`;
		let n = 1;
		while (this.usedUrls.has(candidate)) {
			candidate = `${this.prefix}/${stem}-${String(n)}${ext}`;
			n += 1;
		}
		return candidate;
	}
}

/**
 * Normalize one raw reference into a clean vault-relative source path, or `null`
 * when it is empty or not a usable reference.
 *
 * Handles: `![[img.png]]`, `[[img.png|alt]]`, `![[folder/img.png#anchor]]`,
 * surrounding whitespace, leading `./`, and collapses `\` → `/`. Aliases (`|…`)
 * and subpaths (`#…`) are display/anchor hints, not part of the file path, so
 * they are dropped.
 */
export function normalizeReference(reference: string): string | null {
	let s = reference.trim();
	if (s === '') {
		return null;
	}

	// Strip an embed/wikilink wrapper: `![[target]]` or `[[target]]`.
	const wiki = /^!?\[\[(.*)\]\]$/.exec(s);
	if (wiki) {
		s = wiki[1].trim();
	}

	// Drop an alias (`target|alias`) and a subpath/anchor (`target#heading`).
	s = s.split('|')[0];
	s = s.split('#')[0];

	// Normalize separators and strip a leading `./` and any leading slashes.
	s = s.replace(/\\/g, '/').trim();
	s = s.replace(/^\.\//, '').replace(/^\/+/, '');

	// Collapse `a//b` and resolve no-op `.` segments; reject if nothing remains.
	const segments = s.split('/').filter((seg) => seg !== '' && seg !== '.');
	if (segments.length === 0) {
		return null;
	}
	return segments.join('/');
}

/**
 * Percent-safe basename for the public URL segment: the source's final path
 * segment, lower-cased and stripped of characters unsafe/awkward in a URL path.
 * Runs of unsafe characters collapse to a single `-`; the extension is kept.
 */
function publicBasename(sourcePath: string): string {
	const segments = sourcePath.split('/');
	const raw = segments[segments.length - 1];
	const dot = raw.lastIndexOf('.');
	const stem = dot > 0 ? raw.slice(0, dot) : raw;
	const ext = dot > 0 ? raw.slice(dot) : '';

	const safeStem =
		stem
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'asset';
	const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]+/g, '');
	return `${safeStem}${safeExt}`;
}

/** Why an asset could not be resolved to a copyable file (graceful degradation). */
export type AssetMissReason = 'not-found' | 'too-large';

/** The decision for one referenced asset that could not be copied as-is. */
export interface AssetDegradation {
	/** What went wrong (drives the build warning + placeholder). */
	reason: AssetMissReason;
	/** Human-readable warning the build surfaces (never fatal). */
	warning: string;
	/** The placeholder URL the page renders instead of the missing asset. */
	placeholderUrl: string;
}

/** Inputs to the graceful-degradation decision for a single resolved asset. */
export interface AssetAvailability {
	/** The asset's normalized source path (for the warning message). */
	sourcePath: string;
	/** Whether the source file actually exists in the vault. */
	exists: boolean;
	/** Source size in bytes, when known (omit/`undefined` if unknown). */
	sizeBytes?: number;
	/** Optional max size in bytes; over it → `too-large` (skip copy, warn). */
	maxSizeBytes?: number;
}

/** The stable public URL used to render any unavailable asset (FR-16). */
export const PLACEHOLDER_ASSET_URL = '/assets/_missing.svg';

/**
 * Pure "copy this asset, or degrade it?" decision (FR-16; DESIGN §5.8). A
 * missing or oversized attachment must **never fail the build** — instead it
 * renders a placeholder and the build logs a warning. Returns `null` when the
 * asset is fine to copy as-is; otherwise the degradation to apply.
 *
 * Keeping this pure lets the adapter `stat` the file (I/O) and then ask core
 * what to do, so the policy (and its messages) are unit-tested without a vault.
 */
export function decideAssetAvailability(input: AssetAvailability): AssetDegradation | null {
	if (!input.exists) {
		return missingAsset(input.sourcePath);
	}
	if (
		input.maxSizeBytes !== undefined &&
		input.sizeBytes !== undefined &&
		input.sizeBytes > input.maxSizeBytes
	) {
		return {
			reason: 'too-large',
			warning:
				`Referenced attachment is too large to copy (${String(input.sizeBytes)} bytes > ` +
				`${String(input.maxSizeBytes)} bytes): ${input.sourcePath} — rendering a placeholder.`,
			placeholderUrl: PLACEHOLDER_ASSET_URL,
		};
	}
	return null;
}

/**
 * The degradation for an attachment that could not be located in the vault — the
 * common "missing" outcome, always non-null (unlike {@link decideAssetAvailability},
 * which is null when the asset is fine). Renders a placeholder + a build warning.
 */
export function missingAsset(sourcePath: string): AssetDegradation {
	return {
		reason: 'not-found',
		warning: `Referenced attachment not found in vault: ${sourcePath} — rendering a placeholder.`,
		placeholderUrl: PLACEHOLDER_ASSET_URL,
	};
}
