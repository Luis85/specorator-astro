import type { App } from 'obsidian';
import type { CorePluginsPort } from '../core/ports';

/**
 * Reads whether the **Bases** and **Web Viewer** core plugins are enabled (FR-10;
 * DESIGN §5.4). Core (a.k.a. "internal") plugins live on `app.internalPlugins`,
 * which Obsidian does **not** expose in its public `obsidian` types, so we reach
 * it through a narrow, optional-chained shim and treat any gap as "disabled."
 * The *decision* of what to require and which Notice to show is pure core logic
 * (`checkCorePlugins`); this adapter is the thin two-flag state read.
 */

/** Core-plugin ids in Obsidian's internal-plugin registry. */
const BASES_ID = 'bases';
const WEB_VIEWER_ID = 'webviewer';

/** The slice of `app.internalPlugins` we use — kept minimal and defensive. */
interface InternalPluginsShim {
	getEnabledPluginById?(id: string): unknown;
	plugins?: Record<string, { enabled?: boolean } | undefined>;
}

export class CorePluginsAdapter implements CorePluginsPort {
	constructor(private readonly app: App) {}

	isBasesEnabled(): boolean {
		return this.isEnabled(BASES_ID);
	}

	isWebViewerEnabled(): boolean {
		return this.isEnabled(WEB_VIEWER_ID);
	}

	/**
	 * Resolve a core plugin's enabled state defensively. Prefer the public-ish
	 * `getEnabledPluginById` (returns the instance only when enabled); fall back
	 * to the `plugins[id].enabled` flag. Any missing surface ⇒ `false`, so a
	 * future Obsidian rename degrades to a clear "enable it" Notice rather than a
	 * crash.
	 */
	private isEnabled(id: string): boolean {
		const internal = (this.app as unknown as { internalPlugins?: InternalPluginsShim })
			.internalPlugins;
		if (!internal) {
			return false;
		}
		if (typeof internal.getEnabledPluginById === 'function') {
			return internal.getEnabledPluginById(id) != null;
		}
		return internal.plugins?.[id]?.enabled === true;
	}
}
