import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectBootstrapAdapter } from '../../src/adapters/project-bootstrap-adapter';
import { EnsureProject } from '../../src/core/usecases/ensure-project';
import type { TemplateFile } from '../../src/core/domain/template';

const fixtureFiles: TemplateFile[] = [
	{ path: 'package.json', contents: '{"name":"x"}\n', ownership: 'template' },
	{ path: 'src/theme/styles/tokens.css', contents: ':root{}\n', ownership: 'template' },
	{ path: 'src/user/theme.css', contents: '/* user */\n', ownership: 'user' },
];

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

describe('ProjectBootstrapAdapter (temp-dir contract)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'specorator-bootstrap-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('writes template files out to disk via EnsureProject, creating parent dirs', async () => {
		// dependenciesInstalled is faked-true by pre-creating the astro bin so the
		// test never spawns a real, slow `npm install`.
		const binDir = path.join(dir, 'node_modules', '.bin');
		await mkdir(binDir, { recursive: true });
		await writeFile(path.join(binDir, 'astro'), '');

		const adapter = new ProjectBootstrapAdapter(dir, undefined, fixtureFiles);
		const result = await new EnsureProject(adapter).run();

		expect(result.installedDependencies).toBe(false);
		expect(await readFile(path.join(dir, 'package.json'), 'utf8')).toBe('{"name":"x"}\n');
		expect(await readFile(path.join(dir, 'src/theme/styles/tokens.css'), 'utf8')).toBe(
			':root{}\n',
		);
		expect(await readFile(path.join(dir, 'src/user/theme.css'), 'utf8')).toBe('/* user */\n');
	});

	it('never overwrites an existing user file on re-bootstrap (NFR-9)', async () => {
		const binDir = path.join(dir, 'node_modules', '.bin');
		await mkdir(binDir, { recursive: true });
		await writeFile(path.join(binDir, 'astro'), '');

		// Simulate a user who already customized their theme.
		await mkdir(path.join(dir, 'src/user'), { recursive: true });
		const userTheme = path.join(dir, 'src/user/theme.css');
		await writeFile(userTheme, '/* MY CUSTOM THEME */\n');

		const adapter = new ProjectBootstrapAdapter(dir, undefined, fixtureFiles);
		const result = await new EnsureProject(adapter).run();

		expect(result.userFilesPreserved).toContain('src/user/theme.css');
		expect(result.userFilesCreated).not.toContain('src/user/theme.css');
		expect(await readFile(userTheme, 'utf8')).toBe('/* MY CUSTOM THEME */\n');
	});

	it('reports dependencies as not installed before any install', async () => {
		const adapter = new ProjectBootstrapAdapter(dir, undefined, fixtureFiles);
		expect(await adapter.dependenciesInstalled()).toBe(false);
		expect(await exists(path.join(dir, 'node_modules'))).toBe(false);
	});
});
