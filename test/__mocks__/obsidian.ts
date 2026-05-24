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

/**
 * Minimal `TFile` stand-in: adapter code only reads `path` and `stat.size`, and
 * uses `instanceof TFile` to distinguish files from folders. Tests construct
 * these directly to fake metadata-cache lookups.
 */
export class TFile {
	path = '';
	stat: { size: number } = { size: 0 };
}

/** Stand-in for `FileSystemAdapter` (only `instanceof` + `getBasePath` are used). */
export class FileSystemAdapter {
	getBasePath(): string {
		return '/vault';
	}
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
