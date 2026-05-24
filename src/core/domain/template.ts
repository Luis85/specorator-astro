/**
 * Domain types describing the bundled Astro project template.
 *
 * The template is the editable source of truth under `templates/astro/**`; a
 * build step (see `scripts/embed-template.mjs`) serializes it into a generated
 * TS module so it ships embedded in `main.js` (DESIGN §5.9, DIST-BRAT-1). The
 * bootstrap adapter writes these files out into `<pluginDir>/astro` on first
 * run. Pure: no I/O, no `obsidian`, no Node.
 */

/**
 * Ownership of a templated file (DESIGN §5.6, FR-11a / NFR-7):
 *
 * - `template` — template-owned. Replaced wholesale on every plugin upgrade.
 * - `user` — user-owned. Written once on first bootstrap and NEVER overwritten,
 *   so the user's customizations survive upgrades.
 */
export type TemplateFileOwnership = 'template' | 'user';

/** One file in the bundled Astro project template. */
export interface TemplateFile {
	/** Project-relative POSIX path, e.g. `src/theme/styles/tokens.css`. */
	path: string;
	/** UTF-8 file contents. */
	contents: string;
	/** Whether the file is template-owned (upgradable) or user-owned (preserved). */
	ownership: TemplateFileOwnership;
}

/** The full bundled template: every file plus its ownership classification. */
export interface TemplateManifest {
	files: TemplateFile[];
}

/**
 * Classify a project-relative path as user-owned or template-owned.
 *
 * The seam is purely the path prefix (DESIGN §5.6): anything under `src/user/`
 * is the user's to keep; everything else (`src/theme/**`, config, the registry)
 * is template-owned and replaced on upgrade. Keeping this rule pure lets the
 * embed generator and the bootstrap decision agree without duplicating it.
 */
export function classifyOwnership(projectRelativePath: string): TemplateFileOwnership {
	const normalized = projectRelativePath.replace(/^\.\//, '').replace(/\\/g, '/');
	return normalized === 'src/user' || normalized.startsWith('src/user/') ? 'user' : 'template';
}
