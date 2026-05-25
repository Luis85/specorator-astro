import { describe, expect, it } from 'vitest';
import {
	extractAstroFence,
	generatedPath,
	isComponentLibraryNote,
	parseComponentMeta,
	transpileComponentNote,
	TRANSPILE_TIER,
} from '../../src/core/domain/component-transpile';

/**
 * A well-formed BookCard component note (DESIGN §5.6 example), as raw markdown.
 * The inner ```astro fence is escaped here only so this test file itself stays
 * valid; the note content is normal markdown.
 */
const BOOK_CARD = [
	'---',
	'component:',
	'    name: BookCard # registry name',
	'    kind: view # view | layout | partial',
	'    appliesTo: [cards] # base view types',
	'    props: [cover, author] # declared inputs',
	'---',
	'',
	'```astro',
	'---',
	'const { entry } = Astro.props;',
	'---',
	'<article class="book">',
	'  <img src={entry.values["note.cover"]} alt="" />',
	'  <h3>{entry.values["file.name"]}</h3>',
	'  <p>{entry.values["note.author"]}</p>',
	'</article>',
	'```',
	'',
].join('\n');

describe('component-transpile: golden well-formed note', () => {
	it('transpiles a well-formed note to the expected generated .astro', () => {
		const result = transpileComponentNote(BOOK_CARD);
		expect(result.outcome).toBe('transpiled');
		if (result.outcome !== 'transpiled') return;

		// Metadata parsed from the component: frontmatter.
		expect(result.meta).toEqual({
			name: 'BookCard',
			kind: 'view',
			appliesTo: ['cards'],
			props: ['cover', 'author'],
		});

		// Targets the generated/views tier (a view), shadowing user/theme (FR-11j).
		expect(result.path).toBe('src/generated/views/BookCard.astro');
		expect(TRANSPILE_TIER).toBe('generated');

		// The authored block is written VERBATIM; the generated props lines are
		// spliced into the authored frontmatter script (one script fence only).
		expect(result.contents).toContain('const { entry } = Astro.props;');
		expect(result.contents).toContain('<article class="book">');
		expect(result.contents).toContain('<h3>{entry.values["file.name"]}</h3>');
		// Generated header + declared-props destructure prepended.
		expect(result.contents).toContain('Generated from the vault component note "BookCard"');
		expect(result.contents).toContain('const { cover, author } = Astro.props');
		// Exactly one frontmatter script fence (no doubled `---` script).
		const scriptFences = result.contents.match(/^---$/gm) ?? [];
		expect(scriptFences).toHaveLength(2); // open + close of the single script
		// The generated lines precede the authored `const { entry }` line.
		expect(result.contents.indexOf('const { cover, author }')).toBeLessThan(
			result.contents.indexOf('const { entry } = Astro.props;'),
		);
	});

	it('emits a standalone script fence when the authored block has no script', () => {
		const note = [
			'---',
			'component:',
			'    name: Banner',
			'---',
			'',
			'```astro',
			'<h1>Hi</h1>',
			'```',
		].join('\n');
		const result = transpileComponentNote(note);
		expect(result.outcome).toBe('transpiled');
		if (result.outcome !== 'transpiled') return;
		// A view by default; standalone generated script then the verbatim markup.
		expect(result.path).toBe('src/generated/views/Banner.astro');
		expect(result.contents).toContain('<h1>Hi</h1>');
		expect(result.contents.startsWith('---\n')).toBe(true);
		// No declared props → no destructure line, just the header comment.
		expect(result.contents).not.toContain('= Astro.props as');
	});
});

describe('component-transpile: kind → generated tier dir', () => {
	it('maps view/layout/partial to views/layouts/components', () => {
		expect(generatedPath({ name: 'V', kind: 'view', appliesTo: [], props: [] })).toBe(
			'src/generated/views/V.astro',
		);
		expect(generatedPath({ name: 'L', kind: 'layout', appliesTo: [], props: [] })).toBe(
			'src/generated/layouts/L.astro',
		);
		expect(generatedPath({ name: 'P', kind: 'partial', appliesTo: [], props: [] })).toBe(
			'src/generated/components/P.astro',
		);
	});

	it('defaults an absent/unknown kind to view', () => {
		const noKind = ['---', 'component:', '    name: X', '---', '```astro', '<i/>', '```'].join(
			'\n',
		);
		const r = transpileComponentNote(noKind);
		expect(r.outcome === 'transpiled' && r.meta.kind).toBe('view');
		const badKind = [
			'---',
			'component:',
			'    name: X',
			'    kind: widget',
			'---',
			'```astro',
			'<i/>',
			'```',
		].join('\n');
		const r2 = transpileComponentNote(badKind);
		expect(r2.outcome === 'transpiled' && r2.meta.kind).toBe('view');
	});
});

