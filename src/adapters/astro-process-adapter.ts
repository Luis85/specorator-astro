import type { ChildProcess } from 'node:child_process';
import type { AstroProcessPort } from '../core/ports';

/**
 * Runs the project-local Astro binary out-of-process (phase 1). On teardown it
 * must kill the whole process tree, not just the shell (see docs/DESIGN.md §5.3).
 */
export class AstroProcessAdapter implements AstroProcessPort {
	private proc: ChildProcess | null = null;

	constructor(private readonly projectDir: string) {}

	async startDev(): Promise<{ url: string }> {
		throw new Error(`Astro dev server is not implemented yet (project: ${this.projectDir}).`);
	}

	async build(): Promise<void> {
		throw new Error(`Astro build is not implemented yet (project: ${this.projectDir}).`);
	}

	async stop(): Promise<void> {
		this.proc?.kill();
		this.proc = null;
	}
}
