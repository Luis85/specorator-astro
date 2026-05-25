/*
 * specorator-template-version: 1
 *
 * Component & layout registry — the stable barrel that maps a registry *name*
 * to an Astro component (docs/DESIGN.md §5.6). Keeping all components behind one
 * barrel dodges Astro's new-file HMR gap (D9): the barrel file never changes,
 * only the glob's contents do, so a freshly-added user/generated component is
 * picked up without editing this file.
 *
 * Precedence on a name collision (FR-11j): vault component note (`generated/`)
 * → hand-written `user/` → bundled `theme/` default. The theme defaults are
 * imported explicitly (typed, always present); `user/` then `generated/` are
 * discovered with `import.meta.glob` (eager) and overlaid in increasing
 * precedence, so a same-named user or vault component shadows the theme default
 * (and a vault component shadows a user one). C12 fills `generated/` from the
 * vault code-fence library; until then that glob is simply empty.
 */
import Placeholder from './theme/views/Placeholder.astro';
import Table from './theme/views/Table.astro';
import Cards from './theme/views/Cards.astro';
import List from './theme/views/List.astro';
import Detail from './theme/views/Detail.astro';
import Page from './theme/views/Page.astro';
import BaseLayout from './theme/layouts/BaseLayout.astro';

type AstroComponent = (props: Record<string, unknown>) => unknown;
type ComponentModule = { default: AstroComponent };

/** Theme defaults — the lowest-precedence, always-present base of the registry. */
const views: Record<string, AstroComponent> = {
	// Native Bases view types map to same-named registry entries; `render.component`
	// (resolved per base/view) selects one, defaulting to the view `type` (§5.6).
	table: Table as unknown as AstroComponent,
	cards: Cards as unknown as AstroComponent,
	list: List as unknown as AstroComponent,
	// Per-entry detail page (FR-21); `[...slug].astro` selects it for detail routes.
	detail: Detail as unknown as AstroComponent,
	// Standalone page (FR-12); `[...slug].astro` selects it for page routes (incl. `/`).
	page: Page as unknown as AstroComponent,
	placeholder: Placeholder as unknown as AstroComponent,
};

const layouts: Record<string, AstroComponent> = {
	BaseLayout: BaseLayout as unknown as AstroComponent,
};

/**
 * Overlay every `.astro` module a glob found onto a target map, keyed by its
 * basename (no extension). Later calls win, so callers overlay in increasing
 * precedence (theme already seeded, then user, then generated — FR-11j).
 */
function overlay(target: Record<string, AstroComponent>, modules: Record<string, unknown>): void {
	for (const [filePath, mod] of Object.entries(modules)) {
		const name = filePath.replace(/^.*\/([^/]+)\.astro$/, '$1');
		const component = (mod as ComponentModule).default;
		if (component !== undefined) {
			target[name] = component;
		}
	}
}

// User (`src/user/**`) shadows theme; vault-generated (`src/generated/**`)
// shadows both. `import.meta.glob` is resolved at build time by Vite; an empty
// or absent directory yields `{}`, so this is safe before any such files exist.
overlay(views, import.meta.glob('./user/views/*.astro', { eager: true }));
overlay(views, import.meta.glob('./generated/views/*.astro', { eager: true }));
overlay(layouts, import.meta.glob('./user/layouts/*.astro', { eager: true }));
overlay(layouts, import.meta.glob('./generated/layouts/*.astro', { eager: true }));

/** Resolve a view-component name to a component, falling back to the placeholder. */
export function resolveView(name: string): AstroComponent {
	return views[name] ?? views.placeholder;
}

/** Resolve a layout name to a layout component, falling back to BaseLayout. */
export function resolveLayout(name: string): AstroComponent {
	return layouts[name] ?? layouts.BaseLayout;
}
