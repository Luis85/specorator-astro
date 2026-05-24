import { describe, expect, it } from 'vitest';
import { checkCorePlugins } from '../../src/core/domain/core-plugins';

describe('checkCorePlugins', () => {
	const allEnabled = { basesEnabled: true, webViewerEnabled: true };

	it('passes when every required plugin is enabled', () => {
		expect(checkCorePlugins(allEnabled, ['bases', 'webviewer'])).toEqual({
			ok: true,
			message: null,
		});
	});

	it('passes when the only required plugin is enabled, ignoring the other', () => {
		const check = checkCorePlugins({ basesEnabled: true, webViewerEnabled: false }, ['bases']);
		expect(check.ok).toBe(true);
		expect(check.message).toBeNull();
	});

	it('fails with a clear Bases message when Bases is disabled (FR-10)', () => {
		const check = checkCorePlugins({ basesEnabled: false, webViewerEnabled: true }, ['bases']);
		expect(check.ok).toBe(false);
		expect(check.message).toContain('Bases core plugin is disabled');
		expect(check.message).toContain('Settings → Core plugins');
	});

	it('fails with the Web Viewer message when only Web Viewer is disabled', () => {
		const check = checkCorePlugins({ basesEnabled: true, webViewerEnabled: false }, [
			'bases',
			'webviewer',
		]);
		expect(check.ok).toBe(false);
		expect(check.message).toContain('Web Viewer core plugin is disabled');
		expect(check.message).not.toContain('Bases core plugin is disabled');
	});

	it('joins both messages when both required plugins are disabled', () => {
		const check = checkCorePlugins({ basesEnabled: false, webViewerEnabled: false }, [
			'bases',
			'webviewer',
		]);
		expect(check.ok).toBe(false);
		expect(check.message).toContain('Bases core plugin is disabled');
		expect(check.message).toContain('Web Viewer core plugin is disabled');
		expect(check.message?.split('\n')).toHaveLength(2);
	});
});
