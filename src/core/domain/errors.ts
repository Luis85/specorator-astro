/**
 * Domain errors that carry a **user-facing** message the composition root can
 * surface verbatim as an Obsidian `Notice`.
 *
 * Use-cases throw these when a precondition fails for a reason the user can act
 * on (e.g. a disabled core plugin, FR-10). `main.ts` checks `instanceof` and
 * shows `.message` directly, instead of the generic "see console" fallback.
 *
 * Pure: no I/O, no `obsidian`, no Node.
 */

/**
 * A precondition the user can fix blocked the operation. `message` is already
 * phrased for display (it includes the "Specorator:" prefix and what to do).
 */
export class UserFacingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UserFacingError';
	}
}
