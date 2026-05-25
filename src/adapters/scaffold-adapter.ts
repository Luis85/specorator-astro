import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScaffoldPort } from '../core/ports';
import { buildStub, type StubKind } from '../core/domain/scaffold-stub';

/**
 * Creates user-owned component/layout stub `.astro` files under the project's
 * `src/user/` tree (FR-11d; DESIGN §5.6). The stub *content* is the pure
 * `buildStub`; this adapter is the thin `node:fs` write with the one
 * load-bearing rule it must enforce:
 *
 * - **NFR-9 (no data loss):** if a file of that name already exists it is
 *   **never** overwritten — `scaffold` returns `created: false` and leaves the
 *   user's file intact. Only a brand-new path is written (creating parent dirs).
 *
 * Only `node:fs` — never a `child_process`.
 */
export class ScaffoldAdapter implements ScaffoldPort {
	constructor(private readonly projectDir: string) {}

	async scaffold(kind: StubKind, name: string): Promise<{ path: string; created: boolean }> {
		const stub = buildStub(kind, name);
		const target = path.join(this.projectDir, stub.path);

		// NFR-9: never clobber an existing user file — bail out reporting not-created.
		if (await this.exists(target)) {
			return { path: stub.path, created: false };
		}

		await mkdir(path.dirname(target), { recursive: true });
		// `wx` flag fails if the file appeared between the check and the write, so a
		// race cannot overwrite an existing file either (still NFR-9 safe).
		try {
			await writeFile(target, stub.contents, { encoding: 'utf8', flag: 'wx' });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
				return { path: stub.path, created: false };
			}
			throw error;
		}
		return { path: stub.path, created: true };
	}

	private async exists(absolute: string): Promise<boolean> {
		try {
			await access(absolute);
			return true;
		} catch {
			return false;
		}
	}
}
