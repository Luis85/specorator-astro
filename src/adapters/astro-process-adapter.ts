import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import type { AstroProcessPort } from '../core/ports';
import type { ToolchainConfig } from '../core/domain/settings-migration';
import { parseDevServerUrl } from '../core/domain/dev-url';

/** Visible channel for streaming dev/build stdout+stderr (build errors, URLs). */
export interface ProcessOutput {
	write(line: string): void;
}

const noopOutput: ProcessOutput = { write: () => undefined };

/** Reads the user's current toolchain/dev-server config at the moment of spawn. */
export type ToolchainResolver = () => ToolchainConfig;

/** How long to wait for `astro dev` to print its URL before giving up. */
const DEV_URL_TIMEOUT_MS = 60_000;

/**
 * Runs the project-local Astro binary out-of-process (DESIGN §5.3). It is the
 * default runner (NFR-2): a Vite dev server is heavy and long-running, so
 * isolating it from Obsidian's renderer avoids freezing the UI and contains
 * crashes/leaks. Responsibilities:
 *
 * - **Binary resolution (NFR-4).** Prefer the settings `astroBinPath` override;
 *   otherwise the project-local `node_modules/.bin/astro` (`.cmd` on Windows).
 *   On Windows the binary is a `.cmd`, so spawn through a shell. A `nodePath`
 *   override lets the user point at a specific Node when GUI `PATH` resolution
 *   fails (the macOS GUI-app `PATH` gap), in which case we invoke
 *   `node <astro-js> <cmd>` directly.
 * - **Authoritative dev URL.** Astro auto-falls-back to another port if the
 *   requested one is busy, so the URL it *prints* — not the port we asked for —
 *   is authoritative. `startDev()` passes `--port` but resolves with the URL
 *   parsed from stdout (`parseDevServerUrl`).
 * - **Visible output.** stdout/stderr are piped to a `ProcessOutput` channel so
 *   build failures and dev logs are visible (FR-6 / DESIGN §5.3).
 * - **Process-tree teardown (NFR-4).** `child.kill()` only ends the shell,
 *   orphaning Vite's esbuild/worker descendants that keep holding the port. We
 *   spawn `detached: true` and kill the whole group via `process.kill(-pid)` on
 *   POSIX; on Windows we `taskkill /pid <pid> /T /F`. `stop()` awaits exit.
 *
 * Security invariant: `child_process` only ever spawns the resolved
 * project-local toolchain (the Astro binary / Node), never a content-derived
 * command.
 */
export class AstroProcessAdapter implements AstroProcessPort {
	private proc: ChildProcess | null = null;

	constructor(
		private readonly projectDir: string,
		private readonly toolchain: ToolchainResolver,
		private readonly output: ProcessOutput = noopOutput,
	) {}

