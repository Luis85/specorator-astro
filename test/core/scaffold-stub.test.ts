import { describe, expect, it } from 'vitest';
import { buildStub, stubBasename } from '../../src/core/domain/scaffold-stub';

describe('stubBasename', () => {
	it('keeps a clean name and strips a trailing .astro', () => {
		expect(stubBasename('view', 'BookCard')).toBe('BookCard');
		expect(stubBasename('view', 'BookCard.astro')).toBe('BookCard');
	});

	it('sanitizes unsafe characters into dashes and trims them', () => {
		expect(stubBasename('view', '  My View!! ')).toBe('My-View');
		expect(stubBasename('view', 'a/b\\c')).toBe('a-b-c');
	});

	it('falls back to a kind-specific default for a name that sanitizes away', () => {
		expect(stubBasename('view', '!!!')).toBe('CustomView');
		expect(stubBasename('layout', '')).toBe('CustomLayout');
	});
});

describe('buildStub', () => {
	it('builds a view stub under src/user/views with the entry-listing props', () => {
		const stub = buildStub('view', 'BookCard');
		expect(stub.path).toBe('src/user/views/BookCard.astro');
		expect(stub.contents).toContain('ViewSnapshot');
		expect(stub.contents).toContain('snapshot.groups.flatMap');
		// Documents the never-overwrite/upgrade-safe guarantee (FR-11a/NFR-9).
		expect(stub.contents).toContain('NEVER overwritten');
	});

	it('builds a layout stub under src/user/layouts wrapping a slot in the token shell', () => {
		const stub = buildStub('layout', 'Wide');
		expect(stub.path).toBe('src/user/layouts/Wide.astro');
		expect(stub.contents).toContain('<slot />');
		expect(stub.contents).toContain("import '../theme.css'");
		expect(stub.contents).toContain('tokens.css');
	});

	it('routes a sanitized name to a safe path', () => {
		expect(buildStub('view', 'My View!!').path).toBe('src/user/views/My-View.astro');
	});
});
