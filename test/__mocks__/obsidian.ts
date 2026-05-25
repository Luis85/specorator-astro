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

/** Minimal `TFolder` stand-in (only `instanceof` is used by adapter code). */
export class TFolder {
	path = '';
}

/** Stand-in for `FileSystemAdapter` (only `instanceof` + `getBasePath` are used). */
export class FileSystemAdapter {
	getBasePath(): string {
		return '/vault';
	}
}

/**
 * Minimal YAML parser stand-in for the page loader's frontmatter fallback. Only
 * handles the flat `key: value` shape the adapter test exercises; real parsing
 * is Obsidian's at runtime. Recognizes booleans, numbers, and bare strings.
 */
export function parseYaml(input: string): unknown {
	const out: Record<string, unknown> = {};
	for (const line of input.split(/\r?\n/)) {
		const match = /^([\w.-]+):\s*(.*)$/.exec(line.trim());
		if (match === null) continue;
		const [, key, rawValue] = match;
		const value = rawValue.trim();
		if (value === 'true') out[key] = true;
		else if (value === 'false') out[key] = false;
		else if (value !== '' && !Number.isNaN(Number(value))) out[key] = Number(value);
		else out[key] = value.replace(/^["']|["']$/g, '');
	}
	return out;
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
