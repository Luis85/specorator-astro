import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildExportAdapter } from '../../src/adapters/build-export-adapter';

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

describe('BuildExportAdapter', () => {
	let work: string;
	let vault: string;
	let projectDir: string;
	let distDir: string;

	beforeEach(async () => {
		work = await mkdtemp(path.join(tmpdir(), 'specorator-export-'));
		vault = path.join(work, 'vault');
		// `projectDir` is vault-relative (as wired in main.ts, under the config dir).
		projectDir = 'config/plugins/specorator/astro';
		distDir = path.join(vault, ...projectDir.split('/'), 'dist');
		await mkdir(vault, { recursive: true });
	});

	afterEach(async () => {
		await rm(work, { recursive: true, force: true });
	});

	it('copies the built dist/ into the chosen destination', async () => {
		await mkdir(path.join(distDir, 'assets'), { recursive: true });
		await writeFile(path.join(distDir, 'index.html'), '<html>home</html>');
		await writeFile(path.join(distDir, 'assets', 'app.css'), 'body{}');

		const dest = path.join(work, 'exported');
		const adapter = new BuildExportAdapter(projectDir, vault);
		const result = await adapter.exportBuild(dest);

		expect(result.exportedTo).toBe(path.resolve(dest));
		expect(await readFile(path.join(dest, 'index.html'), 'utf8')).toBe('<html>home</html>');
		expect(await readFile(path.join(dest, 'assets', 'app.css'), 'utf8')).toBe('body{}');
	});

	it('creates the destination directory when it does not exist', async () => {
		await mkdir(distDir, { recursive: true });
		await writeFile(path.join(distDir, 'index.html'), 'x');

		const dest = path.join(work, 'nested', 'deep', 'out');
		const adapter = new BuildExportAdapter(projectDir, vault);
		await adapter.exportBuild(dest);

		expect(await exists(path.join(dest, 'index.html'))).toBe(true);
	});

	it('never deletes pre-existing content in the destination (NFR-9)', async () => {
		await mkdir(distDir, { recursive: true });
		await writeFile(path.join(distDir, 'index.html'), 'new');

		const dest = path.join(work, 'exported');
		await mkdir(dest, { recursive: true });
		// A file the user already had in the destination, unrelated to the build.
		await writeFile(path.join(dest, 'KEEP_ME.txt'), 'precious');

		const adapter = new BuildExportAdapter(projectDir, vault);
		await adapter.exportBuild(dest);

		// The export added the build files and left the pre-existing file intact.
		expect(await readFile(path.join(dest, 'KEEP_ME.txt'), 'utf8')).toBe('precious');
		expect(await readFile(path.join(dest, 'index.html'), 'utf8')).toBe('new');
	});

	it('rejects with a clear message when there is no build to export', async () => {
		const dest = path.join(work, 'exported');
		const adapter = new BuildExportAdapter(projectDir, vault);

		await expect(adapter.exportBuild(dest)).rejects.toThrow(/No build to export/);
		await expect(adapter.exportBuild(dest)).rejects.toThrow(/Run "Build site" first/);
	});

	it('reveal degrades to a no-op when Electron shell is unavailable', async () => {
		const adapter = new BuildExportAdapter(projectDir, vault);
		// In the Node test runtime `require('electron')` throws, so reveal must
		// resolve without error rather than crash the export.
		await expect(adapter.reveal(path.join(work, 'exported'))).resolves.toBeUndefined();
	});
});
