import { EventEmitter } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolchainConfig } from '../../src/core/domain/settings-migration';

// Intercept the real spawn so the binary-resolution branches can be asserted
// without launching a process. `spawn` is captured as a vi.fn whose return is a
// fake ChildProcess that emits a dev URL line on stdout so `startDev()` resolves.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args) as unknown,
}));

// The adapter uses `window.setTimeout`/`clearTimeout` (Obsidian's renderer
// global) for the dev-URL timeout. The node test env has no `window`, so shim it
// onto the global with node's timers before importing the adapter.
(globalThis as { window?: unknown }).window ??= {
	setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
	clearTimeout: (id: ReturnType<typeof setTimeout>) => {
		clearTimeout(id);
	},
};

// Imported AFTER the mock is registered so the adapter binds to the mocked spawn.
const { AstroProcessAdapter } = await import('../../src/adapters/astro-process-adapter');

/** A minimal fake ChildProcess: EventEmitter streams + a pid + a settable url emit. */
interface FakeChild extends EventEmitter {
	pid: number;
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill(): void;
}

function makeFakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.pid = 4242;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = () => undefined;
	return child;
}

const PROJECT_DIR = '/vault/.obsidian/plugins/specorator/astro';

/** Build a toolchain config; only the overrides under test need to vary. */
function toolchain(overrides: Partial<ToolchainConfig> = {}): ToolchainConfig {
	return { port: 4321, nodePath: undefined, astroBinPath: undefined, ...overrides };
}

/** Drive `startDev()` to resolution and return the captured spawn (command, args). */
async function captureDevSpawn(
	config: ToolchainConfig,
): Promise<{ command: string; args: string[] }> {
	const child = makeFakeChild();
	// `startDev()` awaits `stop()` (a microtask) before spawning + attaching the
	// stdout listener, so emit the URL line ONLY once spawn has been called and
	// the listener is wired — do it from the mock itself, on a later tick.
	spawnMock.mockImplementationOnce(() => {
		queueMicrotask(() => {
			child.stdout.emit('data', Buffer.from('  Local   http://localhost:4321/\n'));
		});
		return child;
	});

	const adapter = new AstroProcessAdapter(PROJECT_DIR, () => config);
	await adapter.startDev();

	const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
	return { command, args };
}

describe('AstroProcessAdapter — binary resolution (NFR-4)', () => {
	const realPlatform = process.platform;

	beforeEach(() => {
		spawnMock.mockReset();
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: realPlatform });
	});

	it('uses the project-local node_modules/.bin/astro by default (POSIX)', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const { command, args } = await captureDevSpawn(toolchain());

		expect(command).toBe(path.join(PROJECT_DIR, 'node_modules', '.bin', 'astro'));
		expect(args).toEqual(['dev', '--port', '4321']);

		// Spawned detached (so the whole Vite group can be torn down) without a shell.
		const opts = spawnMock.mock.calls[0][2] as {
			detached: boolean;
			shell: boolean;
			cwd: string;
		};
		expect(opts.detached).toBe(true);
		expect(opts.shell).toBe(false);
		expect(opts.cwd).toBe(PROJECT_DIR);
	});

	it('uses the .cmd shim through a shell on Windows', async () => {
		Object.defineProperty(process, 'platform', { value: 'win32' });
		const { command } = await captureDevSpawn(toolchain());

		expect(command).toBe(path.join(PROJECT_DIR, 'node_modules', '.bin', 'astro.cmd'));
		const opts = spawnMock.mock.calls[0][2] as { shell: boolean };
		// The .cmd shim must run through a shell.
		expect(opts.shell).toBe(true);
	});

	it('honors an explicit astroBinPath override (run directly, no shell)', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const { command, args } = await captureDevSpawn(
			toolchain({ astroBinPath: '/custom/bin/astro' }),
		);

		expect(command).toBe('/custom/bin/astro');
		expect(args).toEqual(['dev', '--port', '4321']);
		const opts = spawnMock.mock.calls[0][2] as { shell: boolean };
		expect(opts.shell).toBe(false);
	});

	it('drives the Astro entry script through an explicit nodePath override', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const { command, args } = await captureDevSpawn(
			toolchain({ nodePath: '/opt/node/bin/node' }),
		);

		expect(command).toBe('/opt/node/bin/node');
		// node <astro.js> <...args> — dodges a broken GUI PATH for Node itself.
		expect(args).toEqual([
			path.join(PROJECT_DIR, 'node_modules', 'astro', 'astro.js'),
			'dev',
			'--port',
			'4321',
		]);
		const opts = spawnMock.mock.calls[0][2] as { shell: boolean };
		expect(opts.shell).toBe(false);
	});

	it('with both nodePath and astroBinPath, runs the override entry via node', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const { command, args } = await captureDevSpawn(
			toolchain({ nodePath: '/opt/node/bin/node', astroBinPath: '/custom/astro-entry.js' }),
		);

		expect(command).toBe('/opt/node/bin/node');
		// The astroBinPath becomes the entry script node is pointed at.
		expect(args).toEqual(['/custom/astro-entry.js', 'dev', '--port', '4321']);
	});

	it('build() resolves the same default binary with the build arg', async () => {
		Object.defineProperty(process, 'platform', { value: 'linux' });
		const child = makeFakeChild();
		// `build()` also awaits `stop()` before spawning + attaching listeners, so
		// signal exit 0 only after spawn has run and the `close` listener is wired.
		spawnMock.mockImplementationOnce(() => {
			queueMicrotask(() => child.emit('close', 0));
			return child;
		});

		const adapter = new AstroProcessAdapter(PROJECT_DIR, () => toolchain());
		await adapter.build();

		const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(command).toBe(path.join(PROJECT_DIR, 'node_modules', '.bin', 'astro'));
		expect(args).toEqual(['build']);
	});
});
