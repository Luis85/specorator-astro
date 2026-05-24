import type { ResolvedTarget, ViewSnapshot } from '../core/domain/types';
import type { BasesPort } from '../core/ports';

/**
 * Harvests evaluated Bases data via a mounted custom view (phase 1). Mirrors the
 * user's chosen view config and reads `entry.getValue(...)` from `onDataUpdated`.
 */
export class BasesHarvesterAdapter implements BasesPort {
	async harvest(target: ResolvedTarget): Promise<ViewSnapshot> {
		throw new Error(
			`Bases harvesting is not implemented yet (target: ${target.basePath} / ${target.viewName}).`,
		);
	}
}
