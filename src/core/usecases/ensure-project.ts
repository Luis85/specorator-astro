import type { BootstrapDriverPort, ProjectBootstrapPort } from '../ports';
import type { TemplateFile } from '../domain/template';

/** What a single `ensureProject()` run did, for diagnostics/tests. */
export interface EnsureProjectResult {
	projectDir: string;
	/** Template-owned files (re)written this run (always, for upgrade-safety). */
	templateFilesWritten: string[];
	/** User-owned files created this run (only those that were absent). */
	userFilesCreated: string[];
	/** User-owned files left untouched because they already existed (NFR-9). */
	userFilesPreserved: string[];
	/** Whether dependencies were installed this run (false if already present). */
	installedDependencies: boolean;
}

/**
 * Decides if/what to scaffold and install for the bundled Astro project, then
 * drives the low-level `BootstrapDriverPort` to do the I/O. All the decision
 * logic lives here so it is pure and unit-testable with an in-memory fake; the
 * adapter only performs the raw filesystem/process primitives.
 *
 * Idempotent & resumable (DESIGN §5.9), so it is safe to call before every
 * sync/preview/build:
 *
 * - **Template-owned** files (`src/theme/**`, config, registry) are rewritten on
 *   every run, which doubles as the upgrade path (FR-11a / NFR-7).
 * - **User-owned** files (`src/user/**`, e.g. `theme.css`) are written **only
 *   when absent** — an existing one is never overwritten (NFR-9, no data loss).
 * - Dependencies are installed only when missing; a failed install (e.g.
 *   offline) **propagates** rather than being swallowed (FR-17 / D10), and the
 *   next run resumes from where it left off.
 */
export class EnsureProject implements ProjectBootstrapPort {
	constructor(private readonly driver: BootstrapDriverPort) {}

	async ensureProject(): Promise<{ projectDir: string }> {
		await this.run();
		return { projectDir: this.driver.projectDir };
	}

	/** Run the bootstrap and return a detailed report (used by tests/diagnostics). */
	async run(): Promise<EnsureProjectResult> {
		const templateFilesWritten: string[] = [];
		const userFilesCreated: string[] = [];
		const userFilesPreserved: string[] = [];

		for (const file of this.driver.templateFiles()) {
			if (file.ownership === 'user') {
				await this.ensureUserFile(file, userFilesCreated, userFilesPreserved);
			} else {
				await this.driver.writeFile(file.path, file.contents);
				templateFilesWritten.push(file.path);
			}
		}

		const alreadyInstalled = await this.driver.dependenciesInstalled();
		if (!alreadyInstalled) {
			await this.driver.installDependencies();
		}

		return {
			projectDir: this.driver.projectDir,
			templateFilesWritten,
			userFilesCreated,
			userFilesPreserved,
			installedDependencies: !alreadyInstalled,
		};
	}

	private async ensureUserFile(
		file: TemplateFile,
		created: string[],
		preserved: string[],
	): Promise<void> {
		if (await this.driver.fileExists(file.path)) {
			preserved.push(file.path);
			return;
		}
		await this.driver.writeFile(file.path, file.contents);
		created.push(file.path);
	}
}
