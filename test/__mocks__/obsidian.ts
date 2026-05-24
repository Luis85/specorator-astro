/**
 * Minimal stand-in for the `obsidian` module (provided by the app at runtime,
 * not installed for tests). Aliased in vitest.config.ts. Extend as adapter
 * tests need more surface.
 */

export class Plugin {}

export class Notice {
	constructor(_message: string) {}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// Synchronous stand-in so unit tests can drive debounced callbacks deterministically.
export function debounce<T extends unknown[]>(cb: (...args: T) => unknown) {
	const fn = (...args: T): void => {
		cb(...args);
	};
	fn.cancel = () => fn;
	fn.run = () => undefined;
	return fn;
}
