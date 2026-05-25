import { describe, expect, it } from 'vitest';
import { parseDevServerUrl } from '../../src/core/domain/dev-url';

describe('parseDevServerUrl', () => {
	it('extracts the URL from Astro\'s "Local:" line', () => {
		const stdout = [
			'',
			'  astro  v6.3.7 ready in 412 ms',
			'',
			'  ┃ Local    http://localhost:4321/',
			'  ┃ Network  use --host to expose',
			'',
		].join('\n');
		expect(parseDevServerUrl(stdout)).toBe('http://localhost:4321/');
	});

	it('handles the classic "Local:  http://localhost:4321/" form', () => {
		expect(parseDevServerUrl('Local:  http://localhost:4321/')).toBe('http://localhost:4321/');
	});

	it('strips ANSI colour codes around the URL', () => {
		const colored = '  [32m┃[39m Local    [36mhttp://localhost:4321/[39m';
		expect(parseDevServerUrl(colored)).toBe('http://localhost:4321/');
	});

	it('normalizes a missing trailing slash to exactly one', () => {
		expect(parseDevServerUrl('Local: http://localhost:3000')).toBe('http://localhost:3000/');
	});

	it('collapses repeated trailing slashes to one', () => {
		expect(parseDevServerUrl('Local: http://localhost:4321///')).toBe('http://localhost:4321/');
	});

	it('honors the actual fallback port Astro printed, not the requested one', () => {
		const stdout =
			'Port 4321 is in use, trying another one...\n  ┃ Local    http://localhost:4322/';
		expect(parseDevServerUrl(stdout)).toBe('http://localhost:4322/');
	});

	it('falls back to a bare localhost URL when no label is present', () => {
		expect(parseDevServerUrl('serving at http://localhost:4321/ now')).toBe(
			'http://localhost:4321/',
		);
	});

	it('recognizes a 127.0.0.1 address', () => {
		expect(parseDevServerUrl('Local: http://127.0.0.1:4321/')).toBe('http://127.0.0.1:4321/');
	});

	it('drops trailing punctuation the CLI may append', () => {
		expect(parseDevServerUrl('Open http://localhost:4321/.')).toBe('http://localhost:4321/');
	});

	it('returns null before any URL is announced', () => {
		expect(parseDevServerUrl('astro  v6.3.7 starting...')).toBeNull();
		expect(parseDevServerUrl('')).toBeNull();
	});

	it('does not match non-http noise', () => {
		expect(parseDevServerUrl('watching for file changes at /home/user/astro')).toBeNull();
	});
});
