import { describe, expect, it } from 'vitest';
import {
	buildPageNodes,
	derivePageRoute,
	isDesignatedPage,
	isHomeDesignation,
	type RawPageNote,
} from '../../src/core/domain/pages';
import type { CellValue } from '../../src/core/domain/types';

const PAGES = 'Site/pages';
const LIBRARY = 'Site/components';

/** Build a raw page note. */
function note(
	path: string,
	frontmatter: Record<string, CellValue> = {},
	content?: string,
): RawPageNote {
	return {
		path,
		frontmatter,
		...(content !== undefined ? { body: { format: 'markdown' as const, content } } : {}),
	};
}

describe('isDesignatedPage — designation rules (FR-12)', () => {
	it('designates a note inside the configured pages folder', () => {
		expect(isDesignatedPage('Site/pages/About.md', {}, PAGES, LIBRARY)).toBe(true);
		expect(isDesignatedPage('Site/pages/sub/Deep.md', {}, PAGES, LIBRARY)).toBe(true);
	});

	it('designates a note via the `site: true` frontmatter flag anywhere', () => {
		expect(isDesignatedPage('Notes/About.md', { site: true }, PAGES, LIBRARY)).toBe(true);
	});

	it('designates a note via `page: true` and `type: page` flags', () => {
		expect(isDesignatedPage('Notes/A.md', { page: true }, PAGES, LIBRARY)).toBe(true);
		expect(isDesignatedPage('Notes/B.md', { type: 'page' }, PAGES, LIBRARY)).toBe(true);
		expect(isDesignatedPage('Notes/C.md', { type: 'Page' }, PAGES, LIBRARY)).toBe(true);
	});

	it('does NOT designate a plain note outside the pages folder without a flag', () => {
		expect(isDesignatedPage('Notes/Random.md', {}, PAGES, LIBRARY)).toBe(false);
		expect(isDesignatedPage('Notes/Random.md', { site: false }, PAGES, LIBRARY)).toBe(false);
	});

	it('excludes a component-library note even if it sits in the pages folder (FR-11i)', () => {
		// A note both in the library folder and (pathologically) flagged — never a page.
		expect(
			isDesignatedPage('Site/components/Card.md', { site: true }, PAGES, 'Site/components'),
		).toBe(false);
	});

	it('treats a blank pages folder as "frontmatter-flag only"', () => {
		expect(isDesignatedPage('Site/pages/About.md', {}, '', LIBRARY)).toBe(false);
		expect(isDesignatedPage('Site/pages/About.md', { site: true }, '', LIBRARY)).toBe(true);
	});
});

describe('isHomeDesignation — home selection rule (FR-12)', () => {
	it('treats `home: true` as the home page anywhere', () => {
		expect(isHomeDesignation('Notes/Welcome.md', { site: true, home: true }, PAGES)).toBe(true);
	});

	it('treats an explicit slug/permalink of `/` as the home page', () => {
		expect(isHomeDesignation('Site/pages/Landing.md', { permalink: '/' }, PAGES)).toBe(true);
		expect(isHomeDesignation('Site/pages/Landing.md', { slug: '/' }, PAGES)).toBe(true);
	});

	it('treats an `index`/`home` basename inside the pages folder as the home page', () => {
		expect(isHomeDesignation('Site/pages/index.md', {}, PAGES)).toBe(true);
		expect(isHomeDesignation('Site/pages/Home.md', {}, PAGES)).toBe(true);
	});

	it('does NOT treat an `index` basename OUTSIDE the pages folder as home (must opt in)', () => {
		expect(isHomeDesignation('Notes/index.md', { site: true }, PAGES)).toBe(false);
	});

	it('does NOT treat a regular page as home', () => {
		expect(isHomeDesignation('Site/pages/About.md', {}, PAGES)).toBe(false);
	});

	it('an explicit non-root slug overrides the index/home basename default', () => {
		expect(isHomeDesignation('Site/pages/index.md', { slug: 'landing' }, PAGES)).toBe(false);
	});
});

