import {
	BasesView,
	normalizePath,
	parseYaml,
	type App,
	type Plugin,
	type QueryController,
} from 'obsidian';
import type { ResolvedTarget, ViewSnapshot } from '../core/domain/types';
import {
	buildViewSnapshot,
	selectViewConfig,
	type HarvestedConfig,
	type HarvestedGroup,
	type ParsedBaseFile,
} from '../core/domain/harvest-mapping';
import type { BasesPort } from '../core/ports';

/**
 * Namespaced id for our harvesting Bases view (NFR-12 — must not collide with
 * other plugins' registered view ids or Bases' built-in ones).
 */
const HARVEST_VIEW_ID = 'specorator-astro-viewer:harvest';

/** Friendly name shown in the Bases view selector for our harvesting view. */
const HARVEST_VIEW_NAME = 'Specorator (harvest)';

/** How long to wait for `onDataUpdated` before giving up on a target. */
const HARVEST_TIMEOUT_MS = 15_000;

/**
 * Harvests evaluated Bases data through a transiently-mounted custom view
 * (FR-1, FR-2, FR-10; DESIGN §3, §5.1).
 *
 * There is **no headless Bases evaluation API**: `onDataUpdated` fires only for
 * a view Obsidian instantiated in a leaf (DESIGN §3). So per target this adapter
 * opens a transient harvest leaf for the `.base` with our view type selected,
 * awaits the first `onDataUpdated` (Bases has by then applied the view's
 * filters/sort/limit and evaluated its formulas — we never reimplement that),
 * reads the evaluated `groupedData` + the view config (`getOrder()` /
 * `getDisplayName()`), and **always tears the leaf down** in a `finally`
 * (OBS-5: we never keep a reference to the view and detach our own transient
 * leaf, which is created outside `onunload`).
 *
 * To mirror the *chosen* native view (Bases only exposes our own view's config
 * to the mounted view), it reads the target view's `type`/`groupBy` from the
 * `.base` YAML and passes them to the pure mapper. All normalization lives in
 * the pure `harvest-mapping` core; this adapter is the thin I/O shell.
 */
export class BasesHarvesterAdapter implements BasesPort {
	private readonly app: App;
	private readonly plugin: Plugin;
	/** Latched once `registerBasesView` succeeds, so we register exactly once. */
	private viewRegistered = false;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}

	async harvest(target: ResolvedTarget): Promise<ViewSnapshot> {
		this.ensureViewRegistered();

		const file = this.app.vault.getFileByPath(normalizePath(target.basePath));
		if (file === null) {
			throw new Error(`Base file not found in vault: ${target.basePath}`);
		}

		// Mirror the chosen view's type/groupBy from the `.base` YAML; Bases still
		// evaluates filters/formulas for us via the mounted view.
		const raw = await this.app.vault.cachedRead(file);
		const parsed = (parseYaml(raw) ?? {}) as ParsedBaseFile;
		const selected = selectViewConfig(parsed, target.viewName);

		// Open a transient leaf, mount our harvesting view, await the first data
		// update, then ALWAYS detach — even if the wait rejects/times out.
		const leaf = this.app.workspace.getLeaf('tab');
		try {
			const ready = HarvestView.awaitFirstUpdate(HARVEST_TIMEOUT_MS);
			await leaf.setViewState({
				type: 'bases',
				state: { file: target.basePath, viewType: HARVEST_VIEW_ID },
				active: false,
			});
			const { config, groupedData } = await ready;

			return buildViewSnapshot({
				target,
				config,
				groupedData,
				viewType: selected.type,
				...(selected.groupBy ? { groupBy: selected.groupBy } : {}),
				generatedAt: new Date().toISOString(),
			});
		} finally {
			leaf.detach();
		}
	}

	/**
	 * Register the harvesting Bases view once. `registerBasesView` returns
	 * `false` when the Bases core plugin is disabled/unavailable — surface that
	 * clearly rather than failing later with an opaque error (FR-10).
	 */
	private ensureViewRegistered(): void {
		if (this.viewRegistered) {
			return;
		}
		const ok = this.plugin.registerBasesView(HARVEST_VIEW_ID, {
			name: HARVEST_VIEW_NAME,
			icon: 'globe',
			factory: (controller, containerEl) => new HarvestView(controller, containerEl),
		});
		if (!ok) {
			throw new Error(
				'The Bases core plugin is disabled or unavailable. Enable it in ' +
					'Settings → Core plugins → Bases to sync your site (FR-10).',
			);
		}
		this.viewRegistered = true;
	}
}

/** What a single `onDataUpdated` exposes to the harvester. */
interface HarvestUpdate {
	config: HarvestedConfig;
	groupedData: HarvestedGroup[];
}

/**
 * The custom Bases view we mount transiently. It does not render anything; it
 * exists solely so Obsidian evaluates the base and calls `onDataUpdated`, at
 * which point it resolves the pending harvest promise with the evaluated data
 * and the view config.
 *
 * Concurrency note: harvest runs one target at a time (the `SyncSite` use-case
 * awaits each `harvest` sequentially), so a single static "pending update"
 * slot is sufficient and avoids the view keeping back-references.
 */
class HarvestView extends BasesView {
	type = HARVEST_VIEW_ID;

	private static pending: {
		resolve: (update: HarvestUpdate) => void;
		reject: (error: Error) => void;
		/** `window.setTimeout` handle (a `number` in the browser runtime). */
		timer: number;
	} | null = null;

	constructor(controller: QueryController, _containerEl: HTMLElement) {
		super(controller);
	}

	/**
	 * Arm a one-shot promise for the next `onDataUpdated`. Rejects after
	 * `timeoutMs` so a base that never evaluates (e.g. a malformed query) cannot
	 * wedge the sync — the adapter's `finally` still detaches the leaf.
	 */
	static awaitFirstUpdate(timeoutMs: number): Promise<HarvestUpdate> {
		// Replace any stale pending slot (defensive; harvests are sequential).
		if (HarvestView.pending) {
			window.clearTimeout(HarvestView.pending.timer);
			HarvestView.pending.reject(new Error('Superseded by a newer harvest.'));
			HarvestView.pending = null;
		}
		return new Promise<HarvestUpdate>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				HarvestView.pending = null;
				reject(new Error(`Bases did not return data within ${String(timeoutMs)}ms.`));
			}, timeoutMs);
			HarvestView.pending = { resolve, reject, timer };
		});
	}

	onDataUpdated(): void {
		const pending = HarvestView.pending;
		if (pending === null) {
			return;
		}
		HarvestView.pending = null;
		window.clearTimeout(pending.timer);
		pending.resolve({
			config: this.config,
			// The real `BasesEntryGroup[]` (key?: Value, entries: BasesEntry[])
			// satisfies the structural `HarvestedGroup[]` the pure mapper consumes.
			groupedData: this.data.groupedData as unknown as HarvestedGroup[],
		});
	}
}
