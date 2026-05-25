/**
 * Pure stub-content generation for the "Scaffold component/layout" affordance
 * (FR-11d; DESIGN §5.6). Given a kind ('view' | 'layout') and a registry name,
 * produce the `.astro` source for a **user-owned** stub plus its project-
 * relative path under `src/user/`. No I/O — the write (and the NFR-9
 * never-overwrite guard) live in the `ScaffoldPort` adapter.
 *
 * The stubs are intentionally minimal but runnable: a view stub receives the
 * same `snapshot`/`entry` props the bundled views get and renders the entries,
 * so a freshly-scaffolded-then-assigned component renders something immediately;
 * a layout stub wraps a `<slot/>` in the token-driven shell. Both carry a
 * comment pointing at the theme defaults to copy from.
 */

/** The kind of stub to scaffold. */
export type StubKind = 'view' | 'layout';

/** A generated stub: where it goes (project-relative) and its `.astro` source. */
export interface StubFile {
	/** Project-relative path under `src/user/`, e.g. `src/user/views/BookCard.astro`. */
	path: string;
	contents: string;
}

/**
 * Sanitize a requested registry name into a safe `.astro` basename: keep
 * alphanumerics, dash, and underscore; collapse anything else to a dash; trim
 * dashes. An empty result falls back to a kind-specific default so a path is
 * always produced.
 */
export function stubBasename(kind: StubKind, name: string): string {
	const cleaned = name
		.trim()
		.replace(/\.astro$/i, '')
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (cleaned !== '') {
		return cleaned;
	}
	return kind === 'layout' ? 'CustomLayout' : 'CustomView';
}

/** The `src/user/` subdirectory a kind scaffolds into. */
function dirFor(kind: StubKind): string {
	return kind === 'layout' ? 'src/user/layouts' : 'src/user/views';
}

function viewStub(basename: string): string {
	return `---
/*
 * User-owned view component "${basename}" (src/user/views).
 * NEVER overwritten on plugin upgrade (FR-11a/NFR-9). It shadows a same-named
 * theme default via the registry (FR-11j). Assign it to a base/view in the
 * plugin settings, then run Sync site. Copy from src/theme/views/*.astro for a
 * fuller starting point; style with the --sp-* tokens (src/theme/styles).
 */
import type { EntrySnapshot, ViewSnapshot } from '../../content/schema';

interface Props {
	snapshot: ViewSnapshot;
	/** Present only when this component renders a per-entry detail route. */
	entry?: EntrySnapshot;
}

const { snapshot } = Astro.props;
const entries = snapshot.groups.flatMap((group) => group.entries);
---

<section class="sp-${basename.toLowerCase()}">
	<ul>
		{
			entries.map((entry) => (
				<li>
					<a href={entry.route}>{entry.basename}</a>
				</li>
			))
		}
	</ul>
</section>

<style>
	.sp-${basename.toLowerCase()} {
		color: var(--sp-color-fg);
	}
</style>
`;
}

function layoutStub(basename: string): string {
	return `---
/*
 * User-owned layout "${basename}" (src/user/layouts).
 * NEVER overwritten on plugin upgrade (FR-11a/NFR-9). It shadows a same-named
 * theme default via the registry (FR-11j). Assign it to a base/view in the
 * plugin settings, then run Sync site. Copy from src/theme/layouts/BaseLayout.astro
 * for the full token-driven shell; redefine --sp-* tokens in src/user/theme.css.
 */
import '../../theme/styles/tokens.css';
import '../theme.css';

interface Props {
	title?: string;
	description?: string;
}

const { title = 'Specorator site' } = Astro.props;
---

<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>{title}</title>
	</head>
	<body>
		<main class="sp-main">
			<slot />
		</main>
	</body>
</html>

<style>
	:global(body) {
		margin: 0;
		background: var(--sp-color-bg);
		color: var(--sp-color-fg);
		font-family: var(--sp-font-body);
	}
	.sp-main {
		max-width: var(--sp-maxwidth);
		margin: 0 auto;
		padding: var(--sp-space-lg) var(--sp-space-md);
	}
</style>
`;
}

/**
 * Build the user-owned stub for `name` of `kind`: its project-relative path and
 * its `.astro` source. Pure; the adapter writes it (and refuses to overwrite an
 * existing file — NFR-9).
 */
export function buildStub(kind: StubKind, name: string): StubFile {
	const basename = stubBasename(kind, name);
	const contents = kind === 'layout' ? layoutStub(basename) : viewStub(basename);
	return { path: `${dirFor(kind)}/${basename}.astro`, contents };
}
