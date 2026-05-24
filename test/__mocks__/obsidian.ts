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
