import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewSnapshot } from '../../src/core/domain/types';

// Simulate a filesystem that refuses fsync — cloud-synced vault folders
// (iCloud/OneDrive/Dropbox), network shares, Windows directory handles: the
// write itself succeeds but handle.sync() throws EPERM. The writer must treat
// this as a no-op and still commit, not abort the whole sync/preview.
vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	return {
		...actual,
		open: async (filePath: string, flags: string) => {
			const handle = await actual.open(filePath, flags);
			handle.sync = async () => {
				const error: NodeJS.ErrnoException = new Error(
					'EPERM: operation not permitted, fsync',
				);
				error.code = 'EPERM';
				throw error;
			};
			return handle;
		},
	};
});

import { FsSnapshotWriter } from '../../src/adapters/fs-snapshot-writer';

function snapshot(baseId: string): ViewSnapshot {
	return {
		baseId,
		route: `/${baseId.toLowerCase()}`,
		source: { kind: 'file', path: `${baseId}.base` },
		view: { type: 'table', name: 'Default', order: [] },
		render: { component: 'table', layout: 'BaseLayout' },
		groups: [{ key: null, entries: [] }],
		generatedAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('FsSnapshotWriter on an fsync-refusing filesystem (EPERM)', () => {
	let projectDir: string;

	beforeEach(async () => {
		projectDir = await mkdtemp(path.join(tmpdir(), 'specorator-fsync-'));
	});

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	it('commits and writes the data set even when fsync throws EPERM', async () => {
		const writer = new FsSnapshotWriter(projectDir);

		// Pre-fix this rejected with the EPERM from handle.sync(); it must not now.
		await writer.commit([snapshot('books')]);

		const dataDir = path.join(projectDir, 'data');
		const index = JSON.parse(await readFile(path.join(dataDir, 'index.json'), 'utf8')) as {
			snapshots: { baseId: string; file: string }[];
		};
		expect(index.snapshots).toHaveLength(1);
		const entry = index.snapshots[0];
		expect(entry.baseId).toBe('books');
		await expect(stat(path.join(dataDir, entry.file))).resolves.toBeDefined();
	});
});
