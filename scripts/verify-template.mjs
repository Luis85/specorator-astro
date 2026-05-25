// @ts-check
/**
 * verify:template gate (C1 — IMPLEMENTATION_PLAN §0.1.1 [template]).
 *
 * Proves the bundled Astro template (templates/astro/**, the editable source of
 * truth) is a real, runnable Astro 6 project: it stages a working copy, overlays
 * a minimal fixture (test/fixtures/astro-template/**), installs deps with
 * `--legacy-peer-deps` (FR-17), then runs `astro check` and `astro build` and
 * asserts the fixture route built to static HTML (output: 'static').
 *
 * Kept out of the fast `npm run verify` loop (it installs Astro + builds);
 * runs as its own CI step.
 */
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const templateRoot = path.join(repoRoot, 'templates', 'astro');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'astro-template');
const keep = process.argv.includes('--keep');

/** Run a command, streaming output; reject on non-zero exit. */
function run(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve(undefined);
			else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${String(code)}`));
		});
	});
}

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/** Assert `needle` appears in `haystack`, else throw a labelled error. */
function assertIncludes(haystack, needle, label) {
	if (!haystack.includes(needle)) {
		throw new Error(`${label}: expected to find ${JSON.stringify(needle)} in built HTML.`);
	}
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack, needle) {
	let count = 0;
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) break;
		count += 1;
		from = at + needle.length;
	}
	return count;
}

/** Assert the index order of `first` precedes `second` in `haystack`. */
function assertOrder(haystack, first, second, label) {
	const a = haystack.indexOf(first);
	const b = haystack.indexOf(second);
	if (a === -1 || b === -1 || a > b) {
		throw new Error(
			`${label}: expected ${JSON.stringify(first)} to appear before ${JSON.stringify(second)}.`,
		);
	}
}

/**
 * Verify the C5 listing routes (table/cards/list) emitted by the fixture data
 * dir. Asserts on the built dist/**\/index.html: the correct view component, the
 * column/field order from `view.order`, group headings for the grouped view,
 * and one row/card/list-item per entry.
 */
async function assertSnapshotRoutes(dist) {
	// --- /books — table, grouped by status (keyed groups) ---
	const booksHtml = await readFile(path.join(dist, 'books', 'index.html'), 'utf8');
	assertIncludes(booksHtml, 'data-view="table"', '/books');
	// Columns render in `view.order` (file.name, note.author, formula.ppu): assert
	// the header cells' property order and that each label is humanized.
	assertOrder(
		booksHtml,
		'<th scope="col" data-property="file.name"',
		'<th scope="col" data-property="note.author"',
		'/books column order (Name→Author)',
	);
	assertOrder(
		booksHtml,
		'<th scope="col" data-property="note.author"',
		'<th scope="col" data-property="formula.ppu"',
		'/books column order (Author→Ppu)',
	);
	assertIncludes(booksHtml, '> Name <', '/books column header (humanized)');
	assertIncludes(booksHtml, '> Author <', '/books column header (humanized)');
	assertIncludes(booksHtml, '> Ppu <', '/books column header (humanized)');
	// Group headings for the two keyed groups, in index order. Match the heading
	// element so the assertion can't be satisfied by the view-name <h1>.
	if (countOccurrences(booksHtml, 'class="sp-group-heading"') !== 2) {
		throw new Error('/books: expected 2 group headings (one per keyed group).');
	}
	assertIncludes(booksHtml, '>Reading</h2>', '/books group heading');
	assertIncludes(booksHtml, '>Finished</h2>', '/books group heading');
	assertOrder(booksHtml, '>Reading</h2>', '>Finished</h2>', '/books group order');
	// One row per entry (two entries across two groups).
	if (countOccurrences(booksHtml, '<tr data-entry=') !== 2) {
		throw new Error('/books: expected exactly 2 table rows (one per entry).');
	}
	assertIncludes(booksHtml, 'Frank Herbert', '/books cell value');
	assertIncludes(booksHtml, 'William Gibson', '/books cell value');

	// --- /films — cards, ungrouped (single null-key group) ---
	const filmsHtml = await readFile(path.join(dist, 'films', 'index.html'), 'utf8');
	assertIncludes(filmsHtml, 'data-view="cards"', '/films');
	// One card per entry (two entries), with no group heading element (flat). The
	// CSS class name appears in <style>; assert on the rendered <h2> element.
	if (countOccurrences(filmsHtml, 'class="sp-card"') !== 2) {
		throw new Error('/films: expected exactly 2 cards (one per entry).');
	}
	if (filmsHtml.includes('<h2 class="sp-group-heading"')) {
		throw new Error('/films: ungrouped view must not emit a group heading element.');
	}
	assertIncludes(filmsHtml, '>Stalker</h3>', '/films card title');
	assertIncludes(filmsHtml, '>Solaris</h3>', '/films card title');
	// Field labels humanized from view.order (director/year), in order. file.name
	// is the card title; note.cover is the card cover image — both excluded from
	// the field list. The cover label must NOT appear as a field <dt>.
	assertIncludes(filmsHtml, '>Director</dt>', '/films field label');
	assertIncludes(filmsHtml, '>Year</dt>', '/films field label');
	assertOrder(filmsHtml, '>Director</dt>', '>Year</dt>', '/films field order');
	if (filmsHtml.includes('>Cover</dt>')) {
		throw new Error('/films: the image-typed cover must render as <img>, not a text field.');
	}

	// C7 asset pipeline: the image-typed `note.cover` renders as a card cover
	// <img>, pointing at the rewritten public URL. The resolved cover and the
	// missing-asset placeholder both appear (graceful degradation, FR-16).
	if (countOccurrences(filmsHtml, 'class="sp-card-cover"') !== 2) {
		throw new Error('/films: expected one card-cover <img> per entry (FR-16).');
	}
	assertIncludes(filmsHtml, 'src="/assets/stalker-cover.png"', '/films resolved cover URL');
	assertIncludes(filmsHtml, 'src="/assets/_missing.svg"', '/films missing-asset placeholder');

	// --- /tasks — list, ungrouped ---
	const tasksHtml = await readFile(path.join(dist, 'tasks', 'index.html'), 'utf8');
	assertIncludes(tasksHtml, 'data-view="list"', '/tasks');
	// One list item per entry (two entries).
	if (countOccurrences(tasksHtml, 'class="sp-list-item"') !== 2) {
		throw new Error('/tasks: expected exactly 2 list items (one per entry).');
	}
	if (tasksHtml.includes('<h2 class="sp-group-heading"')) {
		throw new Error('/tasks: ungrouped view must not emit a group heading element.');
	}
	assertIncludes(tasksHtml, '>Ship C5<', '/tasks item');
	assertIncludes(tasksHtml, '>Write docs<', '/tasks item');
	assertIncludes(tasksHtml, '>Priority:<', '/tasks secondary field label');

	console.log(
		'[verify:template] OK — table/cards/list listing routes built with correct order/grouping.',
	);
}

/**
 * Verify the C8 detail pages: `getStaticPaths` emits one page per entry `route`
 * in the shared `[...slug]` namespace, and the page renders the entry body at
 * core fidelity — markdown, an Obsidian **callout** as callout markup, and a
 * `[[wikilink]]` already resolved to the linked entry's route (FR-21, D8).
 * Also proves graceful degradation: a block ref / Dataview snippet in the body
 * does not fail the build and ships as passed-through content.
 */
async function assertDetailRoutes(dist) {
	// Every published entry got its own detail page (one per entry across bases).
	const detailRoutes = [
		['books', 'dune'],
		['books', 'neuromancer'],
		['films', 'stalker'],
		['films', 'solaris'],
		['tasks', 'ship-c5'],
		['tasks', 'write-docs'],
	];
	for (const segs of detailRoutes) {
		const file = path.join(dist, ...segs, 'index.html');
		if (!(await exists(file))) {
			throw new Error(`Detail page missing for /${segs.join('/')} (FR-21): ${file}`);
		}
	}

	// The /books/dune detail page: body rendered, callout markup, resolved link.
	const duneHtml = await readFile(path.join(dist, 'books', 'dune', 'index.html'), 'utf8');
	assertIncludes(duneHtml, 'class="sp-detail"', '/books/dune detail article');
	assertIncludes(duneHtml, 'class="sp-detail-body"', '/books/dune rendered body');
	// Frontmatter/values shown on the detail page (humanized field label + value).
	assertIncludes(duneHtml, 'Frank Herbert', '/books/dune field value');
	// The Obsidian callout `> [!note] Spice` renders as callout markup.
	assertIncludes(duneHtml, 'data-callout="note"', '/books/dune callout');
	assertIncludes(duneHtml, 'class="sp-callout-title"', '/books/dune callout title');
	assertIncludes(duneHtml, 'The spice must flow.', '/books/dune callout body');
	// The wikilink (resolved to a route by the plugin before write) links out.
	assertIncludes(duneHtml, 'href="/books/neuromancer"', '/books/dune resolved wikilink');
	// Graceful degradation (D8): the unresolved block ref + Dataview block ship as
	// passed-through content; their presence proves the build did not fail on them.
	assertIncludes(duneHtml, '#^missing', '/books/dune block-ref degraded (no crash)');
	assertIncludes(duneHtml, 'dataview', '/books/dune dataview degraded (no crash)');

	console.log('[verify:template] OK — per-entry detail pages built; body/callout/link rendered.');
}

async function main() {
	const work = await mkdtemp(path.join(tmpdir(), 'specorator-template-'));
	console.log(`[verify:template] Staging template in ${work}`);
	try {
		// Stage the template, then overlay the fixture (extra route + any data).
		await cp(templateRoot, work, { recursive: true });
		if (await exists(fixtureRoot)) {
			await cp(fixtureRoot, work, { recursive: true });
		}

		await run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'], work);

		const astroBin = path.join(
			work,
			'node_modules',
			'.bin',
			process.platform === 'win32' ? 'astro.cmd' : 'astro',
		);

		console.log('[verify:template] astro check');
		await run(astroBin, ['check'], work);

		console.log('[verify:template] astro build');
		await run(astroBin, ['build'], work);

		// Assert the static build emitted the template + fixture routes.
		const dist = path.join(work, 'dist');
		const indexHtml = path.join(dist, 'index.html');
		const fixtureHtml = path.join(dist, 'fixture', 'index.html');
		for (const file of [indexHtml, fixtureHtml]) {
			if (!(await exists(file))) {
				throw new Error(`Expected built static file is missing: ${file}`);
			}
		}
		const fixtureMarkup = await readFile(fixtureHtml, 'utf8');
		if (!fixtureMarkup.includes('Fixture build OK')) {
			throw new Error('Fixture route built but did not render the expected content.');
		}

		// C5: assert the snapshot-driven listing routes built from the fixture data
		// dir (test/fixtures/astro-template/data/**) with correct view, column
		// order, grouping, and one row/card/list-item per entry.
		await assertSnapshotRoutes(dist);

		// C8: assert per-entry detail pages built across the shared `[...slug]`
		// namespace, with the body rendered at core fidelity (markdown + callouts
		// + resolved wikilinks) and block-ref/Dataview degrading gracefully (D8).
		await assertDetailRoutes(dist);

		// C7: the referenced attachment placed under public/assets/ (simulating the
		// post-copy state the plugin's copier produces) is emitted into dist/, and
		// the template's missing-asset placeholder ships too (FR-16; DESIGN §5.8).
		for (const asset of ['assets/stalker-cover.png', 'assets/_missing.svg']) {
			const built = path.join(dist, ...asset.split('/'));
			if (!(await exists(built))) {
				throw new Error(`Expected copied asset missing from build output: ${built}`);
			}
		}
		console.log('[verify:template] OK — referenced assets + placeholder emitted into dist/.');

		console.log('[verify:template] OK — astro check + build succeeded; static routes emitted.');
	} finally {
		if (keep) {
			console.log(`[verify:template] Keeping work dir: ${work}`);
		} else {
			await rm(work, { recursive: true, force: true });
		}
	}
}

await mkdir(tmpdir(), { recursive: true }).catch(() => {});
main().catch((error) => {
	console.error(`[verify:template] FAILED: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
