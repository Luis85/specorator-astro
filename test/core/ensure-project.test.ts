import { describe, expect, it, vi } from 'vitest';
import { EnsureProject } from '../../src/core/usecases/ensure-project';
import type { BootstrapDriverPort } from '../../src/core/ports';
import type { TemplateFile } from '../../src/core/domain/template';

/** In-memory fake of the low-level bootstrap driver (no real I/O). */
class FakeDriver implements BootstrapDriverPort {
	readonly projectDir = '/data/astro';
	readonly writes = new Map<string, string>();
	installs = 0;

	constructor(
		private readonly files: TemplateFile[],
		private readonly existing: Set<string> = new Set(),
		private depsPresent = false,
		private readonly installImpl: () => Promise<void> = async () => {},
	) {}

	templateFiles(): TemplateFile[] {
		return this.files;
	}

	async fileExists(path: string): Promise<boolean> {
		return this.existing.has(path) || this.writes.has(path);
	}

	async dependenciesInstalled(): Promise<boolean> {
		return this.depsPresent;
	}

	async writeFile(path: string, contents: string): Promise<void> {
		this.writes.set(path, contents);
	}

	async installDependencies(): Promise<void> {
		this.installs += 1;
		this.depsPresent = true;
		await this.installImpl();
	}
}

const tmpl = (path: string, ownership: 'template' | 'user'): TemplateFile => ({
	path,
	contents: `// ${path}`,
	ownership,
});

describe('EnsureProject', () => {
	it('scaffolds template and user files and installs deps on a clean project', async () => {
		const driver = new FakeDriver([
			tmpl('package.json', 'template'),
			tmpl('src/theme/styles/tokens.css', 'template'),
			tmpl('src/user/theme.css', 'user'),
		]);

		const result = await new EnsureProject(driver).run();

		expect(result.projectDir).toBe('/data/astro');
		expect(result.templateFilesWritten).toEqual([
			'package.json',
			'src/theme/styles/tokens.css',
		]);
		expect(result.userFilesCreated).toEqual(['src/user/theme.css']);
		expect(result.userFilesPreserved).toEqual([]);
		expect(result.installedDependencies).toBe(true);
		expect(driver.installs).toBe(1);
		expect(driver.writes.get('src/user/theme.css')).toBe('// src/user/theme.css');
	});

	it('rewrites template files but never overwrites existing user files (no data loss)', async () => {
		const driver = new FakeDriver(
			[
				tmpl('src/theme/views/Placeholder.astro', 'template'),
				tmpl('src/user/theme.css', 'user'),
			],
			new Set(['src/user/theme.css']),
			true,
		);

		const result = await new EnsureProject(driver).run();

		expect(result.templateFilesWritten).toEqual(['src/theme/views/Placeholder.astro']);
		expect(result.userFilesCreated).toEqual([]);
		expect(result.userFilesPreserved).toEqual(['src/user/theme.css']);
		// The pre-existing user file must not have been written over.
		expect(driver.writes.has('src/user/theme.css')).toBe(false);
	});

	it('skips install when dependencies are already present', async () => {
		const driver = new FakeDriver([tmpl('package.json', 'template')], new Set(), true);

		const result = await new EnsureProject(driver).run();

		expect(result.installedDependencies).toBe(false);
		expect(driver.installs).toBe(0);
	});

	it('is idempotent: a second run preserves user files and re-runs no install', async () => {
		const driver = new FakeDriver([
			tmpl('package.json', 'template'),
			tmpl('src/user/theme.css', 'user'),
		]);

		const first = await new EnsureProject(driver).run();
		expect(first.userFilesCreated).toEqual(['src/user/theme.css']);
		expect(first.installedDependencies).toBe(true);

		const second = await new EnsureProject(driver).run();
		expect(second.userFilesCreated).toEqual([]);
		expect(second.userFilesPreserved).toEqual(['src/user/theme.css']);
		expect(second.installedDependencies).toBe(false);
		expect(driver.installs).toBe(1);
	});

	it('propagates an install failure (e.g. offline) rather than swallowing it', async () => {
		const driver = new FakeDriver(
			[tmpl('package.json', 'template')],
			new Set(),
			false,
			async () => {
				throw new Error('npm install failed: offline');
			},
		);

		await expect(new EnsureProject(driver).run()).rejects.toThrow(/offline/);
	});

	it('ensureProject() returns the project dir and is the port contract', async () => {
		const driver = new FakeDriver([tmpl('package.json', 'template')]);
		const ensureSpy = vi.spyOn(driver, 'installDependencies');

		const { projectDir } = await new EnsureProject(driver).ensureProject();

		expect(projectDir).toBe('/data/astro');
		expect(ensureSpy).toHaveBeenCalledTimes(1);
	});
});
