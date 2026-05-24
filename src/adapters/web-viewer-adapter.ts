import type { App } from 'obsidian';
import type { WebViewerPort } from '../core/ports';

/** Opens a URL in Obsidian's built-in Web Viewer core plugin. */
export class WebViewerAdapter implements WebViewerPort {
	constructor(private readonly app: App) {}

	async open(url: string): Promise<void> {
		// Reuse an existing Web Viewer tab if one is open, so repeated previews
		// don't pile up duplicate leaves.
		const existing = this.app.workspace.getLeavesOfType('webviewer');
		const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: 'webviewer',
			state: { url, navigate: true },
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
	}
}
