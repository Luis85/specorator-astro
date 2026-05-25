import { checkCorePlugins } from '../domain/core-plugins';
import { UserFacingError } from '../domain/errors';
import type { AstroProcessPort, CorePluginsPort, ProjectBootstrapPort } from '../ports';
import type { SyncResult, SyncSite } from './sync-site';

/** What a completed build did, for the composition root to surface as a Notice. */
export interface BuildResult {
	/** Number of views synced just before the build (so `dist/` is current). */
	written: number;
	/** Non-fatal diagnostics gathered during the pre-build sync (plan/asset/body). */
	warnings: string[];
}

/**
 * Composes the full **build flow** in the core (FR-6, FR-22; DESIGN §5.3, D6):
 *
 *   guard core plugins → ensure project → auto-sync → `astro build`.
 *
 * It **auto-syncs before building** — mirroring `PreviewSite`'s auto-sync — so
 * the produced `dist/` always reflects the current Bases data rather than a
 * stale prior snapshot set; a build is a one-shot artifact, so (unlike preview)
 * there is no session latch and every build re-harvests first. The sync also
 * guards Bases internally, but we guard `bases` here too so a disabled plugin
 * fails *before* the (slower) project ensure, with the same clear Notice.
 *
 * Build does **not** need the Web Viewer (it never opens a preview), so only
 * `bases` is required — a user can build a deployable site with Web Viewer off.
 *
 * Keeping the orchestration here (behind the bootstrap / sync / process ports)
 * keeps the composition root free of domain logic and makes the flow testable
 * with in-memory fakes. A failed `astro build` rejects from the process port
 * (the adapter already turns a non-zero exit into a thrown error with the piped
 * output visible, FR-6); this use-case lets that propagate so the root shows a
 * failure Notice. Sync diagnostics are returned, not logged — the root decides
 * how to surface them.
 */
export class BuildSite {
	constructor(
		private readonly bootstrap: ProjectBootstrapPort,
		private readonly corePlugins: CorePluginsPort,
		private readonly sync: SyncSite,
		private readonly astro: AstroProcessPort,
	) {}

	async run(): Promise<BuildResult> {
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

		await this.bootstrap.ensureProject();

		const synced: SyncResult = await this.sync.run();

		await this.astro.build();

		return { written: synced.written, warnings: synced.warnings };
	}
}
