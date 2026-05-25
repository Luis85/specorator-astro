import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryPort } from '../core/ports';
import type { DiscoveredRegistry, RegistryTier } from '../core/domain/registry';

/**
 * Discovers component/layout NAMES in the scaffolded Astro project by scanning
 * each tier's `views/` + `layouts/` directories for `.astro` files (FR-11b;
 * DESIGN §5.6). Thin by design: this only reads directory entries and strips the
 * extension; the **precedence merge** of the per-tier names (vault `generated` →
 * `user` → `theme`, FR-11j) is the pure `resolveRegistry` the caller applies.
 *
 * Tiers (relative to `<projectDir>/src`):
 * - `theme/{views,layouts}` — bundled defaults (always present after bootstrap).
 * - `user/{views,layouts}` — hand-written `.astro` (may be absent until scaffolded).
 * - `generated/{views,layouts}` — transpiled vault notes (the C12 seam; absent now).
 *
 * A missing directory is treated as "no names" (ENOENT is swallowed), so the
 * scan is safe before any user/generated files exist. Only `node:fs` reads —
 * never a `child_process`.
 */
export class RegistryAdapter implements RegistryPort {
	constructor(private readonly projectDir: string) {}

	async discover(): Promise<DiscoveredRegistry> {
		const tiers: readonly RegistryTier[] = ['generated', 'user', 'theme'];
		const components: DiscoveredRegistry['components'] = {};
		const layouts: DiscoveredRegistry['layouts'] = {};
		for (const tier of tiers) {
			components[tier] = await this.astroNames(tier, 'views');
			layouts[tier] = await this.astroNames(tier, 'layouts');
		}
		return { components, layouts };
	}

	/** List the `.astro` basenames under `src/<tier>/<kind>` (empty if absent). */
	private async astroNames(tier: RegistryTier, kind: 'views' | 'layouts'): Promise<string[]> {
		const dir = path.join(this.projectDir, 'src', tier, kind);
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			// Missing tier/dir → no names (safe before user/generated exist).
			return [];
		}
		return entries
			.filter((name) => name.endsWith('.astro'))
			.map((name) => name.slice(0, -'.astro'.length));
	}
}
