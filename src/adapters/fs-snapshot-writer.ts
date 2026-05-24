import type { ViewSnapshot } from '../core/domain/types';
import type { SnapshotWriterPort } from '../core/ports';

/** Writes snapshots into the Astro project's data directory (phase 1). */
export class FsSnapshotWriter implements SnapshotWriterPort {
	constructor(private readonly dataDir: string) {}

	async commit(snapshots: ViewSnapshot[]): Promise<void> {
		// Phase 1 will stage to a temp dir and swap atomically so a failed sync
		// never leaves the data directory half-written.
		throw new Error(
			`Snapshot writing is not implemented yet (${String(snapshots.length)} snapshot(s) -> ${this.dataDir}).`,
		);
	}
}
