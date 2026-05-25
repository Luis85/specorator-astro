/**
 * Pure `[[wikilink]]` resolver for note bodies (FR-15, D8; DESIGN §5.7, §6).
 *
 * Astro has no built-in Obsidian-wikilink resolver, and DESIGN §5.7 is explicit
 * that `[[wikilinks]]` are resolved **in the harvester/loader against the route
 * table, NOT at render time**. So before a snapshot body is written, the
 * harvester runs it through this function with the route table's
 * {@link RouteResolver}: on-site links become standard markdown links to their
 * routes; off-site (unpublished) links become **styled, non-clickable "not
 * published" text** — an inline `<span class="sp-unpublished">` the body
 * renderer passes through untouched and the theme styles (FR-24, D17;
 * DESIGN §5.7). Off-site targets are **NEVER** auto-published: the resolver only
 * ever maps a link to a route the route table already placed, so an off-site
 * link can never add a page or leak a private note (privacy-safe).
 *
 * **Scope (D8).** This rewrites only `[[wikilinks]]` (and their `|alias` form).
 * Image embeds (`![[…]]`) are the asset pipeline's job (C7) and are left
 * untouched here. **Block refs, transclusions, and Dataview are explicitly out
 * of scope** and MUST degrade gracefully — never throw: a `[[note#^block]]`
 * keeps its display text, a `![[note]]` transclusion is left as-is for the
 * markdown renderer, and a ` ```dataview ``` ` fence passes straight through.
 *
 * It is **pure**: no `obsidian`, no Node, no I/O. The route resolution is an
 * injected function, so it is unit-testable with an in-memory fake.
 */

import type { RouteResolver } from './route-table';

/**
 * Matches an Obsidian internal link `[[target]]` or `[[target|alias]]`,
 * capturing the target and the optional alias. It deliberately does **not**
 * match an image embed `![[…]]` (the leading `!` is excluded via a negative
 * look-behind-free guard in {@link resolveWikilinks}), so embeds are left to the
 * asset pipeline. The target may include a `#subpath`/`#^block-ref`, kept in the
 * capture so it can be split off (and ignored for routing — block refs are out
 * of scope, D8).
 */
const WIKILINK = /(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

/** An off-site `[[wikilink]]` the resolver rendered as "not published" text. */
export interface OffSiteLink {
	/** The link target as written (sub-path stripped), e.g. `Private Note`. */
	target: string;
	/** The visible text rendered (the alias, else the target). */
	text: string;
}

/**
 * Rewrite a body's `[[wikilinks]]` against the injected {@link RouteResolver}.
 *
 * For each `[[target|alias]]`:
 * - an `![[…]]` embed is left untouched (asset pipeline / transclusion — D8);
 * - the target's `#subpath`/`#^block` is split off and ignored for routing
 *   (block refs are out of scope, D8) — the display text is preserved;
 * - if the (sub-path-stripped) target resolves to a route → `[text](route)`;
 * - otherwise the target is **off-site / unpublished** (FR-24, D17): it renders
 *   as a styled, non-clickable `<span class="sp-unpublished">` "not published"
 *   marker (raw HTML the body renderer passes through and the theme styles), and
 *   is reported to the optional `onOffSite` sink so the build can surface a
 *   warning. The off-site target is **never** added to any route table or
 *   include set — the resolver only ever maps to routes already placed.
 *
 * Returns the rewritten markdown. The optional `onOffSite` callback keeps this
 * function **pure** (it performs no I/O); the caller collects off-site links.
 */
export function resolveWikilinks(
	markdown: string,
	resolve: RouteResolver,
	onOffSite?: (link: OffSiteLink) => void,
): string {
	return markdown.replace(WIKILINK, (match, bang: string, rawTarget: string, alias?: string) => {
		// `![[…]]` is an embed/transclusion — not our concern here (C7/D8).
		if (bang === '!') {
			return match;
		}

		// Split off a `#subpath` / `#^block-ref` — out of scope for routing (D8);
		// we route to the note itself and keep the human-readable display text.
		const hashAt = rawTarget.indexOf('#');
		const pathPart = hashAt === -1 ? rawTarget : rawTarget.slice(0, hashAt);
		const subpath = hashAt === -1 ? '' : rawTarget.slice(hashAt + 1);

		const target = pathPart.trim();
		const display = pickDisplayText(alias, target, subpath);

		// A bare `[[#^block]]` (no note target) is a same-note block ref — out of
		// scope; degrade to its display text rather than emitting a broken link.
		if (target === '') {
			return display;
		}

		const route = resolve(target);
		if (route === null) {
			// Off-site / unpublished (FR-24, D17): render styled, non-clickable "not
			// published" text and report it — but NEVER publish the target.
			onOffSite?.({ target, text: display });
			return unpublishedMarkup(display, target);
		}
		// The capturing regex excludes `[`, `]`, and `|` from the target/alias, so
		// the display text can never contain a `]` that would break the link label.
		return `[${display}](${route})`;
	});
}

/**
 * Inline raw-HTML "not published" marker for an off-site link (FR-24, D17). It
 * is a `<span class="sp-unpublished">` — NOT an `<a href>` — so the link is
 * visibly distinct but non-clickable; the body renderer (remark-rehype with raw
 * HTML allowed + rehype-raw) passes it straight through, and the theme styles it.
 * The original target rides along in `title`/`data-` for inspection, with all
 * text and attribute values HTML-escaped (the target may contain `<`, `&`, `"`).
 */
function unpublishedMarkup(display: string, target: string): string {
	const text = escapeHtml(display);
	const attr = escapeHtml(target);
	return (
		`<span class="sp-unpublished" data-unpublished-link="${attr}" ` +
		`title="Not published: ${attr}">${text}</span>`
	);
}

/** Escape text/attribute content for safe inline raw-HTML emission. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Choose the link's visible text: an explicit alias, else the target (+subpath). */
function pickDisplayText(alias: string | undefined, target: string, subpath: string): string {
	if (alias !== undefined && alias.trim() !== '') {
		return alias.trim();
	}
	const base = target.trim();
	const sub = subpath.replace(/^\^/, '');
	if (subpath === '') {
		return base;
	}
	// A same-note ref (`[[#^block]]`) has no base, so don't prefix a stray ` > `.
	return base === '' ? sub : `${base} > ${sub}`;
}
