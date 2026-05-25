import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TFile, normalizePath, type App } from 'obsidian';
import type { ComponentLibraryTranspilePort } from '../core/ports';
import {
	isComponentLibraryNote,
	type TranspiledComponent,
} from '../core/domain/component-transpile';

/** The generated-tier subdirectories the transpiler may emit into. */
const GENERATED_SUBDIRS = ['views', 'layouts', 'components'] as const;

/**
 * Reads vault component-library notes and writes their transpiled `.astro`
 * modules into the project's `src/generated/` tree (FR-11f/g; DESIGN §5.6). The
 * thin I/O half of the code-fence library: the pure `transpileComponentNote`
 * decides *what* each note becomes (and the `TranspileLibrary` use-case decides
 * *whether* to run at all — the consent hard-gate, FR-18); this adapter only
 * touches the Vault API (read) and `node:fs` (write).
 *
 * - `readLibraryNotes` returns the raw markdown of every markdown note inside
 *   the configured library folder, read via `cachedRead` (OBS-2: Vault API).
 *   It uses the pure {@link isComponentLibraryNote} predicate so "inside the
 *   folder" matches exactly the FR-11i leakage rule.
 * - `writeGenerated` rewrites the generated tier it owns: it clears
 *   `src/generated/{views,layouts,components}` then writes the transpiled set,
 *   so removed/renamed component notes leave no stale module. The replacement is
 *   scoped to `src/generated/` ONLY — it never deletes vault content or
 *   hand-written `src/user/` files (NFR-9 — data-loss safety).
 *
 * `child_process` is never used here, and nothing content-derived is ever
 * spawned (FR-18): the only build-time execution is the consented Astro build
 * of the emitted components, the inherent disclosed risk (DESIGN §5.10).
 */
export class ComponentLibraryAdapter implements ComponentLibraryTranspilePort {
	constructor(
		private readonly app: App,
		private readonly projectDir: string,
	) {}

	async readLibraryNotes(folder: string): Promise<{ path: string; raw: string }[]> {
		const target = normalizePath(folder);
		const notes: { path: string; raw: string }[] = [];
		// Vault API over the file system adapter (OBS-2). Markdown files only — a
		// component note is always a `.md`; non-markdown in the folder is ignored.
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!(file instanceof TFile)) continue;
			if (!isComponentLibraryNote(file.path, target)) continue;
			const raw = await this.app.vault.cachedRead(file);
			notes.push({ path: file.path, raw });
		}
		// Stable order so the emitted set + any warnings are deterministic.
		notes.sort((a, b) => a.path.localeCompare(b.path));
		return notes;
	}

	async writeGenerated(components: readonly TranspiledComponent[]): Promise<void> {
		const generatedRoot = path.join(normalizePath(this.projectDir), 'src', 'generated');

		// Clear the generated tier we own (NFR-9: generated/ only — never user/ or
		// the vault). Recreate the subdirs so the registry glob always resolves.
		for (const sub of GENERATED_SUBDIRS) {
			const dir = path.join(generatedRoot, sub);
			await rm(dir, { recursive: true, force: true });
			await mkdir(dir, { recursive: true });
		}

		for (const component of components) {
			// `component.path` is project-relative (`src/generated/views/X.astro`).
			const dest = path.join(normalizePath(this.projectDir), ...component.path.split('/'));
			await mkdir(path.dirname(dest), { recursive: true });
			await writeFile(dest, component.contents, 'utf8');
		}
	}
}
