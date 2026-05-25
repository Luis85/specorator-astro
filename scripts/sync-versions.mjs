// @ts-check
/**
 * versions.json sync (R2 — DIST-BRAT-2, DIST-MP-5/6).
 *
 * Obsidian uses `versions.json` to map each released plugin `version` to the
 * `minAppVersion` it requires, so the in-app updater only offers a build to
 * compatible app versions. release-please bumps `manifest.json` `$.version`
 * (via `extra-files`) but does NOT know about `versions.json`, so without this
 * step the map drifts behind the manifest.
 *
 * This script reads `manifest.json` (`version` + `minAppVersion`) and ensures
 * `versions.json` contains `{ "<version>": "<minAppVersion>" }`. It is
 * idempotent, preserves existing entries, and writes tab-indented JSON to match
 * the repo style.
 *
 * RELEASE FLOW: the release-please release PR (or whoever bumps the version)
 * MUST run `node scripts/sync-versions.mjs` (alias: `npm run version:sync`) and
 * commit the result BEFORE the tag is cut, so the new version's entry ships in
 * the tagged tree. CI runs `--check` to fail the build if the entry is missing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'manifest.json');
const versionsPath = path.join(repoRoot, 'versions.json');

/** Serialize an object as tab-indented JSON with a trailing newline (repo style). */
function serialize(obj) {
	return `${JSON.stringify(obj, null, '\t')}\n`;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const { version, minAppVersion } = manifest;

if (typeof version !== 'string' || typeof minAppVersion !== 'string') {
	console.error(
		'[sync-versions] manifest.json must define string `version` and `minAppVersion`.',
	);
	process.exit(1);
}

const existing = JSON.parse(await readFile(versionsPath, 'utf8'));
const checkOnly = process.argv.includes('--check');

const inSync = existing[version] === minAppVersion;

if (checkOnly) {
	if (!inSync) {
		console.error(
			`[sync-versions] versions.json is missing or wrong for manifest version ${version}. ` +
				`Expected "${version}": "${minAppVersion}". ` +
				'Run `npm run version:sync` and commit the result.',
		);
		process.exit(1);
	}
	console.log(`[sync-versions] OK — versions.json maps ${version} -> ${minAppVersion}.`);
} else {
	if (inSync) {
		console.log(`[sync-versions] Already in sync — ${version} -> ${minAppVersion}.`);
	} else {
		// Preserve every existing entry; only add/update the current version.
		const next = { ...existing, [version]: minAppVersion };
		await writeFile(versionsPath, serialize(next), 'utf8');
		console.log(`[sync-versions] Wrote versions.json entry ${version} -> ${minAppVersion}.`);
	}
}
