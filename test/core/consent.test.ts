import { describe, expect, it } from 'vitest';
import {
	defaultConsent,
	grantConsent,
	revokeConsent,
	shouldTranspileLibrary,
	type ConsentState,
} from '../../src/core/domain/consent';

describe('consent gate (FR-18 / D11)', () => {
	it('defaults to NOT granted (safe theme/ path is the default)', () => {
		expect(defaultConsent()).toEqual({ granted: false });
		expect(shouldTranspileLibrary(defaultConsent())).toBe(false);
	});

	it('is closed when consent is absent → transpile is a no-op', () => {
		expect(shouldTranspileLibrary(undefined)).toBe(false);
	});

	it('opens ONLY for an explicit granted === true', () => {
		expect(shouldTranspileLibrary({ granted: true })).toBe(true);
		expect(shouldTranspileLibrary({ granted: false })).toBe(false);
	});

	it('treats junk/partial state as closed (deterministic, never throws)', () => {
		// Hostile/legacy shapes must not be mistaken for a grant.
		expect(shouldTranspileLibrary({} as unknown as ConsentState)).toBe(false);
		expect(shouldTranspileLibrary({ granted: 'yes' } as unknown as ConsentState)).toBe(false);
		expect(shouldTranspileLibrary({ granted: 1 } as unknown as ConsentState)).toBe(false);
		expect(shouldTranspileLibrary(null as unknown as ConsentState)).toBe(false);
	});

	it('grant records the flag plus advisory provenance and opens the gate', () => {
		const state = grantConsent(2, '2026-05-25T00:00:00.000Z');
		expect(state).toEqual({
			granted: true,
			grantedVersion: 2,
			grantedAt: '2026-05-25T00:00:00.000Z',
		});
		expect(shouldTranspileLibrary(state)).toBe(true);
	});

	it('revoke closes the gate again and clears provenance', () => {
		const granted = grantConsent(1, '2026-05-25T00:00:00.000Z');
		expect(shouldTranspileLibrary(granted)).toBe(true);
		const revoked = revokeConsent();
		expect(revoked).toEqual({ granted: false });
		expect(shouldTranspileLibrary(revoked)).toBe(false);
	});

	it('grant → revoke → grant round-trips deterministically', () => {
		const a = grantConsent(1, 't1');
		const b = revokeConsent();
		const c = grantConsent(1, 't2');
		expect(shouldTranspileLibrary(a)).toBe(true);
		expect(shouldTranspileLibrary(b)).toBe(false);
		expect(shouldTranspileLibrary(c)).toBe(true);
		// Provenance refreshes; the load-bearing flag is unchanged.
		expect(c.grantedAt).toBe('t2');
	});
});
