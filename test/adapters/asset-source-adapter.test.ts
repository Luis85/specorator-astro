import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { AssetSourceAdapter } from '../../src/adapters/asset-source-adapter';

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * A minimal `App` whose metadata cache resolves a known set of vault paths to
 * `TFile`s (mirroring `getFirstLinkpathDest`). Anything else resolves to null.
 */
function fakeApp(files: Record<string, number>): App {
	return {
		metadataCache: {
			getFirstLinkpathDest(linkpath: string, _from: string): TFile | null {
				const match = Object.keys(files).find(
					(p) => p === linkpath || p.endsWith(`/${linkpath}`),
				);
				if (match === undefined) return null;
				// A structural stand-in for the resolved file. The mock's `TFile`
				// makes `instanceof TFile` true; we cast through `unknown` because the
				// real `obsidian` types (used by tsc) require a fuller `FileStats`.
				return Object.assign(new TFile(), {
					path: match,
					stat: { size: files[match], ctime: 0, mtime: 0 },
				});
			},
		},
	} as unknown as App;
}

describe('AssetSourceAdapter', () => {
	let vault: string;
	let project: string;

	beforeEach(async () => {
		const work = await mkdtemp(path.join(tmpdir(), 'specorator-assets-'));
		vault = path.join(work, 'vault');
		project = path.join(work, 'project');
		await mkdir(vault, { recursive: true });
	});

	afterEach(async () => {
		await rm(path.dirname(vault), { recursive: true, force: true });
	});

	describe('locate', () => {
		it('resolves a reference to its vault path + size via the metadata cache', () => {
			const adapter = new AssetSourceAdapter(
				fakeApp({ 'Attachments/cover.png': 1234 }),
				project,
				vault,
			);
			expect(adapter.locate('![[cover.png]]', 'Films/Stalker.md')).toEqual({
				vaultPath: 'Attachments/cover.png',
				sizeBytes: 1234,
			});
		});

		it('returns null when the cache cannot resolve the reference', () => {
			const adapter = new AssetSourceAdapter(fakeApp({}), project, vault);
			expect(adapter.locate('![[missing.png]]', 'Films/Stalker.md')).toBeNull();
		});
	});

	describe('copyAll', () => {
		it('copies a referenced attachment into public/ at the URL path', async () => {
			await mkdir(path.join(vault, 'Attachments'), { recursive: true });
			await writeFile(path.join(vault, 'Attachments', 'cover.png'), 'IMG-BYTES');

			const adapter = new AssetSourceAdapter(fakeApp({}), project, vault);
			const result = await adapter.copyAll([
				{ source: 'Attachments/cover.png', url: '/assets/cover.png' },
			]);

			expect(result.warnings).toEqual([]);
			const dest = path.join(project, 'public', 'assets', 'cover.png');
			expect(await exists(dest)).toBe(true);
			expect(await readFile(dest, 'utf8')).toBe('IMG-BYTES');
		});

		it('skips an identical file already present (content-hash dedupe)', async () => {
			await mkdir(path.join(vault, 'Attachments'), { recursive: true });
			await writeFile(path.join(vault, 'Attachments', 'cover.png'), 'SAME');
			const dest = path.join(project, 'public', 'assets', 'cover.png');
			await mkdir(path.dirname(dest), { recursive: true });
			await writeFile(dest, 'SAME');
			const before = (await stat(dest)).mtimeMs;

			const adapter = new AssetSourceAdapter(fakeApp({}), project, vault);
			await adapter.copyAll([{ source: 'Attachments/cover.png', url: '/assets/cover.png' }]);

			// Untouched: same bytes, so no rewrite (mtime unchanged).
			expect((await stat(dest)).mtimeMs).toBe(before);
		});

		it('overwrites when the existing file differs', async () => {
			await mkdir(path.join(vault, 'Attachments'), { recursive: true });
			await writeFile(path.join(vault, 'Attachments', 'cover.png'), 'NEW');
			const dest = path.join(project, 'public', 'assets', 'cover.png');
			await mkdir(path.dirname(dest), { recursive: true });
			await writeFile(dest, 'OLD');

			const adapter = new AssetSourceAdapter(fakeApp({}), project, vault);
			await adapter.copyAll([{ source: 'Attachments/cover.png', url: '/assets/cover.png' }]);

			expect(await readFile(dest, 'utf8')).toBe('NEW');
		});

		it('warns (not fatal) when the source vanished, and keeps copying the rest', async () => {
			await mkdir(path.join(vault, 'Attachments'), { recursive: true });
			await writeFile(path.join(vault, 'Attachments', 'ok.png'), 'OK');

			const adapter = new AssetSourceAdapter(fakeApp({}), project, vault);
			const result = await adapter.copyAll([
				{ source: 'Attachments/gone.png', url: '/assets/gone.png' },
				{ source: 'Attachments/ok.png', url: '/assets/ok.png' },
			]);

			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('Attachments/gone.png');
			// The other task still copied — one failure does not abort the batch.
			expect(await exists(path.join(project, 'public', 'assets', 'ok.png'))).toBe(true);
		});
	});
});
