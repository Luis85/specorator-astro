import type { App } from 'obsidian';
import type { WebViewerPort } from '../core/ports';

/** Opens a URL in Obsidian's built-in Web Viewer core plugin. */
export class WebViewerAdapter implements WebViewerPort {
	constructor(private readonly app: App) {}

	async open(url: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: 'webviewer',
			state: { url, navigate: true },
			active: true,
		});
	}
}
