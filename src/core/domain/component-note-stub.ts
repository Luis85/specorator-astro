/**
 * Pure scaffolding for **vault component notes** (FR-11h/k; DESIGN §5.6). These
 * are the authoring-side counterparts to the project-side `scaffold-stub.ts`
 * (which writes `.astro` into `src/user/`). Here we produce the **markdown note**
 * a user authors in the library folder: `component:` frontmatter + a ready-to-
 * edit ` ```astro ` fence. The transpiler later turns this note into a generated
 * `.astro` (behind consent). No I/O — the vault create/insert is the adapter's
 * job; this only builds the text + the destination filename.
 *
 * The right-click "Insert Astro component block" affordance drops just the fence
 * ({@link astroFenceSnippet}); the "Create component" / "New component note"
 * affordances scaffold a whole note ({@link buildComponentNote}).
 */

import type { ComponentKind } from './component-transpile';

/** The ```astro code-fence snippet inserted at the cursor (FR-11k). */
export function astroFenceSnippet(): string {
	// A minimal, immediately-valid Astro component scaffold inside the fence.
	return [
		'```astro',
		'---',
		'// Astro component frontmatter (runs at build time).',
		'const { entry } = Astro.props;',
		'---',
		'<article>',
		'  <h3>{entry?.values?.["file.name"]}</h3>',
		'</article>',
		'```',
		'',
	].join('\n');
}

/** A scaffolded component note: its vault filename + full markdown contents. */
export interface ComponentNoteStub {
	/** Filename (basename + `.md`) to create inside the library folder. */
	fileName: string;
	/** The full note markdown (frontmatter + fence). */
	contents: string;
}

/**
 * Sanitize a requested component name into a safe note basename: keep
 * alphanumerics, dash, underscore; collapse the rest to a dash; trim dashes.
 * Falls back to `NewComponent` so a filename is always produced.
 */
export function componentNoteBasename(name: string): string {
	const cleaned = name
		.trim()
		.replace(/\.md$/i, '')
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return cleaned === '' ? 'NewComponent' : cleaned;
}

/**
 * Build a full component note (frontmatter + stub fence) for the "Create
 * component" / "New component note" affordances (FR-11h/k). The note is valid
 * Obsidian markdown — it renders harmlessly as frontmatter + a fenced code block
 * — and is a well-formed component the transpiler will accept once consent is
 * granted. `kind` defaults to a view; the props list is left empty (advisory).
 */
export function buildComponentNote(name: string, kind: ComponentKind = 'view'): ComponentNoteStub {
	const basename = componentNoteBasename(name);
	const contents = [
		'---',
		'component:',
		`    name: ${basename}`,
		`    kind: ${kind}`,
		'    appliesTo: []',
		'    props: []',
		'---',
		'',
		'> [!warning] Build-time code execution',
		'> The `astro` block below runs at build time with no sandbox. Only enable the',
		'> component library for notes you trust (see the plugin consent prompt).',
		'',
		astroFenceSnippet(),
	].join('\n');
	return { fileName: `${basename}.md`, contents };
}
