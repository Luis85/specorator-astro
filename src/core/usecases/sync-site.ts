import { checkCorePlugins } from '../domain/core-plugins';
import { UserFacingError } from '../domain/errors';
import { resolveNavigation } from '../domain/navigation';
import { buildPageNodes } from '../domain/pages';
import { planSync } from '../domain/routing';
import { resolveSnapshotAssets } from './resolve-assets';
import { resolveSiteBodies } from './resolve-bodies';
import type {
	AssetSourcePort,
	BasesPort,
	CorePluginsPort,
	PageLoaderPort,
	SettingsPort,
	SnapshotWriterPort,
} from '../ports';
import type { PageNode, ViewSnapshot } from '../domain/types';

export interface SyncResult {
	written: number;
	/** How many standalone pages were committed (FR-12). */
	pages: number;
	warnings: string[];
}

/**
 * Orchestrates a full site sync: guard the Bases core plugin (FR-10), read the
 * site config, plan routes, harvest a snapshot per target, run the **asset
 * pipeline** (resolve referenced attachments to public URLs, copy them into the
 * project's `public/`, rewrite the snapshot values — FR-16), then commit the
 * rewritten set atomically. The orchestration logic lives here (locality); all
 * I/O is delegated to ports, so this is unit-testable with in-memory fakes and
 * no Obsidian. Diagnostics (plan + asset warnings) are returned, not logged —
 * the composition root decides how to surface them — while an unmet
 * precondition (disabled Bases) throws a `UserFacingError` shown as a Notice.
 *
 * The asset port is optional: when absent (e.g. in a minimal test wiring) the
 * asset step is skipped and the harvested snapshots are committed as-is. The
 * page-loader port is likewise optional: when absent no standalone pages are
 * loaded and an empty page set is committed (FR-12). The curated navigation is
 * read from the optional `readNavConfig` settings seam, resolved against the
 * global route table, and committed as the `navigation` snapshot (FR-13); when
 * the seam is absent an empty menu is committed.
 */
export class SyncSite {
	constructor(
		private readonly settings: SettingsPort,
		private readonly bases: BasesPort,
		private readonly writer: SnapshotWriterPort,
		private readonly corePlugins: CorePluginsPort,
		private readonly assets?: AssetSourcePort,
		private readonly pageLoader?: PageLoaderPort,
	) {}

	async run(): Promise<SyncResult> {
		const check = checkCorePlugins(
			{
				basesEnabled: this.corePlugins.isBasesEnabled(),
				webViewerEnabled: this.corePlugins.isWebViewerEnabled(),
			},
			['bases'],
		);
		if (!check.ok) {
			throw new UserFacingError(check.message);
		}

		const config = await this.settings.readSiteConfig();
		const plan = planSync(config);

		const harvested: ViewSnapshot[] = [];
		for (const target of plan.targets) {
			harvested.push(await this.bases.harvest(target));
		}

		// Asset pipeline (FR-16): resolve + rewrite snapshot references to public
		// URLs and copy the referenced attachments into the project's `public/`.
		// Pure decision (resolveSnapshotAssets) + I/O (the port) kept separate.
		const warnings = [...plan.warnings];
		let snapshots = harvested;
		if (this.assets !== undefined) {
			const port = this.assets;
			const resolved = resolveSnapshotAssets(harvested, (ref, from) =>
				port.locate(ref, from),
			);
			snapshots = resolved.snapshots;
			warnings.push(...resolved.warnings);
			const copy = await this.assets.copyAll(resolved.copyPlan);
			warnings.push(...copy.warnings);
		}

		// Standalone pages (FR-12; DESIGN §5.7): load candidate page notes and fold
		// them into PageNodes (designation + route + first-wins home, all pure). The
		// page set joins the GLOBAL route table below so page/collection routes
		// collide-check in one place and page-body wikilinks resolve across both.
		let pages: PageNode[] = [];
		if (this.pageLoader !== undefined) {
			const { pagesFolder, libraryFolder } = this.settings.readPageFolders?.() ?? {
				pagesFolder: '',
				libraryFolder: '',
			};
			const rawPages = await this.pageLoader.loadPages();
			const built = buildPageNodes(rawPages, pagesFolder, libraryFolder);
			pages = built.pages;
			warnings.push(...built.warnings);
		}

		// Body link resolution (FR-15, FR-21, FR-12, D8): build ONE global route
		// table from every snapshot AND every page, then rewrite each entry body's
		// and each page body's `[[wikilinks]]` to routes before write (DESIGN §5.7).
		// Cross-base + page↔collection links resolve here; route collisions surface
		// as warnings — all pure (`resolveSiteBodies`).
		const bodies = resolveSiteBodies(snapshots, pages);
		snapshots = bodies.snapshots;
		pages = bodies.pages;
		warnings.push(...bodies.warnings);

		// Navigation (FR-13; D14): resolve the curated settings nav against the
		// global route table's known routes — settings nav is authoritative, an
		// off-site item becomes a label-with-warning. Pure decision; the resolved
		// tree is committed in the same atomic swap as the snapshots + pages.
		const navConfig = this.settings.readNavConfig?.() ?? { items: [] };
		const nav = resolveNavigation(navConfig, bodies.knownRoutes);
		warnings.push(...nav.warnings);

		// Commit snapshots, pages, AND the navigation tree in one atomic swap
		// (FR-3, FR-12, FR-13).
		await this.writer.commit(snapshots, pages, nav.tree);

		return { written: snapshots.length, pages: pages.length, warnings };
	}
}
