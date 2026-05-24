import type { ViewSnapshot } from '../core/domain/types';
import type { SnapshotWriterPort } from '../core/ports';

/** Writes snapshots into the Astro project's data directory (phase 1). */
export class FsSnapshotWriter implements SnapshotWriterPort {
	constructor(private readonly dataDir: string) {}

	async write(snapshot: ViewSnapshot): Promise<void> {
		throw new Error(
			`Snapshot writing is not implemented yet (${snapshot.baseId} -> ${this.dataDir}).`,
		);
	}

	async clear(): Promise<void> {
		// No-op until the writer is implemented (phase 1).
		return;
	}
}
