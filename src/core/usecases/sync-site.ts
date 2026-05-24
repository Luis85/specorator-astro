import { checkCorePlugins } from '../domain/core-plugins';
import { UserFacingError } from '../domain/errors';
import { planSync } from '../domain/routing';
import type { BasesPort, CorePluginsPort, SettingsPort, SnapshotWriterPort } from '../ports';
import type { ViewSnapshot } from '../domain/types';

export interface SyncResult {
	written: number;
	warnings: string[];
}

/**
 * Orchestrates a full site sync: guard the Bases core plugin (FR-10), read the
 * site config, plan routes, harvest a snapshot per target, then commit them
 * atomically. The orchestration logic lives here (locality); all I/O is
 * delegated to ports, so this is unit-testable with in-memory fakes and no
 * Obsidian. Diagnostics are returned, not logged — the composition root decides
 * how to surface them — while an unmet precondition (disabled Bases) throws a
 * `UserFacingError` the root shows as a Notice.
 */
export class SyncSite {
	constructor(
		private readonly settings: SettingsPort,
		private readonly bases: BasesPort,
		private readonly writer: SnapshotWriterPort,
		private readonly corePlugins: CorePluginsPort,
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

		const snapshots: ViewSnapshot[] = [];
		for (const target of plan.targets) {
			snapshots.push(await this.bases.harvest(target));
		}
		await this.writer.commit(snapshots);

		return { written: snapshots.length, warnings: plan.warnings };
	}
}
