import { FileSystemAdapter, Notice, Plugin, TFile } from 'obsidian';
import type { AstroProcessPort } from './core/ports';
import { LiveResyncTrigger } from './core/domain/live-resync';
import { UserFacingError } from './core/domain/errors';
import { EnsureProject } from './core/usecases/ensure-project';
import { PreviewSite } from './core/usecases/preview-site';
import { SyncSite } from './core/usecases/sync-site';
import { AssetSourceAdapter } from './adapters/asset-source-adapter';
import { AstroProcessAdapter } from './adapters/astro-process-adapter';
import { BasesHarvesterAdapter } from './adapters/bases-harvester-adapter';
import { CorePluginsAdapter } from './adapters/core-plugins-adapter';
import { FsSnapshotWriter } from './adapters/fs-snapshot-writer';
import { ProjectBootstrapAdapter } from './adapters/project-bootstrap-adapter';
import { SettingsStore } from './adapters/settings-store';
import { SiteSettingTab } from './adapters/settings-tab';
import { WebViewerAdapter } from './adapters/web-viewer-adapter';

/** How often the live-resync timer wakes to check the debounce window (ms). */
const RESYNC_TICK_MS = 500;

/**
 * Composition root. Wires adapters (Obsidian/Node) into the pure core use-cases,
 * registers commands, and surfaces use-case results to the user. No domain
 * logic lives here — orchestration (auto-sync on first preview), the
 * trigger/debounce decision (`LiveResyncTrigger`), and the disabled-plugin
 * decision (`checkCorePlugins`) all live in core; this file only feeds them
 * Obsidian events and shows their results as `Notice`s.
 */
export default class SpecoratorAstroViewerPlugin extends Plugin {
	private astro: AstroProcessPort | null = null;

	override async onload(): Promise<void> {
		const projectDir = `${this.manifest.dir ?? ''}/astro`;
		const settings = new SettingsStore(this);
		await settings.load();
		this.addSettingTab(new SiteSettingTab(this.app, this, settings));

		const bases = new BasesHarvesterAdapter(this.app, this);
		const writer = new FsSnapshotWriter(projectDir);
		const webViewer = new WebViewerAdapter(this.app);
		const corePlugins = new CorePluginsAdapter(this.app);
		// Resolve the toolchain config lazily so port/binary edits in the settings
		// tab are honored on the next dev/build without re-wiring. stdout/stderr
		// stream to the console for now (C4 will surface a visible panel).
		const astro = new AstroProcessAdapter(projectDir, () => settings.readToolchainConfig(), {
			write: (line) => {
				console.warn(`[specorator] ${line.replace(/\n$/, '')}`);
			},
		});
		this.astro = astro;

		// Bootstrap: the pure EnsureProject use-case drives the I/O adapter so the
		// scaffold/install decision stays testable. Install progress streams to an
		// output channel (C4 adds a visible panel); install/offline failures reject
		// and surface via the command catch blocks below (FR-17 / D10).
		const bootstrapDriver = new ProjectBootstrapAdapter(projectDir);
		const bootstrap = new EnsureProject(bootstrapDriver);

		// Asset pipeline (FR-16): resolve referenced attachments via the metadata
		// cache and copy them into the project's `public/`. Desktop-only, so the
		// vault always has a `FileSystemAdapter` with an absolute base path; if it
		// somehow isn't one, skip the asset step (sync still works without covers).
		const fsAdapter = this.app.vault.adapter;
		const assets =
			fsAdapter instanceof FileSystemAdapter
				? new AssetSourceAdapter(this.app, projectDir, fsAdapter.getBasePath())
				: undefined;

		const sync = new SyncSite(settings, bases, writer, corePlugins, assets);
		const preview = new PreviewSite(bootstrap, corePlugins, sync, astro, webViewer);

		this.addCommand({
			id: 'sync-site',
			name: 'Sync site',
			callback: async () => {
				try {
					await bootstrap.ensureProject();
					const result = await sync.run();
					for (const warning of result.warnings) {
						console.warn(`[specorator] ${warning}`);
					}
					new Notice(`Specorator: synced ${String(result.written)} view(s).`);
				} catch (error) {
					this.notifyFailure('sync', error);
				}
			},
		});

		this.addCommand({
			id: 'preview-site',
			name: 'Preview site',
			callback: async () => {
				try {
					await preview.run();
				} catch (error) {
					this.notifyFailure('preview', error);
				}
			},
		});

		this.registerLiveResync(settings, sync);
	}

	/**
	 * Drive the pure `LiveResyncTrigger` from Obsidian events (FR-20 / D2). The
	 * decision of *whether/when* to re-sync is core; this only feeds it vault
	 * changes + the wall clock and fires `sync.run()` when the model says to. Both
	 * the metadata subscription and the timer are registered with the plugin so
	 * Obsidian tears them down on unload (OBS-4).
	 */
	private registerLiveResync(settings: SettingsStore, sync: SyncSite): void {
		const trigger = new LiveResyncTrigger({ enabled: settings.readSyncConfig().liveResync });

		// Watch metadata changes for the previewed base's `.base` file. The
		// previewed-base wiring is intentionally minimal here (Phase 1): we treat
		// any `.base` file edit as a candidate and let the pure trigger decide.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file: TFile) => {
				if (file.extension !== 'base') return;
				// Re-read the toggle each event so settings changes take effect live.
				trigger.setEnabled(settings.readSyncConfig().liveResync);
				trigger.setPreviewedBase(file.path);
				trigger.onDataChanged(file.path, Date.now());
			}),
		);

		// A lightweight tick checks the debounce window; the model fires at most
		// once per quiet burst.
		this.registerInterval(
			window.setInterval(() => {
				if (trigger.flush(Date.now())) {
					void sync.run().catch((error: unknown) => {
						this.notifyFailure('live re-sync', error);
					});
				}
			}, RESYNC_TICK_MS),
		);
	}

	/**
	 * Surface a use-case failure. A `UserFacingError` (e.g. a disabled core
	 * plugin, FR-10) shows its already-phrased message verbatim; anything else
	 * gets the generic "see console" fallback with the error logged.
	 */
	private notifyFailure(action: string, error: unknown): void {
		if (error instanceof UserFacingError) {
			new Notice(error.message);
			return;
		}
		new Notice(`Specorator: ${action} failed — see console.`);
		console.error(`[specorator] ${action} failed`, error);
	}

	override onunload(): void {
		// Obsidian's onunload is synchronous; fire-and-forget the process teardown.
		void this.astro?.stop();
	}
}
