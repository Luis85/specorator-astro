/*
 * specorator-template-version: 1
 *
 * Component & layout registry — the stable barrel that maps a registry *name*
 * to an Astro component (docs/DESIGN.md §5.6). Keeping all components behind one
 * barrel dodges Astro's new-file HMR gap (D9): the file set never changes, only
 * its contents do.
 *
 * Precedence on a name collision (FR-11j): vault component note (`generated/`)
 * → hand-written `user/` → bundled `theme/` default. The richer scanning of
 * `generated/` and `user/` arrives with C5/C11/C12; C1 ships the theme defaults
 * and the resolution seam.
 */
import Placeholder from './theme/views/Placeholder.astro';
import Table from './theme/views/Table.astro';
import Cards from './theme/views/Cards.astro';
import List from './theme/views/List.astro';
import BaseLayout from './theme/layouts/BaseLayout.astro';

type AstroComponent = (props: Record<string, unknown>) => unknown;

const views: Record<string, AstroComponent> = {
	// Native Bases view types map to same-named registry entries; `render.component`
	// (resolved per base/view) selects one, defaulting to the view `type` (§5.6).
	table: Table as unknown as AstroComponent,
	cards: Cards as unknown as AstroComponent,
	list: List as unknown as AstroComponent,
	placeholder: Placeholder as unknown as AstroComponent,
};

const layouts: Record<string, AstroComponent> = {
	BaseLayout: BaseLayout as unknown as AstroComponent,
};

/** Resolve a view-component name to a component, falling back to the placeholder. */
export function resolveView(name: string): AstroComponent {
	return views[name] ?? views.placeholder;
}

/** Resolve a layout name to a layout component, falling back to BaseLayout. */
export function resolveLayout(name: string): AstroComponent {
	return layouts[name] ?? layouts.BaseLayout;
}
