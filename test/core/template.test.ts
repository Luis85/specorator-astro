import { describe, expect, it } from 'vitest';
import { classifyOwnership } from '../../src/core/domain/template';

describe('classifyOwnership', () => {
	it('classifies src/user/** as user-owned', () => {
		expect(classifyOwnership('src/user/theme.css')).toBe('user');
		expect(classifyOwnership('src/user/layouts/Custom.astro')).toBe('user');
		expect(classifyOwnership('src/user')).toBe('user');
	});

	it('classifies everything else as template-owned', () => {
		expect(classifyOwnership('package.json')).toBe('template');
		expect(classifyOwnership('src/theme/styles/tokens.css')).toBe('template');
		expect(classifyOwnership('src/registry.ts')).toBe('template');
		expect(classifyOwnership('astro.config.mjs')).toBe('template');
	});

	it('normalizes leading ./ and backslashes before classifying', () => {
		expect(classifyOwnership('./src/user/theme.css')).toBe('user');
		expect(classifyOwnership('src\\user\\theme.css')).toBe('user');
		expect(classifyOwnership('./src/theme/x.css')).toBe('template');
	});

	it('does not treat a src/users-like prefix as user-owned', () => {
		expect(classifyOwnership('src/users-guide.md')).toBe('template');
	});
});