describe('component-transpile: skipped (not a component) — never throws', () => {
	it('skips a note with no frontmatter', () => {
		const r = transpileComponentNote('Just a normal note.\n\nNo frontmatter here.');
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('no frontmatter');
	});

	it('skips a note whose frontmatter has no component block', () => {
		const note = ['---', 'title: Hello', 'tags: [x]', '---', '```astro', '<i/>', '```'].join(
			'\n',
		);
		const r = transpileComponentNote(note);
		expect(r.outcome).toBe('skipped');
	});

	it('skips a component block missing a name', () => {
		const note = ['---', 'component:', '    kind: view', '---', '```astro', '<i/>', '```'].join(
			'\n',
		);
		const r = transpileComponentNote(note);
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('name');
	});

	it('skips a note with zero ```astro fences', () => {
		const note = [
			'---',
			'component:',
			'    name: NoFence',
			'---',
			'',
			'Body with no astro block.',
		].join('\n');
		const r = transpileComponentNote(note);
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('exactly one');
	});

	it('skips a note with more than one ```astro fence (ambiguous)', () => {
		const note = [
			'---',
			'component:',
			'    name: TwoFences',
			'---',
			'```astro',
			'<a/>',
			'```',
			'',
			'```astro',
			'<b/>',
			'```',
		].join('\n');
		const r = transpileComponentNote(note);
		expect(r.outcome).toBe('skipped');
	});

	it('does not treat a non-astro code fence as the component template', () => {
		const note = [
			'---',
			'component:',
			'    name: JsFence',
			'---',
			'```js',
			'console.log("not astro");',
			'```',
		].join('\n');
		const r = transpileComponentNote(note);
		expect(r.outcome).toBe('skipped');
	});

	it('never throws on hostile/garbage input', () => {
		expect(() => transpileComponentNote('')).not.toThrow();
		expect(() => transpileComponentNote('---\n---\n')).not.toThrow();
		expect(() => transpileComponentNote('---\ncomponent:\n---')).not.toThrow();
	});
});

describe('component-transpile: path-traversal guard on component name (NFR-9)', () => {
	const noteWithName = (name: string): string =>
		['---', 'component:', `    name: ${name}`, '---', '```astro', '<i/>', '```'].join('\n');

	it('rejects a `../`-style traversal name with a reason and emits no path', () => {
		const r = transpileComponentNote(noteWithName("'../../../../src/user/Layout'"));
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') {
			expect(r.reason).toContain('single path segment');
		}
		// The result is a SkippedNote — it carries no generated `path` at all.
		expect('path' in r).toBe(false);
	});

	it('rejects a name containing a `/` separator', () => {
		const r = transpileComponentNote(noteWithName("'sub/Card'"));
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('single path segment');
		expect('path' in r).toBe(false);
	});

	it('rejects a name containing `..`', () => {
		const r = transpileComponentNote(noteWithName("'..'"));
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('single path segment');
		expect('path' in r).toBe(false);
	});

	it('rejects a backslash separator (Windows-style traversal)', () => {
		const r = transpileComponentNote(noteWithName("'..\\\\config'"));
		expect(r.outcome).toBe('skipped');
		if (r.outcome === 'skipped') expect(r.reason).toContain('single path segment');
		expect('path' in r).toBe(false);
	});

	it('still transpiles a normal single-segment name (with hyphen/underscore)', () => {
		const r = transpileComponentNote(noteWithName('Book_Card-2'));
		expect(r.outcome).toBe('transpiled');
		if (r.outcome === 'transpiled') {
			expect(r.path).toBe('src/generated/views/Book_Card-2.astro');
		}
	});
});

describe('component-transpile: metadata parsing details', () => {
	it('parses inline lists and strips inline comments + quotes', () => {
		const fm = [
			'component:',
			"    name: 'Quoted'",
			'    appliesTo: [cards, page] # types',
			'    props: ["a", b]',
		].join('\n');
		expect(parseComponentMeta(fm)).toEqual({
			name: 'Quoted',
			kind: 'view',
			appliesTo: ['cards', 'page'],
			props: ['a', 'b'],
		});
	});

	it('returns null for frontmatter with an inline component value (unsupported shape)', () => {
		expect(parseComponentMeta('component: BookCard')).toBeNull();
	});

	it('tolerates a blank line inside the component block', () => {
		const fm = ['component:', '    name: Spacey', '', '    kind: layout'].join('\n');
		expect(parseComponentMeta(fm)).toEqual({
			name: 'Spacey',
			kind: 'layout',
			appliesTo: [],
			props: [],
		});
	});

	it('stops the component block at a sibling top-level key', () => {
		// `title:` is a non-indented sibling; `kind` after it is NOT part of component.
		const fm = ['component:', '    name: Edge', 'title: Other', 'kind: layout'].join('\n');
		expect(parseComponentMeta(fm)).toEqual({
			name: 'Edge',
			kind: 'view',
			appliesTo: [],
			props: [],
		});
	});
});

describe('extractAstroFence', () => {
	it('returns the inner block for exactly one fence', () => {
		expect(extractAstroFence('```astro\n<x/>\n```')).toBe('<x/>');
	});
	it('returns null for zero or multiple fences', () => {
		expect(extractAstroFence('no fence')).toBeNull();
		expect(extractAstroFence('```astro\na\n```\n```astro\nb\n```')).toBeNull();
	});
});

describe('isComponentLibraryNote (FR-11i leakage exclusion)', () => {
	it('matches notes inside the configured library folder', () => {
		expect(isComponentLibraryNote('Site/components/BookCard.md', 'Site/components')).toBe(true);
		expect(isComponentLibraryNote('Site/components/sub/X.md', 'Site/components')).toBe(true);
	});

	it('matches the folder note itself and tolerates trailing/leading slashes', () => {
		expect(isComponentLibraryNote('Site/components', 'Site/components/')).toBe(true);
		expect(isComponentLibraryNote('Site\\components\\X.md', '/Site/components')).toBe(true);
	});

	it('does not match notes outside the folder (no false leakage block)', () => {
		expect(isComponentLibraryNote('Site/pages/Home.md', 'Site/components')).toBe(false);
		// A sibling folder sharing a prefix must NOT match (boundary check).
		expect(isComponentLibraryNote('Site/components-archive/X.md', 'Site/components')).toBe(
			false,
		);
		expect(isComponentLibraryNote('Notes/BookCard.md', 'Site/components')).toBe(false);
	});

	it('matches nothing when the library folder is empty/blank (opt-in)', () => {
		expect(isComponentLibraryNote('anything.md', '')).toBe(false);
		expect(isComponentLibraryNote('anything.md', '   ')).toBe(false);
	});
});
