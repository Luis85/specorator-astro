import { Notice, Plugin } from 'obsidian';
import type { AstroProcessPort, Logger } from './core/ports';
import { SyncSite } from './core/usecases/sync-site';
import { AstroProcessAdapter } from './adapters/astro-process-adapter';
import { BasesHarvesterAdapter } from './adapters/bases-harvester-adapter';
import { FsSnapshotWriter } from './adapters/fs-snapshot-writer';
import { ObsidianVaultAdapter } from './adapters/obsidian-vault-adapter';
import { WebViewerAdapter } from './adapters/web-viewer-adapter';

const CONFIG_NOTE = 'Site/site.md';

/**
 * Composition root. Wires adapters (Obsidian/Node) into the pure core use-cases
 * and registers commands. No domain logic lives here.
 */
export default class SpecoratorAstroViewerPlugin extends Plugin {
	private astro: AstroProcessPort | null = null;

	override async onload(): Promise<void> {
		const logger: Logger = {
			info: (message) => console.debug(`[specorator] ${message}`),
			warn: (message) => console.warn(`[specorator] ${message}`),
			error: (message, error) => console.error(`[specorator] ${message}`, error),
		};

		const projectDir = `${this.manifest.dir ?? ''}/astro`;
		const vault = new ObsidianVaultAdapter(this.app, CONFIG_NOTE);
		const bases = new BasesHarvesterAdapter();
		const writer = new FsSnapshotWriter(projectDir);
		const webViewer = new WebViewerAdapter(this.app);
		const astro = new AstroProcessAdapter(projectDir);
		this.astro = astro;

		const sync = new SyncSite(vault, bases, writer, logger);

		this.addCommand({
			id: 'sync-site',
			name: 'Sync site',
			callback: async () => {
				try {
					const result = await sync.run();
					new Notice(`Specorator: synced ${result.written} view(s).`);
				} catch (error) {
					new Notice('Specorator: sync failed — see console.');
					logger.error('Sync failed', error);
				}
			},
		});

		this.addCommand({
			id: 'preview-site',
			name: 'Preview site',
			callback: async () => {
				try {
					const { url } = await astro.startDev();
					await webViewer.open(url);
				} catch (error) {
					new Notice('Specorator: preview failed — see console.');
					logger.error('Preview failed', error);
				}
			},
		});
	}

	override onunload(): void {
		// Obsidian's onunload is synchronous; fire-and-forget the process teardown.
		void this.astro?.stop();
	}
}
