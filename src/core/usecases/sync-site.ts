import { planSync } from '../domain/routing';
import type { BasesPort, Logger, SnapshotWriterPort, VaultPort } from '../ports';

export interface SyncResult {
	written: number;
	warnings: string[];
}

/**
 * Orchestrates a full site sync: read the config note, plan routes, then
 * harvest + write a snapshot per target. The orchestration logic lives here
 * (locality); all I/O is delegated to ports, so this is unit-testable with
 * in-memory fakes and no Obsidian.
 */
export class SyncSite {
	constructor(
		private readonly vault: VaultPort,
		private readonly bases: BasesPort,
		private readonly writer: SnapshotWriterPort,
		private readonly logger: Logger,
	) {}

	async run(): Promise<SyncResult> {
		const config = await this.vault.readSiteConfig();
		const plan = planSync(config);
		for (const warning of plan.warnings) {
			this.logger.warn(warning);
		}

		await this.writer.clear();
		let written = 0;
		for (const target of plan.targets) {
			const snapshot = await this.bases.harvest(target);
			await this.writer.write(snapshot);
			written += 1;
		}

		this.logger.info(`Synced ${written} view(s).`);
		return { written, warnings: plan.warnings };
	}
}
