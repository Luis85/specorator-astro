/**
 * Pure `[[wikilink]]` resolver for note bodies (FR-15, D8; DESIGN §5.7, §6).
 *
 * Astro has no built-in Obsidian-wikilink resolver, and DESIGN §5.7 is explicit
 * that `[[wikilinks]]` are resolved **in the harvester/loader against the route
 * table, NOT at render time**. So before a snapshot body is written, the
 * harvester runs it through this function with the route table's
 * {@link RouteResolver}: on-site links become standard markdown links to their
 * routes; off-site links degrade gracefully (left as plain text now — C16 owns
 * the styled "not published" treatment).
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

/**
 * Rewrite on-site `[[wikilinks]]` in `markdown` to standard markdown links to
 * their site routes, using the injected {@link RouteResolver}. Returns the
 * rewritten markdown.
 *
 * For each `[[target|alias]]`:
 * - an `![[…]]` embed is left untouched (asset pipeline / transclusion — D8);
 * - the target's `#subpath`/`#^block` is split off and ignored for routing
 *   (block refs are out of scope, D8) — the display text is preserved;
 * - if the (sub-path-stripped) target resolves to a route → `[text](route)`;
 * - otherwise the link is left as plain `[[…]]`/its display text, so an
 *   off-site or unpublished link degrades gracefully (never a build failure).
 */
export function resolveWikilinks(markdown: string, resolve: RouteResolver): string {
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
			// Off-site / unpublished — degrade gracefully (plain text). C16 styles it.
			return display;
		}
		// The capturing regex excludes `[`, `]`, and `|` from the target/alias, so
		// the display text can never contain a `]` that would break the link label.
		return `[${display}](${route})`;
	});
}

/** Choose the link's visible text: an explicit alias, else the target (+subpath). */
function pickDisplayText(alias: string | undefined, target: string, subpath: string): string {
	if (alias !== undefined && alias.trim() !== '') {
		return alias.trim();
	}
	const base = target.trim();
	return subpath === '' ? base : `${base} > ${subpath.replace(/^\^/, '')}`;
}