describe('derivePageRoute — deterministic routing (FR-15)', () => {
	it('returns `/` for the home page', () => {
		expect(derivePageRoute('Site/pages/index.md', {}, PAGES, true)).toBe('/');
	});

	it('uses an explicit permalink/slug over the path (normalized)', () => {
		expect(
			derivePageRoute('Site/pages/About.md', { permalink: '/company/about/' }, PAGES, false),
		).toBe('/company/about');
		expect(derivePageRoute('Site/pages/About.md', { slug: 'about-us' }, PAGES, false)).toBe(
			'/about-us',
		);
	});

	it('falls back to the path relative to the pages folder, slugified per segment', () => {
		expect(derivePageRoute('Site/pages/About Us.md', {}, PAGES, false)).toBe('/about-us');
		expect(derivePageRoute('Site/pages/Legal/Privacy Policy.md', {}, PAGES, false)).toBe(
			'/legal/privacy-policy',
		);
	});

	it('falls back to the bare basename for a flag-only page outside the folder', () => {
		expect(derivePageRoute('Deep/Nested/My Page.md', { site: true }, PAGES, false)).toBe(
			'/my-page',
		);
	});

	it('falls back to "page" for a basename that slugifies away', () => {
		expect(derivePageRoute('Site/pages/!!!.md', {}, PAGES, false)).toBe('/page');
	});
});

describe('buildPageNodes — folding + home selection (FR-12)', () => {
	it('folds designated notes into PageNodes with route, title, home flag, and body', () => {
		const { pages, warnings } = buildPageNodes(
			[
				note('Site/pages/index.md', { title: 'Welcome' }, '# Hi'),
				note('Site/pages/About.md', {}, 'About us.'),
				note('Notes/NotAPage.md', {}),
			],
			PAGES,
			LIBRARY,
		);
		expect(warnings).toHaveLength(0);
		expect(pages).toEqual([
			{
				path: 'Site/pages/index.md',
				route: '/',
				title: 'Welcome',
				isHome: true,
				frontmatter: { title: 'Welcome' },
				body: { format: 'markdown', content: '# Hi' },
			},
			{
				path: 'Site/pages/About.md',
				route: '/about',
				title: 'About',
				isHome: false,
				frontmatter: {},
				body: { format: 'markdown', content: 'About us.' },
			},
		]);
	});

	it('demotes a second home claim and warns (first home wins)', () => {
		const { pages, warnings } = buildPageNodes(
			[note('Site/pages/index.md', {}), note('Site/pages/Landing.md', { home: true })],
			PAGES,
			LIBRARY,
		);
		expect(pages[0].isHome).toBe(true);
		expect(pages[0].route).toBe('/');
		// The demoted page keeps its own derived route, not `/`.
		expect(pages[1].isHome).toBe(false);
		expect(pages[1].route).toBe('/landing');
		expect(warnings.some((w) => w.includes('home page'))).toBe(true);
	});

	it('emits no home page when none is designated (placeholder index stays)', () => {
		const { pages } = buildPageNodes([note('Site/pages/About.md', {})], PAGES, LIBRARY);
		expect(pages.every((p) => !p.isHome)).toBe(true);
		expect(pages.every((p) => p.route !== '/')).toBe(true);
	});

	it('excludes component-library notes from page generation (FR-11i)', () => {
		const { pages } = buildPageNodes(
			[note('Site/components/Card.md', { site: true })],
			PAGES,
			'Site/components',
		);
		expect(pages).toHaveLength(0);
	});

	it('titles a page from its basename when no frontmatter title', () => {
		const { pages } = buildPageNodes([note('Site/pages/Contact Us.md', {})], PAGES, LIBRARY);
		expect(pages[0].title).toBe('Contact Us');
	});
});
