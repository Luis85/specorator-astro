import { checkCorePlugins } from '../domain/core-plugins';
import { UserFacingError } from '../domain/errors';
import { planSync } from '../domain/routing';
import { resolveSnapshotAssets } from './resolve-assets';
import { resolveSnapshotBodies } from './resolve-bodies';
import type {
	AssetSourcePort,
	BasesPort,
	CorePluginsPort,
	SettingsPort,
	SnapshotWriterPort,
} from '../ports';
import type { ViewSnapshot } from '../domain/types';

export interface SyncResult {
	written: number;
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
 * asset step is skipped and the harvested snapshots are committed as-is.
 */
export class SyncSite {
	constructor(
		private readonly settings: SettingsPort,
		private readonly bases: BasesPort,
		private readonly writer: SnapshotWriterPort,
		private readonly corePlugins: CorePluginsPort,
		private readonly assets?: AssetSourcePort,
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

		// Body link resolution (FR-15, FR-21, D8): build the global route table
		// from every snapshot and rewrite each entry body's `[[wikilinks]]` to
		// routes before write (DESIGN §5.7). Cross-base links resolve here, and
		// route collisions surface as warnings — both pure (`resolveSnapshotBodies`).
		const bodies = resolveSnapshotBodies(snapshots);
		snapshots = bodies.snapshots;
		warnings.push(...bodies.warnings);

		await this.writer.commit(snapshots);

		return { written: snapshots.length, warnings };
	}
}
