import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScaffoldAdapter } from '../../src/adapters/scaffold-adapter';

describe('ScaffoldAdapter (temp-dir contract)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'specorator-scaffold-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('creates a user-owned view stub, creating parent dirs', async () => {
		const result = await new ScaffoldAdapter(dir).scaffold('view', 'BookCard');
		expect(result).toEqual({ path: 'src/user/views/BookCard.astro', created: true });
		const written = await readFile(path.join(dir, result.path), 'utf8');
		expect(written).toContain('ViewSnapshot');
		expect(written).toContain('NEVER overwritten');
	});

	it('creates a user-owned layout stub under src/user/layouts', async () => {
		const result = await new ScaffoldAdapter(dir).scaffold('layout', 'Wide');
		expect(result).toEqual({ path: 'src/user/layouts/Wide.astro', created: true });
		const written = await readFile(path.join(dir, result.path), 'utf8');
		expect(written).toContain('<slot />');
	});

	it('NEVER overwrites an existing file (NFR-9), leaving its bytes intact', async () => {
		const rel = 'src/user/views/BookCard.astro';
		const target = path.join(dir, rel);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, 'PRECIOUS USER WORK', 'utf8');

		const result = await new ScaffoldAdapter(dir).scaffold('view', 'BookCard');
		expect(result).toEqual({ path: rel, created: false });
		expect(await readFile(target, 'utf8')).toBe('PRECIOUS USER WORK');
	});

	it('sanitizes an unsafe requested name into a safe path', async () => {
		const result = await new ScaffoldAdapter(dir).scaffold('view', 'My View!!');
		expect(result.path).toBe('src/user/views/My-View.astro');
		expect(result.created).toBe(true);
	});
});
