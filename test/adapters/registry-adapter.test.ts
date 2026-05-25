import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RegistryAdapter } from '../../src/adapters/registry-adapter';
import { resolveRegistry, availableNames } from '../../src/core/domain/registry';

describe('RegistryAdapter (temp-dir contract)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'specorator-registry-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	async function writeAstro(rel: string): Promise<void> {
		const full = path.join(dir, rel);
		await mkdir(path.dirname(full), { recursive: true });
		await writeFile(full, '---\n---\n', 'utf8');
	}

	it('returns empty tiers when nothing exists yet (safe before scaffold)', async () => {
		const discovered = await new RegistryAdapter(dir).discover();
		expect(discovered.components).toEqual({ generated: [], user: [], theme: [] });
		expect(discovered.layouts).toEqual({ generated: [], user: [], theme: [] });
	});

	it('discovers .astro names per tier, ignoring non-astro files', async () => {
		await writeAstro('src/theme/views/Table.astro');
		await writeAstro('src/theme/views/Cards.astro');
		await writeAstro('src/theme/layouts/BaseLayout.astro');
		await writeAstro('src/user/views/BookCard.astro');
		await writeAstro('src/user/layouts/Wide.astro');
		await writeFile(path.join(dir, 'src/theme/views/README.md'), '# not a component\n', 'utf8');

		const discovered = await new RegistryAdapter(dir).discover();
		expect([...(discovered.components.theme ?? [])].sort()).toEqual(['Cards', 'Table']);
		expect(discovered.components.user).toEqual(['BookCard']);
		expect(discovered.layouts.theme).toEqual(['BaseLayout']);
		expect(discovered.layouts.user).toEqual(['Wide']);
		expect(discovered.components.generated).toEqual([]);
	});

	it('feeds the pure precedence merge so user shadows a same-named theme view', async () => {
		await writeAstro('src/theme/views/Cards.astro');
		await writeAstro('src/user/views/Cards.astro');
		const resolved = resolveRegistry(await new RegistryAdapter(dir).discover());
		expect(resolved.components).toContainEqual({ name: 'Cards', tier: 'user' });
		expect(availableNames(resolved.components)).toEqual(['Cards']);
	});
});
