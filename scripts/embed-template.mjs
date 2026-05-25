// @ts-check
/**
 * Embed generator (C1 — DESIGN §5.9, DIST-BRAT-1).
 *
 * BRAT and the Obsidian updater install only `main.js`, `manifest.json`, and
 * `styles.css` from a release, so loose template files in the repo would never
 * reach users. This script serializes the editable source of truth under
 * `templates/astro/**` into a generated TypeScript module
 * (`src/adapters/generated/embedded-template.ts`) that esbuild bundles into
 * `main.js`. The bootstrap adapter reads it and writes the files out into
 * `<pluginDir>/astro` on first run.
 *
 * Run automatically before every esbuild build (see `package.json`), and
 * directly in CI to assert the artifact is in sync with the template tree.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const templateRoot = path.join(repoRoot, 'templates', 'astro');
const outFile = path.join(repoRoot, 'src', 'adapters', 'generated', 'embedded-template.ts');

/** Recursively collect project-relative POSIX paths under the template root. */
async function collectFiles(dir, rel = '') {
	const entries = await readdir(dir, { withFileTypes: true });
	const out = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const abs = path.join(dir, entry.name);
		const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
		if (entry.isDirectory()) {
			out.push(...(await collectFiles(abs, relPath)));
		} else if (entry.isFile()) {
			out.push(relPath);
		}
	}
	return out;
}

/**
 * Ownership classification — kept in lockstep with
 * `src/core/domain/template.ts#classifyOwnership`. (The generator is a build
 * script outside the TS program, so it re-states the one-line rule rather than
 * importing core.)
 */
function classifyOwnership(projectRelativePath) {
	const normalized = projectRelativePath.replace(/^\.\//, '').replace(/\\/g, '/');
	return normalized === 'src/user' || normalized.startsWith('src/user/') ? 'user' : 'template';
}

/** Render the generated TS module source from the current template tree. */
async function renderModule() {
	const relPaths = (await collectFiles(templateRoot)).sort((a, b) => a.localeCompare(b));
	const files = [];
	for (const relPath of relPaths) {
		const contents = await readFile(path.join(templateRoot, relPath), 'utf8');
		files.push({ path: relPath, contents, ownership: classifyOwnership(relPath) });
	}

	const body = files
		.map(
			(f) =>
				`\t{\n\t\tpath: ${JSON.stringify(f.path)},\n\t\townership: ${JSON.stringify(f.ownership)},\n\t\tcontents: ${JSON.stringify(f.contents)},\n\t},`,
		)
		.join('\n');

	const source = `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by scripts/embed-template.mjs from templates/astro/**, which is the
 * editable source of truth. Run \`npm run build\` (or \`node scripts/embed-template.mjs\`)
 * to regenerate. Embedding the template into main.js is mandatory because the
 * release ships only main.js + manifest.json + styles.css (DIST-BRAT-1).
 *
 * ${files.length} file(s) embedded.
 */
import type { TemplateFile } from '../../core/domain/template';

export const EMBEDDED_TEMPLATE_FILES: readonly TemplateFile[] = [
${body}
];
`;

	return { source, count: files.length };
}

const checkOnly = process.argv.includes('--check');
const { source, count } = await renderModule();

if (checkOnly) {
	const existing = await readFile(outFile, 'utf8').catch(() => null);
	if (existing !== source) {
		console.error(
			'[embed-template] Generated embedded-template.ts is out of date. ' +
				'Run `node scripts/embed-template.mjs` and commit the result.',
		);
		process.exit(1);
	}
	console.log(`[embed-template] OK — ${String(count)} embedded file(s) in sync.`);
} else {
	await mkdir(path.dirname(outFile), { recursive: true });
	await writeFile(outFile, source, 'utf8');
	console.log(`[embed-template] Wrote ${String(count)} embedded file(s) -> ${outFile}`);
}
