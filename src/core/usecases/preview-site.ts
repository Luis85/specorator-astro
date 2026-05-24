import { checkCorePlugins } from '../domain/core-plugins';
import { UserFacingError } from '../domain/errors';
import type {
	AstroProcessPort,
	CorePluginsPort,
	ProjectBootstrapPort,
	WebViewerPort,
} from '../ports';
import type { SyncSite } from './sync-site';

/**
 * Composes the full **preview flow** in the core (DESIGN §5.1 trigger D2, §5.4):
 *
 *   ensure project → guard core plugins → auto-sync (first preview only)
 *   → start dev → open Web Viewer.
 *
 * Keeping the orchestration here (behind the bootstrap / sync / process /
 * web-viewer ports) keeps the composition root free of domain logic and makes
 * the whole flow testable with in-memory fakes. The **auto-sync on first
 * preview** (FR-20 / D2) is modeled by a per-instance "synced this session"
 * latch: the first `run()` harvests before starting the server so the preview
 * reflects current data; subsequent previews skip the re-sync (the live-resync
 * trigger, modeled separately, drives re-syncs after that).
 *
 * Both Bases (needed by the auto-sync harvest) and Web Viewer (needed to open
 * the URL in-app) are guarded *before* any work, so a disabled core plugin
 * yields a clear `UserFacingError` the composition root shows as a Notice
 * (FR-10) rather than an opaque downstream failure.
 */
export class PreviewSite {
	/** Latches once the first preview has auto-synced this session (FR-20/D2). */
	private syncedThisSession = false;

	constructor(
		private readonly bootstrap: ProjectBootstrapPort,
		private readonly corePlugins: CorePluginsPort,
		private readonly sync: SyncSite,
		private readonly astro: AstroProcessPort,
		private readonly webViewer: WebViewerPort,
	) {}

	async run(): Promise<{ url: string }> {
		const check = checkCorePlugins(
			{
				basesEnabled: this.corePlugins.isBasesEnabled(),
				webViewerEnabled: this.corePlugins.isWebViewerEnabled(),
			},
			['bases', 'webviewer'],
		);
		if (!check.ok) {
			throw new UserFacingError(check.message);
		}

		await this.bootstrap.ensureProject();

		if (!this.syncedThisSession) {
			await this.sync.run();
			this.syncedThisSession = true;
		}

		const { url } = await this.astro.startDev();
		await this.webViewer.open(url);
		return { url };
	}
}
