import { planSync } from '../domain/routing';
import type { BasesPort, SettingsPort, SnapshotWriterPort } from '../ports';
import type { ViewSnapshot } from '../domain/types';

export interface SyncResult {
	written: number;
	warnings: string[];
}

/**
 * Orchestrates a full site sync: read the site config, plan routes, harvest a
 * snapshot per target, then commit them atomically. The orchestration logic
 * lives here (locality); all I/O is delegated to ports, so this is
 * unit-testable with in-memory fakes and no Obsidian. Diagnostics are returned,
 * not logged — the composition root decides how to surface them.
 */
export class SyncSite {
	constructor(
		private readonly settings: SettingsPort,
		private readonly bases: BasesPort,
		private readonly writer: SnapshotWriterPort,
	) {}

	async run(): Promise<SyncResult> {
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
