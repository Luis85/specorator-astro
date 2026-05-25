import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { PageLoaderAdapter } from '../../src/adapters/page-loader-adapter';

/** One fake vault note: its path, raw markdown, and (optionally) cached frontmatter. */
interface FakeNote {
	path: string;
	raw: string;
	/** Parsed frontmatter the metadata cache would expose; omit to force a parse. */
	frontmatter?: Record<string, unknown> | null;
}

/** Build a minimal `App` over fake notes for the page-loader adapter. */
function fakeApp(notes: FakeNote[]): App {
	const files = notes.map((note) => {
		const file = new TFile();
		file.path = note.path;
		return { file, note };
	});
	return {
		vault: {
			getMarkdownFiles: () => files.map((f) => f.file),
			cachedRead: async (file: TFile) => {
				const hit = files.find((f) => f.file === file);
				if (hit === undefined) throw new Error(`no such file: ${file.path}`);
				return hit.note.raw;
			},
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const hit = files.find((f) => f.file === file);
				const fm = hit?.note.frontmatter;
				return fm === undefined || fm === null ? {} : { frontmatter: fm };
			},
		},
	} as unknown as App;
}

const PAGES = 'Site/pages';
const LIBRARY = 'Site/components';

describe('PageLoaderAdapter', () => {
	it('returns notes in the pages folder + flagged notes elsewhere; skips the rest', async () => {
		const app = fakeApp([
			{
				path: 'Site/pages/About.md',
				raw: '---\ntitle: About\n---\nAbout body.',
				frontmatter: { title: 'About' },
			},
			{
				path: 'Notes/Flagged.md',
				raw: '---\nsite: true\n---\nFlagged body.',
				frontmatter: { site: true },
			},
			{
				path: 'Notes/Plain.md',
				raw: 'Just a normal note.',
				frontmatter: {},
			},
		]);
		const loader = new PageLoaderAdapter(
			app,
			() => PAGES,
			() => LIBRARY,
		);

		const result = await loader.loadPages();
		// Sorted by path; the plain note is excluded (not in folder, no flag).
		expect(result.map((n) => n.path)).toEqual(['Notes/Flagged.md', 'Site/pages/About.md']);
		// Frontmatter + frontmatter-stripped body are carried through.
		expect(result[1].frontmatter.title).toBe('About');
		expect(result[1].body?.content).toBe('About body.');
		expect(result[0].body?.content).toBe('Flagged body.');
	});

	it('never returns a component-library note even if it carries a page flag (FR-11i)', async () => {
		const app = fakeApp([
			{
				path: 'Site/components/Hero.md',
				raw: '---\nsite: true\n---\nHero.',
				frontmatter: { site: true },
			},
		]);
		const loader = new PageLoaderAdapter(
			app,
			() => PAGES,
			() => LIBRARY,
		);
		expect(await loader.loadPages()).toEqual([]);
	});

	it('falls back to parsing the raw frontmatter when the cache has none', async () => {
		const app = fakeApp([
			{
				path: 'Notes/Uncached.md',
				raw: '---\npage: true\ntitle: Uncached\n---\nBody here.',
				frontmatter: null, // cache miss → parse the raw block
			},
		]);
		const loader = new PageLoaderAdapter(
			app,
			() => PAGES,
			() => LIBRARY,
		);
		const result = await loader.loadPages();
		expect(result).toHaveLength(1);
		expect(result[0].frontmatter.page).toBe(true);
		expect(result[0].frontmatter.title).toBe('Uncached');
		expect(result[0].body?.content).toBe('Body here.');
	});

	it('returns a title-only page (no body) for a note that is all frontmatter', async () => {
		const app = fakeApp([
			{
				path: 'Site/pages/Empty.md',
				raw: '---\ntitle: Empty\n---\n',
				frontmatter: { title: 'Empty' },
			},
		]);
		const loader = new PageLoaderAdapter(
			app,
			() => PAGES,
			() => LIBRARY,
		);
		const result = await loader.loadPages();
		expect(result).toHaveLength(1);
		expect(result[0]).not.toHaveProperty('body');
	});
});
