import { describe, expect, it } from 'vitest';
import { resolveWikilinks } from '../../src/core/domain/wikilinks';
import type { RouteResolver } from '../../src/core/domain/route-table';

/** A fake route resolver: a small published map, everything else off-site. */
const published: Record<string, string> = {
	dune: '/books/dune',
	'the left hand of darkness': '/books/the-left-hand-of-darkness',
	'books/dune': '/books/dune',
};
const resolve: RouteResolver = (target) => published[target.trim().toLowerCase()] ?? null;

describe('resolveWikilinks — on-site links', () => {
	it('rewrites a bare wikilink to a markdown link to its route', () => {
		expect(resolveWikilinks('See [[Dune]] for details.', resolve)).toBe(
			'See [Dune](/books/dune) for details.',
		);
	});

	it('uses the alias as the display text', () => {
		expect(resolveWikilinks('Read [[Dune|the novel]].', resolve)).toBe(
			'Read [the novel](/books/dune).',
		);
	});

	it('resolves a full vault-path wikilink', () => {
		expect(resolveWikilinks('[[Books/Dune]]', resolve)).toBe('[Books/Dune](/books/dune)');
	});

	it('rewrites multiple links in one body', () => {
		const out = resolveWikilinks('[[Dune]] and [[The Left Hand of Darkness]]', resolve);
		expect(out).toBe(
			'[Dune](/books/dune) and [The Left Hand of Darkness](/books/the-left-hand-of-darkness)',
		);
	});
});

describe('resolveWikilinks — off-site / unpublished (FR-24, D17)', () => {
	it('renders an unpublished link as styled "not published" text, NOT a link', () => {
		const out = resolveWikilinks('See [[Unpublished Note]].', resolve);
		expect(out).toBe(
			'See <span class="sp-unpublished" data-unpublished-link="Unpublished Note" ' +
				'title="Not published: Unpublished Note">Unpublished Note</span>.',
		);
		// It is NEVER an <a href> — visibly distinct but non-clickable.
		expect(out).not.toContain('href=');
		expect(out).not.toContain('](');
	});

	it('uses the alias as the visible "not published" text for an off-site aliased link', () => {
		const out = resolveWikilinks('[[Secret|hidden]]', resolve);
		expect(out).toBe(
			'<span class="sp-unpublished" data-unpublished-link="Secret" ' +
				'title="Not published: Secret">hidden</span>',
		);
	});

	it('reports each off-site link to the onOffSite sink (target + visible text)', () => {
		const seen: { target: string; text: string }[] = [];
		resolveWikilinks('[[Secret|hidden]] and [[Other]]', resolve, (link) => seen.push(link));
		expect(seen).toEqual([
			{ target: 'Secret', text: 'hidden' },
			{ target: 'Other', text: 'Other' },
		]);
	});

	it('does NOT report an on-site link to the onOffSite sink', () => {
		const seen: { target: string; text: string }[] = [];
		resolveWikilinks('[[Dune]]', resolve, (link) => seen.push(link));
		expect(seen).toEqual([]);
	});

	it('HTML-escapes the visible text and target attribute in the marker', () => {
		const out = resolveWikilinks('[[A & B <c>|x "y" <z>]]', resolve);
		expect(out).toBe(
			'<span class="sp-unpublished" data-unpublished-link="A &amp; B &lt;c&gt;" ' +
				'title="Not published: A &amp; B &lt;c&gt;">x &quot;y&quot; &lt;z&gt;</span>',
		);
		expect(out).not.toContain('href=');
	});

	it('does not touch an image embed (![[…]]) — asset pipeline owns it', () => {
		expect(resolveWikilinks('![[cover.png]]', resolve)).toBe('![[cover.png]]');
		expect(resolveWikilinks('![[Books/Dune]]', resolve)).toBe('![[Books/Dune]]');
	});

	it('degrades a block reference to the note route, ignoring the #^block (out of scope)', () => {
		// On-site note with a block ref: route to the note, keep readable text.
		expect(resolveWikilinks('[[Dune#^abc123]]', resolve)).toBe('[Dune > abc123](/books/dune)');
	});

	it('degrades a heading subpath link to the note route', () => {
		expect(resolveWikilinks('[[Dune#Plot]]', resolve)).toBe('[Dune > Plot](/books/dune)');
	});

	it('degrades a same-note block ref ([[#^block]]) to readable text, never a broken link', () => {
		// No note target → not routed; the readable subpath survives as plain text.
		expect(resolveWikilinks('[[#^block]]', resolve)).toBe(' > block');
	});

	it('passes a Dataview code fence straight through unchanged', () => {
		const body = '```dataview\nTABLE file.name FROM "Books"\n```';
		expect(resolveWikilinks(body, resolve)).toBe(body);
	});

	it('does not throw on transclusion / odd bracket content', () => {
		expect(() =>
			resolveWikilinks('![[Note#^x]] and [[ ]] and [[|only-alias]]', resolve),
		).not.toThrow();
	});

	it('returns text unchanged when there are no wikilinks', () => {
		const body = '# Heading\n\nPlain paragraph with a [normal](https://x.test) link.';
		expect(resolveWikilinks(body, resolve)).toBe(body);
	});
});
