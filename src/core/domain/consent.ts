/**
 * Pure **consent gate** for the build-time-executing vault component library
 * (FR-18 / D11; DESIGN §5.6, §5.10). No I/O, no `obsidian`, no Node.
 *
 * A ` ```astro ` code-fence component note is transpiled into a real `.astro`
 * module under `src/generated/` that Vite/Node **executes at build time** — it
 * can `import`, read files, spawn processes, exactly like source. Build-time
 * Node **cannot be honestly sandboxed** (DESIGN §5.10), so the mitigation is a
 * **one-time explicit consent** decision, persisted and revocable, NOT a fake
 * sandbox.
 *
 * This module is the *decision*: given the persisted {@link ConsentState}, may
 * the plugin transpile + emit (and therefore later execute) the vault component
 * library? When consent is absent the transpile/generated-output step is a
 * **hard NO-OP** — no `.astro` is generated, so nothing of the user's authored
 * code ever reaches the build. The state shape, the grant/revoke transitions,
 * and the gate predicate live here so the rule is deterministic and unit-tested;
 * persistence (in the versioned settings) and the actual fs write are the
 * adapter's thin job.
 */

/**
 * Persisted consent for the build-time component library. Default is **NOT
 * granted** (`granted: false`) — the safe `theme/` components are the default
 * path (FR-11g) and code-fence components do nothing until the user opts in.
 *
 * `granted` is the single load-bearing flag the gate reads. `grantedVersion`
 * and `grantedAt` are advisory provenance (which plugin version granted it and
 * when) for future re-consent prompts and disclosure UI; they never weaken the
 * gate — only `granted === true` opens it.
 */
export interface ConsentState {
	/** Whether the user has granted one-time build-execution consent (FR-18). */
	granted: boolean;
	/** Plugin/schema version that recorded the grant (advisory provenance). */
	grantedVersion?: number;
	/** ISO timestamp the grant was recorded (advisory provenance). */
	grantedAt?: string;
}

/** Fresh, safe-by-default consent state: not granted. */
export function defaultConsent(): ConsentState {
	return { granted: false };
}

/**
 * The hard gate (FR-18 / D11): may the plugin transpile + emit the vault
 * component library (and thus execute it at build time)? **Only** an explicit
 * `granted === true` opens it; anything else — absent state, a revoked grant,
 * junk — is closed. Deterministic and total: same input → same answer, never
 * throws. The transpile flow MUST call this and no-op when it returns `false`.
 */
export function shouldTranspileLibrary(consent: ConsentState | undefined): boolean {
	return consent?.granted === true;
}

/**
 * Record a one-time consent grant (FR-18): set `granted` and stamp the advisory
 * provenance. Pure — returns the next state; the adapter persists it. Idempotent
 * in effect (re-granting just refreshes the stamp).
 */
export function grantConsent(version: number, at: string): ConsentState {
	return { granted: true, grantedVersion: version, grantedAt: at };
}

/**
 * Revoke consent (FR-18: revocable). Returns the closed state, dropping the
 * provenance so a later grant re-stamps cleanly. After this, the gate is shut
 * and regeneration must no-op (no new `.astro` emitted); existing
 * `src/generated/` files are not deleted by this decision — cleanup is a
 * separate, explicit action (NFR-9: regeneration only ever writes generated/).
 */
export function revokeConsent(): ConsentState {
	return defaultConsent();
}
