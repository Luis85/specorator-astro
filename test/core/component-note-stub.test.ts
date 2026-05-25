import { describe, expect, it } from 'vitest';
import {
	astroFenceSnippet,
	buildComponentNote,
	componentNoteBasename,
} from '../../src/core/domain/component-note-stub';
import { transpileComponentNote } from '../../src/core/domain/component-transpile';

describe('component-note-stub', () => {
	it('astroFenceSnippet drops a valid single ```astro fence', () => {
		const snippet = astroFenceSnippet();
		expect(snippet).toContain('```astro');
		// Exactly one opening + one closing fence.
		expect((snippet.match(/```/g) ?? []).length).toBe(2);
	});

	it('sanitizes requested names into safe note basenames', () => {
		expect(componentNoteBasename('Book Card!.md')).toBe('Book-Card');
		expect(componentNoteBasename('  ')).toBe('NewComponent');
		expect(componentNoteBasename('!!!')).toBe('NewComponent');
		expect(componentNoteBasename('Valid_Name-1')).toBe('Valid_Name-1');
	});

	it('builds a note that is itself a well-formed component the transpiler accepts', () => {
		const stub = buildComponentNote('BookCard', 'view');
		expect(stub.fileName).toBe('BookCard.md');
		expect(stub.contents).toContain('name: BookCard');
		// Discloses build-time execution in the note body (FR-18 disclosure).
		expect(stub.contents).toContain('Build-time code execution');

		// Round-trip: the scaffolded note transpiles to a generated view.
		const result = transpileComponentNote(stub.contents);
		expect(result.outcome).toBe('transpiled');
		if (result.outcome === 'transpiled') {
			expect(result.path).toBe('src/generated/views/BookCard.astro');
			expect(result.meta.kind).toBe('view');
		}
	});

	it('honors a layout kind', () => {
		const stub = buildComponentNote('Shell', 'layout');
		const result = transpileComponentNote(stub.contents);
		expect(result.outcome === 'transpiled' && result.path).toBe(
			'src/generated/layouts/Shell.astro',
		);
	});
});
