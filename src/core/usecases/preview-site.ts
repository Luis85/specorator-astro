import type { AstroProcessPort, WebViewerPort } from '../ports';

/**
 * Starts the Astro dev server and opens it in the Web Viewer. Keeping this
 * orchestration in the core (behind the process + web-viewer ports) keeps the
 * composition root free of domain logic and makes the preview flow testable
 * with in-memory fakes. Future depth — port-conflict fallback, waiting for the
 * server to be ready — accrues here behind the same `run()` interface.
 */
export class PreviewSite {
	constructor(
		private readonly astro: AstroProcessPort,
		private readonly webViewer: WebViewerPort,
	) {}

	async run(): Promise<{ url: string }> {
		const { url } = await this.astro.startDev();
		await this.webViewer.open(url);
		return { url };
	}
}