	async startDev(): Promise<{ url: string }> {
		const { port } = this.toolchain();
		const child = this.spawnAstro(['dev', '--port', String(port)]);
		this.proc = child;

		return new Promise<{ url: string }>((resolve, reject) => {
			let settled = false;
			let buffer = '';

			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				window.clearTimeout(timer);
				fn();
			};

			const timer = window.setTimeout(() => {
				finish(() => {
					void this.stop();
					reject(
						new Error(
							`Astro dev server did not print a URL within ${String(
								DEV_URL_TIMEOUT_MS / 1000,
							)}s.`,
						),
					);
				});
			}, DEV_URL_TIMEOUT_MS);

			const onData = (chunk: Buffer) => {
				const text = chunk.toString();
				this.output.write(text);
				buffer += text;
				const url = parseDevServerUrl(buffer);
				if (url !== null) {
					finish(() => resolve({ url }));
				}
			};

			child.stdout?.on('data', onData);
			child.stderr?.on('data', (chunk: Buffer) => this.output.write(chunk.toString()));

			child.on('error', (error) => {
				finish(() => reject(this.spawnError(error)));
			});

			child.on('close', (code) => {
				// Exiting before a URL appears is a startup failure (e.g. ENOENT,
				// config error). After resolution, a normal lifecycle close is ignored.
				finish(() =>
					reject(
						new Error(
							`Astro dev server exited before printing a URL (code ${String(code)}).`,
						),
					),
				);
				this.proc = null;
			});
		});
	}

	async build(): Promise<void> {
		const child = this.spawnAstro(['build']);
		this.proc = child;

		return new Promise<void>((resolve, reject) => {
			child.stdout?.on('data', (chunk: Buffer) => this.output.write(chunk.toString()));
			child.stderr?.on('data', (chunk: Buffer) => this.output.write(chunk.toString()));

			child.on('error', (error) => {
				this.proc = null;
				reject(this.spawnError(error));
			});

			child.on('close', (code) => {
				this.proc = null;
				if (code === 0) {
					resolve();
				} else {
					// Surface, don't swallow (FR-6): the piped output already showed why.
					reject(new Error(`Astro build failed (exit code ${String(code)}).`));
				}
			});
		});
	}

	async stop(): Promise<void> {
		const child = this.proc;
		this.proc = null;
		if (child?.pid === undefined) {
			return;
		}
		await killTree(child);
	}

	/**
	 * Spawn the resolved Astro command. Resolution order (NFR-4):
	 * 1. explicit `nodePath` override → `node <astro-entry-js> <args>` (dodges a
	 *    broken GUI `PATH` for Node itself);
	 * 2. explicit `astroBinPath` override → run that binary directly;
	 * 3. project-local `node_modules/.bin/astro` (`.cmd` on Windows).
	 *
	 * Always spawned `detached: true` with `cwd` = the project so the whole Vite
	 * process group can be torn down together (see {@link killTree}). On Windows
	 * the `.cmd` shim needs `shell: true`.
	 */
	private spawnAstro(args: string[]): ChildProcess {
		const { nodePath, astroBinPath } = this.toolchain();
		const isWindows = process.platform === 'win32';

		let command: string;
		let commandArgs: string[];
		if (nodePath !== undefined && nodePath !== '') {
			// Drive the Astro entry script through the chosen Node binary.
			const astroEntry =
				astroBinPath ?? path.join(this.projectDir, 'node_modules', 'astro', 'astro.js');
			command = nodePath;
			commandArgs = [astroEntry, ...args];
		} else {
			command = astroBinPath ?? this.defaultBinary(isWindows);
			commandArgs = args;
		}

		return spawn(command, commandArgs, {
			cwd: this.projectDir,
			detached: true,
			// The Windows .cmd shim must run through a shell; a plain Node binary
			// path does not.
			shell: isWindows && command.endsWith('.cmd'),
		});
	}

	/** Project-local Astro binary path; `astro.cmd` on Windows, `astro` elsewhere. */
	private defaultBinary(isWindows: boolean): string {
		const bin = isWindows ? 'astro.cmd' : 'astro';
		return path.join(this.projectDir, 'node_modules', '.bin', bin);
	}

	/** Wrap an ENOENT-style spawn failure with the PATH guidance from DESIGN §5.3. */
	private spawnError(error: Error): Error {
		return new Error(
			`Could not start the Astro toolchain (is Node installed and the project set up? On macOS, set a Node binary path in settings): ${error.message}`,
			{ cause: error },
		);
	}
}

/**
 * Kill the child's whole process group and await its exit (NFR-4). `detached`
 * spawning puts the child at the head of a new group whose id equals its pid;
 * `process.kill(-pid)` signals every member, so Vite's esbuild/worker
 * descendants die with the shell instead of orphaning and holding the port.
 * On Windows there are no process groups, so `taskkill /T /F` walks the tree.
 */
function killTree(child: ChildProcess): Promise<void> {
	const pid = child.pid;
	if (pid === undefined) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		const done = () => resolve();
		child.once('close', done);
		child.once('exit', done);

		try {
			if (process.platform === 'win32') {
				// No POSIX process groups on Windows: walk and force-kill the tree.
				spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
			} else {
				// Negative pid targets the whole detached group, not just the shell.
				process.kill(-pid, 'SIGTERM');
			}
		} catch {
			// The process may already be gone (race on teardown); resolve anyway.
			done();
		}
	});
}
