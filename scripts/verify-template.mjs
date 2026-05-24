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
