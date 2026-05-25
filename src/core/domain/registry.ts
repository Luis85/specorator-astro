/**
 * Pure component/layout **registry resolution** and per-`(base, view)`
 * **assignment resolution** (FR-11b/c/j; DESIGN §5.6). No I/O, no `obsidian`,
 * no Node — the fs scan that discovers names lives in the adapter
 * (`RegistryPort`); the merge/precedence and the assignment fallbacks are here.
 *
 * Two concerns:
 *
 * 1. **Registry resolution.** A component/layout NAME may be defined in more
 *    than one tier (the bundled `theme/` default, a hand-written `user/`
 *    `.astro`, or a transpiled vault note under `generated/`). On a name
 *    collision the precedence is **vault component note (`generated`) → user →
 *    theme** (FR-11j). {@link resolveRegistry} folds the per-tier name sets into
 *    a deduped, sorted available-name list, recording which tier wins per name.
 *    `generated` is a forward seam for C12 (the vault code-fence library); C11
 *    only populates `theme` + `user`, but the precedence already accounts for it.
 *
 * 2. **Assignment resolution.** Which component/layout renders a given
 *    `(basePath, viewName)` is stored in the plugin settings as the optional
 *    `PublishTarget.component` / `PublishTarget.layout` (the sidecar config, D4 —
 *    not the `.base` file). {@link resolveAssignment} turns an explicit binding
 *    or the `'auto'` sentinel into the concrete name the snapshot's `render`
 *    carries: a component `'auto'` falls back to the view **type**
 *    (`table`/`cards`/`list`), a layout `'auto'` falls back to the default
 *    layout. An assignment that names something the registry doesn't know is
 *    kept verbatim (the template barrel degrades to a placeholder/BaseLayout at
 *    render time, §5.6) — resolution never silently drops a user's choice.
 */

import type { PublishTarget, ResolvedTarget, ViewType } from './types';

/** The three discovery tiers, highest precedence first (FR-11j). */
export type RegistryTier = 'generated' | 'user' | 'theme';

/** Precedence order applied on a name collision (highest wins, FR-11j). */
export const TIER_PRECEDENCE: readonly RegistryTier[] = ['generated', 'user', 'theme'];

/** The sentinel binding meaning "resolve from the view type / use the default". */
export const AUTO = 'auto';

/** The default layout name when an assignment is `'auto'` or unset (§5.6). */
export const DEFAULT_LAYOUT = 'BaseLayout';

/**
 * Discovered registry names per tier. Each is the set of `.astro` basenames a
 * tier defines (the fs scan in the adapter produces these; the merge is pure).
 * All optional so a caller can supply only the tiers it has (C11: theme+user).
 */
export interface RegistryTierNames {
	generated?: readonly string[];
	user?: readonly string[];
	theme?: readonly string[];
}

/** The discovered component + layout names, before precedence resolution. */
export interface DiscoveredRegistry {
	components: RegistryTierNames;
	layouts: RegistryTierNames;
}

/** One resolved registry entry: a name and the tier that owns it after precedence. */
export interface ResolvedRegistryEntry {
	name: string;
	/** The winning tier for this name (FR-11j precedence applied). */
	tier: RegistryTier;
}

/** The resolved, deduped name lists for components and layouts. */
export interface ResolvedRegistry {
	components: ResolvedRegistryEntry[];
	layouts: ResolvedRegistryEntry[];
}

/**
 * Fold one set of per-tier names into deduped entries, resolving collisions by
 * {@link TIER_PRECEDENCE}. Names are returned sorted for a stable UI order.
 */
function resolveTierNames(tiers: RegistryTierNames): ResolvedRegistryEntry[] {
	// Walk tiers from highest precedence to lowest; the first tier to claim a
	// name owns it (later, lower-precedence tiers can't override — FR-11j).
	const winner = new Map<string, RegistryTier>();
	for (const tier of TIER_PRECEDENCE) {
		for (const name of tiers[tier] ?? []) {
			if (!winner.has(name)) {
				winner.set(name, tier);
			}
		}
	}
	return [...winner.entries()]
		.map(([name, tier]) => ({ name, tier }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve discovered per-tier component/layout names into deduped, precedence-
 * ordered lists (FR-11j: vault `generated` → `user` → `theme`). The result is
 * the source of truth for the settings dropdowns and for knowing which tier a
 * name resolves from.
 */
export function resolveRegistry(discovered: DiscoveredRegistry): ResolvedRegistry {
	return {
		components: resolveTierNames(discovered.components),
		layouts: resolveTierNames(discovered.layouts),
	};
}

/** Just the available names (sorted), convenient for populating a dropdown. */
export function availableNames(entries: readonly ResolvedRegistryEntry[]): string[] {
	return entries.map((entry) => entry.name);
}

/** Whether the resolved registry knows a component name. */
export function hasComponent(registry: ResolvedRegistry, name: string): boolean {
	return registry.components.some((entry) => entry.name === name);
}

/** Whether the resolved registry knows a layout name. */
export function hasLayout(registry: ResolvedRegistry, name: string): boolean {
	return registry.layouts.some((entry) => entry.name === name);
}

/** A `(component, layout)` binding resolved to concrete registry names. */
export interface ResolvedBinding {
	component: string;
	layout: string;
}

/**
 * Resolve a target's stored component/layout assignment into the concrete names
 * the snapshot's `render` should carry, applying the `'auto'` fallbacks (§5.6):
 *
 * - **component** — an explicit, non-`'auto'` binding wins; otherwise it falls
 *   back to the view **type** (`table`/`cards`/`list`).
 * - **layout** — an explicit, non-`'auto'` binding wins; otherwise it falls back
 *   to {@link DEFAULT_LAYOUT}.
 *
 * An unset binding is treated as `'auto'`. A binding that names something the
 * registry doesn't know is kept verbatim: resolution never drops a user's
 * explicit choice; the template barrel degrades it (placeholder/BaseLayout) at
 * render time (§5.6). This mirrors the `[...slug].astro` dispatch so the
 * snapshot and the template agree on the resolved name.
 */
export function resolveBinding(
	binding: { component?: string; layout?: string },
	viewType: ViewType,
): ResolvedBinding {
	const component =
		binding.component && binding.component !== AUTO ? binding.component : viewType;
	const layout = binding.layout && binding.layout !== AUTO ? binding.layout : DEFAULT_LAYOUT;
	return { component, layout };
}

/**
 * Resolve the effective `(component, layout)` for a `(basePath, viewName)` from
 * the curated publish list (the sidecar assignment, FR-11c) and the view type.
 * Looks the binding up by identity of `(basePath, viewName)`; an unmatched pair
 * resolves as if it had no explicit binding (component → view type, layout →
 * default). Pure lookup + {@link resolveBinding}.
 */
export function resolveAssignment(
	assignments: readonly PublishTarget[],
	key: { basePath: string; viewName: string },
	viewType: ViewType,
): ResolvedBinding {
	const match = assignments.find(
		(target) => target.basePath === key.basePath && target.viewName === key.viewName,
	);
	return resolveBinding(match ?? {}, viewType);
}

/**
 * Apply a resolved binding to a {@link ResolvedTarget}, returning a copy whose
 * `component`/`layout` are the concrete (non-`'auto'`) names. Used by the
 * harvest path so the snapshot's `render` is fully resolved against the view
 * type before write.
 */
export function applyBinding(target: ResolvedTarget, viewType: ViewType): ResolvedTarget {
	const { component, layout } = resolveBinding(target, viewType);
	return { ...target, component, layout };
}
