import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { BootstrapDriverPort } from '../core/ports';
import type { TemplateFile } from '../core/domain/template';
import { EMBEDDED_TEMPLATE_FILES } from './generated/embedded-template';

/** Visible channel for streaming bootstrap progress (install logs, errors). */
export interface BootstrapOutput {
	write(line: string): void;
}

const noopOutput: BootstrapOutput = { write: () => undefined };

/**
 * Low-level bootstrap I/O for the Astro project (DESIGN §5.9). Thin by design:
 * every decision (idempotency, never-overwrite-user-files, when to install)
 * lives in the pure `EnsureProject` use-case that drives these primitives. This
 * adapter only touches `node:fs` and the project-local toolchain.
 *
 * `child_process` only ever spawns `npm` (the project-local toolchain), never a
 * content-derived command (security invariant).
 */
export class ProjectBootstrapAdapter implements BootstrapDriverPort {
	constructor(
		readonly projectDir: string,
		private readonly output: BootstrapOutput = noopOutput,
		/** Override the embedded template (used by adapter tests). */
		private readonly embedded: readonly TemplateFile[] = EMBEDDED_TEMPLATE_FILES,
	) {}

	templateFiles(): TemplateFile[] {
		return this.embedded.map((file) => ({ ...file }));
	}

	async fileExists(projectRelativePath: string): Promise<boolean> {
		return this.exists(path.join(this.projectDir, projectRelativePath));
	}

	async dependenciesInstalled(): Promise<boolean> {
		// `astro` resolving under node_modules/.bin is the proof deps installed.
		const bin = process.platform === 'win32' ? 'astro.cmd' : 'astro';
		return this.exists(path.join(this.projectDir, 'node_modules', '.bin', bin));
	}

	async writeFile(projectRelativePath: string, contents: string): Promise<void> {
		const target = path.join(this.projectDir, projectRelativePath);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, contents, 'utf8');
	}

	async installDependencies(): Promise<void> {
		await mkdir(this.projectDir, { recursive: true });
		this.output.write(`[specorator] Installing Astro dependencies in ${this.projectDir}…\n`);
		// `--legacy-peer-deps` per FR-17 (the .npmrc also sets it). On Windows the
		// npm binary is a .cmd, so spawn through a shell there.
		await this.runNpm(['install', '--legacy-peer-deps']);
		this.output.write('[specorator] Dependency install complete.\n');
	}

	private async exists(absolute: string): Promise<boolean> {
		try {
			await access(absolute);
			return true;
		} catch {
			return false;
		}
	}

	private runNpm(args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawn('npm', args, {
				cwd: this.projectDir,
				shell: process.platform === 'win32',
			});
			child.stdout?.on('data', (chunk: Buffer) => this.output.write(chunk.toString()));
			child.stderr?.on('data', (chunk: Buffer) => this.output.write(chunk.toString()));
			child.on('error', (error) => {
				reject(
					new Error(
						`npm install failed to start (is Node/npm on PATH?): ${error.message}`,
						{ cause: error },
					),
				);
			});
			child.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					// Surface, don't swallow (FR-17 / D10): offline or peer-dep failures.
					reject(new Error(`npm install exited with code ${String(code)}.`));
				}
			});
		});
	}
}
