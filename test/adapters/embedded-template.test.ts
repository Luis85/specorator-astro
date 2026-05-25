import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_TEMPLATE_FILES } from '../../src/adapters/generated/embedded-template';
import { classifyOwnership } from '../../src/core/domain/template';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const templateRoot = path.join(repoRoot, 'templates', 'astro');

/**
 * Asserts the generated artifact embedded into main.js (DIST-BRAT-1) actually
 * carries the template's contents and ownership. `embed:template:check`
 * guarantees the file is in sync with the tree; this guards the *shape* and
 * fidelity in the fast unit loop.
 */
describe('EMBEDDED_TEMPLATE_FILES', () => {
	it('embeds the core template files needed to bootstrap a runnable project', () => {
		const paths = EMBEDDED_TEMPLATE_FILES.map((f) => f.path);
		expect(paths).toContain('package.json');
		expect(paths).toContain('astro.config.mjs');
		expect(paths).toContain('src/pages/index.astro');
		expect(paths).toContain('src/registry.ts');
		expect(paths).toContain('src/theme/styles/tokens.css');
		expect(paths).toContain('src/user/theme.css');
	});

	it('classifies src/user/** as user-owned and everything else as template-owned', () => {
		for (const file of EMBEDDED_TEMPLATE_FILES) {
			expect(file.ownership).toBe(classifyOwnership(file.path));
		}
		const userFiles = EMBEDDED_TEMPLATE_FILES.filter((f) => f.ownership === 'user');
		expect(userFiles.length).toBeGreaterThan(0);
		for (const file of userFiles) {
			expect(file.path.startsWith('src/user/')).toBe(true);
		}
	});

	it('embeds verbatim contents matching the on-disk template (no drift)', async () => {
		expect(EMBEDDED_TEMPLATE_FILES.length).toBeGreaterThan(0);
		for (const file of EMBEDDED_TEMPLATE_FILES) {
			const onDisk = await readFile(path.join(templateRoot, file.path), 'utf8');
			expect(file.contents).toBe(onDisk);
		}
	});
});
