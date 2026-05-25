import { describe, expect, it } from 'vitest';
import { TranspileLibrary } from '../../src/core/usecases/transpile-library';
import { grantConsent, revokeConsent } from '../../src/core/domain/consent';
import type { ConsentState } from '../../src/core/domain/consent';
import type { ComponentLibraryPort, ComponentLibraryTranspilePort } from '../../src/core/ports';
import type { TranspiledComponent } from '../../src/core/domain/component-transpile';

const BOOK_CARD = [
	'---',
	'component:',
	'    name: BookCard',
	'    kind: view',
	'---',
	'```astro',
	'<i/>',
	'```',
].join('\n');

/** In-memory transpile port recording reads/writes so we can assert the gate. */
class FakeTranspiler implements ComponentLibraryTranspilePort {
	readonly reads: string[] = [];
	writeCount = 0;
	written: readonly TranspiledComponent[] | null = null;

	constructor(private readonly notes: { path: string; raw: string }[] = []) {}

	readLibraryNotes(folder: string): Promise<{ path: string; raw: string }[]> {
		this.reads.push(folder);
		return Promise.resolve(this.notes);
	}

	writeGenerated(components: readonly TranspiledComponent[]): Promise<void> {
		this.writeCount += 1;
		this.written = components;
		return Promise.resolve();
	}
}

function libraryPort(consent: ConsentState, folder = 'Site/components'): ComponentLibraryPort {
	return { readLibraryConfig: () => ({ folder, consent }) };
}

describe('TranspileLibrary — consent hard-gate (FR-18 / D11)', () => {
	it('absent/not-granted consent → HARD no-op: never reads or writes', async () => {
		const tp = new FakeTranspiler([{ path: 'Site/components/BookCard.md', raw: BOOK_CARD }]);
		const usecase = new TranspileLibrary(libraryPort({ granted: false }), tp);

		const result = await usecase.run();

		expect(result).toEqual({ consented: false, emitted: 0, warnings: [] });
		// The load-bearing security invariant: no read, no write — nothing executes.
		expect(tp.reads).toHaveLength(0);
		expect(tp.writeCount).toBe(0);
	});

	it('granted consent → reads the configured folder, transpiles, and writes generated', async () => {
		const tp = new FakeTranspiler([{ path: 'Site/components/BookCard.md', raw: BOOK_CARD }]);
		const usecase = new TranspileLibrary(libraryPort(grantConsent(1, 't'), 'Components'), tp);

		const result = await usecase.run();

		expect(result.consented).toBe(true);
		expect(result.emitted).toBe(1);
		expect(tp.reads).toEqual(['Components']);
		expect(tp.written).toHaveLength(1);
		expect(tp.written?.[0].path).toBe('src/generated/views/BookCard.astro');
	});

	it('revoked consent → HARD no-op again (revocable, FR-18)', async () => {
		const tp = new FakeTranspiler([{ path: 'Site/components/BookCard.md', raw: BOOK_CARD }]);
		const usecase = new TranspileLibrary(libraryPort(revokeConsent()), tp);

		const result = await usecase.run();

		expect(result.consented).toBe(false);
		expect(tp.reads).toHaveLength(0);
		expect(tp.writeCount).toBe(0);
	});

	it('the gate decision is deterministic across repeated runs', async () => {
		const tp = new FakeTranspiler();
		const closed = new TranspileLibrary(libraryPort({ granted: false }), tp);
		expect((await closed.run()).consented).toBe(false);
		expect((await closed.run()).consented).toBe(false);
		const open = new TranspileLibrary(libraryPort({ granted: true }), tp);
		expect((await open.run()).consented).toBe(true);
		expect((await open.run()).consented).toBe(true);
	});
});

describe('TranspileLibrary — emission (when consented)', () => {
	it('skips non-component notes with a reason and still writes the valid ones', async () => {
		const tp = new FakeTranspiler([
			{ path: 'Site/components/BookCard.md', raw: BOOK_CARD },
			{ path: 'Site/components/Readme.md', raw: 'Just notes, no frontmatter.' },
			{
				path: 'Site/components/Half.md',
				raw: '---\ncomponent:\n    name: Half\n---\nno fence',
			},
		]);
		const usecase = new TranspileLibrary(libraryPort({ granted: true }), tp);

		const result = await usecase.run();

		expect(result.emitted).toBe(1);
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[0]).toContain('Skipped Site/components/Readme.md');
		expect(result.warnings[1]).toContain('Skipped Site/components/Half.md');
		// Only the one valid component is written; skips are not emitted (no leakage).
		expect(tp.written).toHaveLength(1);
	});

	it('writes an empty set (clearing stale generated) when no notes are valid', async () => {
		const tp = new FakeTranspiler([
			{ path: 'Site/components/Readme.md', raw: 'no frontmatter' },
		]);
		const usecase = new TranspileLibrary(libraryPort({ granted: true }), tp);
		const result = await usecase.run();
		expect(result.emitted).toBe(0);
		// Still calls write with [] so a removed component clears its generated module.
		expect(tp.writeCount).toBe(1);
		expect(tp.written).toEqual([]);
	});
});
