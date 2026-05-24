import { describe, expect, it, vi } from 'vitest';
import { PreviewSite } from '../../src/core/usecases/preview-site';
import type { AstroProcessPort, WebViewerPort } from '../../src/core/ports';

function astroFake(url = 'http://localhost:4321'): AstroProcessPort {
	return {
		startDev: vi.fn(async () => ({ url })),
		build: vi.fn(),
		stop: vi.fn(),
	};
}

describe('PreviewSite', () => {
	it('opens the Web Viewer at the URL the dev server reports', async () => {
		const astro = astroFake('http://localhost:5000');
		const open = vi.fn(async () => {});
		const webViewer: WebViewerPort = { open };

		const result = await new PreviewSite(astro, webViewer).run();

		expect(open).toHaveBeenCalledWith('http://localhost:5000');
		expect(result.url).toBe('http://localhost:5000');
	});

	it('starts the dev server before opening the preview', async () => {
		const order: string[] = [];
		const astro: AstroProcessPort = {
			startDev: vi.fn(async () => {
				order.push('startDev');
				return { url: 'http://localhost:4321' };
			}),
			build: vi.fn(),
			stop: vi.fn(),
		};
		const webViewer: WebViewerPort = {
			open: vi.fn(async () => {
				order.push('open');
			}),
		};

		await new PreviewSite(astro, webViewer).run();

		expect(order).toEqual(['startDev', 'open']);
	});

	it('propagates a dev-server failure without opening the preview', async () => {
		const astro: AstroProcessPort = {
			startDev: vi.fn(async () => {
				throw new Error('port in use');
			}),
			build: vi.fn(),
			stop: vi.fn(),
		};
		const open = vi.fn(async () => {});
		const webViewer: WebViewerPort = { open };

		await expect(new PreviewSite(astro, webViewer).run()).rejects.toThrow('port in use');
		expect(open).not.toHaveBeenCalled();
	});
});
