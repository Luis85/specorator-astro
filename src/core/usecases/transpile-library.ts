import { shouldTranspileLibrary } from '../domain/consent';
import { transpileComponentNote, type TranspiledComponent } from '../domain/component-transpile';
import type { ComponentLibraryPort, ComponentLibraryTranspilePort } from '../ports';

/** Outcome of a library transpile pass (for surfacing as Notices/warnings). */
export interface TranspileLibraryResult {
	/**
	 * Whether the consent gate was OPEN (FR-18). `false` means the whole step was
	 * a hard no-op — no notes were read for emission and nothing was written.
	 */
	consented: boolean;
	/** How many component notes were transpiled + emitted to `src/generated/`. */
	emitted: number;
	/** Non-fatal per-note skip reasons (a note that is not a well-formed component). */
	warnings: string[];
}

/**
 * Transpiles the vault code-fence component library into `src/generated/`,
 * **behind the one-time build-execution consent gate** (FR-11f/g, FR-18 / D11;
 * DESIGN §5.6, §5.10). Pure orchestration — the consent decision
 * (`shouldTranspileLibrary`) and the per-note transpile (`transpileComponentNote`)
 * are pure; all I/O is delegated to ports, so this is unit-testable with
 * in-memory fakes and no Obsidian/Node.
 *
 * The hard gate is the load-bearing invariant: when consent is **not** granted
 * the use-case returns immediately with `consented: false` and **never** calls
 * the transpile port's read/write — so no `.astro` is generated and nothing the
 * user authored ever reaches the build. Only an explicit grant opens it; a
 * revoked or absent grant keeps it shut. Existing `src/generated/` files are not
 * deleted by a closed gate (NFR-9: regeneration only ever writes generated/);
 * clearing them is a separate explicit action.
 *
 * When open, it reads every library note, transpiles each (skipping
 * non-component notes with a reason, never throwing), and writes the transpiled
 * set into `src/generated/` (generated tier only — NFR-9). The wiring is
 * gated *before* any read so a closed gate is observably inert.
 */
export class TranspileLibrary {
	constructor(
		private readonly library: ComponentLibraryPort,
		private readonly transpiler: ComponentLibraryTranspilePort,
	) {}

	async run(): Promise<TranspileLibraryResult> {
		const config = this.library.readLibraryConfig();

		// HARD GATE (FR-18): no consent → no read, no transpile, no write. The
		// generated-output step is observably a NO-OP. This MUST precede all I/O.
		if (!shouldTranspileLibrary(config.consent)) {
			return { consented: false, emitted: 0, warnings: [] };
		}

		const notes = await this.transpiler.readLibraryNotes(config.folder);

		const components: TranspiledComponent[] = [];
		const warnings: string[] = [];
		for (const note of notes) {
			const result = transpileComponentNote(note.raw);
			if (result.outcome === 'transpiled') {
				components.push(result);
			} else {
				warnings.push(`Skipped ${note.path}: ${result.reason}`);
			}
		}

		// Write the transpiled set into src/generated/ (generated tier only, NFR-9).
		await this.transpiler.writeGenerated(components);

		return { consented: true, emitted: components.length, warnings };
	}
}
