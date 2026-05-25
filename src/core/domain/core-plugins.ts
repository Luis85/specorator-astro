/**
 * Pure decision logic for the disabled-core-plugin guard (FR-10; DESIGN §5.4).
 *
 * The plugin depends solely on two native core plugins — **Bases** (to harvest
 * data) and **Web Viewer** (to show the preview in-app). When either is
 * disabled, sync/preview cannot work, and the user must be told *clearly* rather
 * than left with an opaque downstream failure.
 *
 * This module decides — given only two booleans — **what is missing** and **what
 * to say**. The raw plugin-state read (Obsidian's `internalPlugins` surface) is
 * the adapter's job (`CorePluginsPort`); keeping the requirement set and the
 * exact messages here makes them unit-testable without `obsidian`.
 *
 * Pure: booleans in → a diagnostic out. No I/O, no `obsidian`, no Node.
 */

/** Which core plugins a given operation requires. */
export type RequiredCorePlugins = 'bases' | 'webviewer';

/** The enabled state of the core plugins, as read by the adapter. */
export interface CorePluginsState {
	basesEnabled: boolean;
	webViewerEnabled: boolean;
}

/**
 * The outcome of checking the required core plugins for an operation. A
 * discriminated union so callers get a *guaranteed* message when not ok (no
 * defensive `?? fallback` needed at the throw site).
 */
export type CorePluginsCheck = { ok: true; message: null } | { ok: false; message: string };

/** Notice copy for a single disabled core plugin (FR-10). */
const MESSAGES: Record<RequiredCorePlugins, string> = {
	bases:
		'Specorator: the Bases core plugin is disabled — enable it in ' +
		'Settings → Core plugins → Bases.',
	webviewer:
		'Specorator: the Web Viewer core plugin is disabled — enable it in ' +
		'Settings → Core plugins → Web Viewer.',
};

/**
 * Decide whether the given operation can proceed and, if not, the exact Notice
 * to show. `required` lists the plugins that operation depends on:
 *
 * - **Sync** needs only `bases` (it harvests, it never previews).
 * - **Preview** needs both `bases` (auto-sync) and `webviewer` (to open the URL).
 *
 * When several required plugins are disabled, their messages are joined so a
 * single Notice tells the user everything to enable.
 */
export function checkCorePlugins(
	state: CorePluginsState,
	required: readonly RequiredCorePlugins[],
): CorePluginsCheck {
	const enabled: Record<RequiredCorePlugins, boolean> = {
		bases: state.basesEnabled,
		webviewer: state.webViewerEnabled,
	};

	const missing = required.filter((plugin) => !enabled[plugin]);
	if (missing.length === 0) {
		return { ok: true, message: null };
	}

	return {
		ok: false,
		message: missing.map((plugin) => MESSAGES[plugin]).join('\n'),
	};
}
