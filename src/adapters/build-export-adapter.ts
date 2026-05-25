import { access, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizePath } from 'obsidian';
import type { BuildExportPort } from '../core/ports';

/** Project-relative directory `astro build` writes the static site into. */
const DIST_DIRNAME = 'dist';

/**
 * Minimal shape of Electron's `shell` we use to reveal a path in the OS file
 * manager. Resolved defensively at runtime (it is provided by the Obsidian
 * desktop runtime, not the `obsidian` module), so we never hard-import it.
 */
interface ElectronShell {
	openPath?(path: string): Promise<string>;
	showItemInFolder?(fullPath: string): void;
}

/**
 * Copies the built site out of the data folder and reveals it (FR-22 / D6). The
 * thin I/O half of the build/export flow: the decision of *whether* to export
 * (a destination is set; the build exists) is made by the composition root from
 * the export setting; this adapter only touches `node:fs` and the OS file
 * manager.
 *
 * - `exportBuild` recursively copies `<projectDir>/dist` into the chosen
 *   destination. It **copies into** the destination — `cp` overwrites only the
 *   files it writes and never removes anything already there — so an export can
 *   never delete unrelated user content (NFR-9). A missing `dist/` (the user
 *   never ran "Build site") rejects with a clear, user-fixable message rather
 *   than silently producing an empty export.
 * - `reveal` opens a path in the OS file manager via Electron's `shell`,
 *   resolved defensively: `showItemInFolder` for a file, `openPath` for a
 *   directory. If `shell` is unavailable it degrades to a no-op rather than
 *   throwing — the export already succeeded.
 *
 * Security invariant: this adapter never spawns a `child_process`; the copy is
 * a plain recursive file copy and the reveal goes through Electron's `shell`.
 */
export class BuildExportAdapter implements BuildExportPort {
	/**
	 * @param projectDir vault-relative Astro project dir (`<pluginDir>/astro`),
	 *   the parent of the built `dist/`.
	 * @param vaultBasePath absolute filesystem path of the vault root, used to
	 *   resolve the vault-relative project dir to an absolute source path.
	 */
	constructor(
		private readonly projectDir: string,
		private readonly vaultBasePath: string,
	) {}

	async exportBuild(destDir: string): Promise<{ exportedTo: string }> {
		const distAbs = this.distPath();
		if (!(await this.exists(distAbs))) {
			throw new Error(
				`No build to export: ${distAbs} does not exist. Run "Build site" first.`,
			);
		}

		const dest = path.resolve(destDir);
		await mkdir(dest, { recursive: true });
		// `recursive` copies the whole tree; it writes/overwrites only the files it
		// brings and leaves any pre-existing content in `dest` intact (NFR-9).
		await cp(distAbs, dest, { recursive: true });
		return { exportedTo: dest };
	}

	async reveal(absolutePath: string): Promise<void> {
		const shell = resolveShell();
		if (shell === null) {
			return;
		}
		// Prefer revealing the item in its containing folder when possible; fall
		// back to opening the path directly. Both are best-effort.
		if (typeof shell.openPath === 'function') {
			await shell.openPath(absolutePath);
		} else if (typeof shell.showItemInFolder === 'function') {
			shell.showItemInFolder(absolutePath);
		}
	}

	/** Absolute path of the built `dist/` inside the data-folder project. */
	private distPath(): string {
		return path.join(
			this.vaultBasePath,
			...normalizePath(this.projectDir).split('/'),
			DIST_DIRNAME,
		);
	}

	private async exists(absolute: string): Promise<boolean> {
		try {
			await access(absolute);
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * Defensively resolve Electron's `shell`. It lives in the desktop runtime, not
 * the `obsidian` module, so we `require` it through a guarded indirection and
 * return `null` if it is unavailable (e.g. an unexpected runtime) rather than
 * letting a missing module crash the export.
 */
function resolveShell(): ElectronShell | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const electron = require('electron') as { shell?: ElectronShell };
		return electron.shell ?? null;
	} catch {
		return null;
	}
}
