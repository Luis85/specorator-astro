import { describe, expect, it } from 'vitest';
import { DEFAULT_RESYNC_DEBOUNCE_MS, LiveResyncTrigger } from '../../src/core/domain/live-resync';

describe('LiveResyncTrigger', () => {
	it('does not schedule a fire when disabled (toggle off)', () => {
		const trigger = new LiveResyncTrigger({ enabled: false, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');

		expect(trigger.onDataChanged('Books/books.base', 0)).toBeNull();
		expect(trigger.hasPending()).toBe(false);
	});

	it('schedules a fire one debounce window after a change to the previewed base', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');

		expect(trigger.onDataChanged('Books/books.base', 100)).toBe(1100);
		expect(trigger.hasPending()).toBe(true);
	});

	it('ignores changes to bases other than the previewed one', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');

		expect(trigger.onDataChanged('Projects/projects.base', 0)).toBeNull();
		expect(trigger.hasPending()).toBe(false);
	});

	it('ignores changes when no base is being previewed', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		expect(trigger.onDataChanged('Books/books.base', 0)).toBeNull();
		expect(trigger.hasPending()).toBe(false);
	});

	it('collapses multiple rapid events into a single fire after the last one', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');

		// A burst of edits, each pushing the deadline forward.
		expect(trigger.onDataChanged('Books/books.base', 0)).toBe(1000);
		expect(trigger.onDataChanged('Books/books.base', 200)).toBe(1200);
		expect(trigger.onDataChanged('Books/books.base', 500)).toBe(1500);

		// A timer that wakes before the (last) deadline must not fire.
		expect(trigger.flush(1200)).toBe(false);
		expect(trigger.hasPending()).toBe(true);

		// Once the quiet window fully elapses, it fires exactly once...
		expect(trigger.flush(1500)).toBe(true);
		// ...and not again (the pending state is cleared).
		expect(trigger.flush(1600)).toBe(false);
		expect(trigger.hasPending()).toBe(false);
	});

	it('flush is a no-op when nothing is pending', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		expect(trigger.flush(9999)).toBe(false);
	});

	it('disabling mid-flight drops a pending fire', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');
		trigger.onDataChanged('Books/books.base', 0);
		expect(trigger.hasPending()).toBe(true);

		trigger.setEnabled(false);
		expect(trigger.hasPending()).toBe(false);
		expect(trigger.flush(2000)).toBe(false);
	});

	it('clearing the previewed base drops a pending fire', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');
		trigger.onDataChanged('Books/books.base', 0);
		expect(trigger.hasPending()).toBe(true);

		trigger.setPreviewedBase(null);
		expect(trigger.hasPending()).toBe(false);
	});

	it('reports the time remaining until a pending fire', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');
		trigger.onDataChanged('Books/books.base', 100);

		expect(trigger.timeRemaining(600)).toBe(500);
		// Never negative once the deadline has passed.
		expect(trigger.timeRemaining(2000)).toBe(0);
		// Zero when nothing is pending.
		trigger.flush(1100);
		expect(trigger.timeRemaining(1200)).toBe(0);
	});

	it('re-enables and schedules again after a previous disable', () => {
		const trigger = new LiveResyncTrigger({ enabled: true, debounceMs: 1000 });
		trigger.setPreviewedBase('Books/books.base');
		trigger.setEnabled(false);
		expect(trigger.onDataChanged('Books/books.base', 0)).toBeNull();

		trigger.setEnabled(true);
		expect(trigger.onDataChanged('Books/books.base', 0)).toBe(1000);
	});

	it('defaults the debounce window when not specified', () => {
		const trigger = new LiveResyncTrigger({ enabled: true });
		trigger.setPreviewedBase('Books/books.base');
		expect(trigger.onDataChanged('Books/books.base', 0)).toBe(DEFAULT_RESYNC_DEBOUNCE_MS);
	});
});
