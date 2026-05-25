/**
 * Pure trigger/debounce decision for the **live re-sync of the actively-previewed
 * base** (FR-20; DESIGN §5.1 trigger D2, §4.1).
 *
 * After the first preview auto-syncs, the plugin optionally watches for data
 * changes and re-syncs — but only for the base the user is currently previewing,
 * and only after a quiet window so a burst of edits collapses into a single
 * re-harvest (the large-vault concern in §4.1 risk-7). Whether to fire, when,
 * and how rapid events coalesce is a *decision*, not I/O — so it lives here as a
 * deterministic state machine. The adapter owns only the raw Obsidian event
 * subscription and the wall-clock timer; it asks this model what to do.
 *
 * Contract (the adapter drives it):
 * - `setEnabled(on)` mirrors the settings toggle (`sync.liveResync`); when off,
 *   no event ever schedules a fire and any pending one is dropped.
 * - `setPreviewedBase(path)` records which base is on screen; changes to other
 *   bases are ignored, so only the previewed base triggers (§5.1).
 * - `onDataChanged(path, now)` reports a vault data change. It returns the time a
 *   fire should be (re)scheduled for, or `null` to ignore the event. Each
 *   qualifying change pushes the deadline `debounceMs` past `now`, so N rapid
 *   changes collapse into one fire after the burst goes quiet.
 * - `flush(now)` is called when the adapter's timer elapses: it returns `true`
 *   exactly once when the debounce window has actually passed (and clears the
 *   pending state), or `false` if it fired early / nothing is pending — the
 *   adapter then re-arms for the remaining time.
 *
 * Pure: timestamps + flags in → decisions out. No I/O, no `obsidian`, no Node,
 * no real timers.
 */

/** Default quiet window before a live re-sync fires (ms). */
export const DEFAULT_RESYNC_DEBOUNCE_MS = 1_500;

export class LiveResyncTrigger {
	private enabled: boolean;
	private readonly debounceMs: number;
	/** Vault path of the base currently being previewed, or `null`. */
	private previewedBase: string | null = null;
	/** Wall-clock time a fire is scheduled for, or `null` when nothing pending. */
	private deadline: number | null = null;

	constructor(options: { enabled: boolean; debounceMs?: number }) {
		this.enabled = options.enabled;
		this.debounceMs = options.debounceMs ?? DEFAULT_RESYNC_DEBOUNCE_MS;
	}

	/** Mirror the `sync.liveResync` toggle. Disabling drops any pending fire. */
	setEnabled(on: boolean): void {
		this.enabled = on;
		if (!on) {
			this.deadline = null;
		}
	}

	/** Record which base is on screen; clearing it drops any pending fire. */
	setPreviewedBase(basePath: string | null): void {
		this.previewedBase = basePath;
		if (basePath === null) {
			this.deadline = null;
		}
	}

	/**
	 * Report a data change for `basePath`. Returns the (absolute) time a fire
	 * should be scheduled for, or `null` if the event is ignored (disabled, no
	 * previewed base, or a change to a different base). Each qualifying call
	 * pushes the deadline forward so a burst collapses to a single fire.
	 */
	onDataChanged(basePath: string, now: number): number | null {
		if (!this.enabled || this.previewedBase === null || basePath !== this.previewedBase) {
			return null;
		}
		this.deadline = now + this.debounceMs;
		return this.deadline;
	}

	/**
	 * Called when the adapter's timer elapses at `now`. Returns `true` exactly
	 * once when the quiet window has fully elapsed — clearing the pending state so
	 * the caller fires a single re-sync. Returns `false` when nothing is pending
	 * or the timer woke early (a later change pushed the deadline out); the caller
	 * should re-arm for `timeRemaining(now)`.
	 */
	flush(now: number): boolean {
		if (this.deadline === null || now < this.deadline) {
			return false;
		}
		this.deadline = null;
		return true;
	}

	/** Whether a fire is currently scheduled (for the adapter to arm a timer). */
	hasPending(): boolean {
		return this.deadline !== null;
	}

	/** Milliseconds until the pending fire from `now` (0 if due/none pending). */
	timeRemaining(now: number): number {
		if (this.deadline === null) {
			return 0;
		}
		return Math.max(0, this.deadline - now);
	}
}
