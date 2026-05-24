import { Notice, Plugin } from 'obsidian';
import type { AstroProcessPort, ProjectBootstrapPort } from './core/ports';
import { EnsureProject } from './core/usecases/ensure-project';
import { PreviewSite } from './core/usecases/preview-site';
import { SyncSite } from './core/usecases/sync-site';
import { AstroProcessAdapter } from './adapters/astro-process-adapter';
import { BasesHarvesterAdapter } from './adapters/bases-harvester-adapter';
import { FsSnapshotWriter } from './adapters/fs-snapshot-writer';
import { ProjectBootstrapAdapter } from './adapters/project-bootstrap-adapter';
import { SettingsStore } from './adapters/settings-store';
import { SiteSettingTab } from './adapters/settings-tab';
import { WebViewerAdapter } from './adapters/web-viewer-adapter';

/**
 * Composition root. Wires adapters (Obsidian/Node) into the pure core use-cases,
 * registers commands, and surfaces use-case results to the user. No domain
 * logic lives here.
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
		const astro = new AstroProcessAdapter(projectDir);
		this.astro = astro;

		// Bootstrap: the pure EnsureProject use-case drives the I/O adapter so the
		// scaffold/install decision stays testable. Install progress streams to an
		// output channel (C4 adds a visible panel); install/offline failures reject
		// and surface via the command catch blocks below (FR-17 / D10).
		const bootstrapDriver = new ProjectBootstrapAdapter(projectDir);
		const bootstrap: ProjectBootstrapPort = new EnsureProject(bootstrapDriver);

		const sync = new SyncSite(settings, bases, writer);
		const preview = new PreviewSite(astro, webViewer);

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
					new Notice('Specorator: sync failed — see console.');
					console.error('[specorator] Sync failed', error);
				}
			},
		});

		this.addCommand({
			id: 'preview-site',
			name: 'Preview site',
			callback: async () => {
				try {
					await bootstrap.ensureProject();
					await preview.run();
				} catch (error) {
					new Notice('Specorator: preview failed — see console.');
					console.error('[specorator] Preview failed', error);
				}
			},
		});
	}

	override onunload(): void {
		// Obsidian's onunload is synchronous; fire-and-forget the process teardown.
		void this.astro?.stop();
	}
}
