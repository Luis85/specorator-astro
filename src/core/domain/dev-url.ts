/**
 * Pure parser for the dev-server URL Astro/Vite prints to stdout.
 *
 * When the Astro process manager (DESIGN §5.3) runs the project-local binary as
 * a child process, the **authoritative** dev URL is the one Astro itself prints
 * (`Local:  http://localhost:4321/`), not a port we guessed — Astro may fall
 * back to another port if the configured one is busy. This module turns a chunk
 * of raw stdout into that URL (or `null` until it has been printed).
 *
 * Pure: string in → string|null out. No I/O, no `obsidian`, no Node.
 */

/** Strip ANSI SGR color/escape sequences Astro/Vite emit when stdout is a TTY. */
function stripAnsi(text: string): string {
	// Matches CSI sequences like `[39m` used for coloured CLI output.
	// eslint-disable-next-line no-control-regex
	return text.replace(/\[[0-9;]*m/g, '');
}

/**
 * Extract the local dev-server URL from a chunk of Astro/Vite stdout.
 *
 * Recognizes the `Local:` line Astro prints on startup and tolerates ANSI
 * colour codes, leading/trailing whitespace, and surrounding log noise. Falls
 * back to the first bare `http://localhost:<port>` (or `127.0.0.1`) URL when no
 * labelled line is present. The returned URL is normalized to a single trailing
 * slash. Returns `null` when stdout has not yet announced a URL.
 */
export function parseDevServerUrl(stdout: string): string | null {
	const clean = stripAnsi(stdout);

	// Prefer the explicitly-labelled `Local:` line (Astro's authoritative line).
	const labelled = /(?:Local|localhost)\s*[:\s]\s*(https?:\/\/[^\s/]+(?:\/\S*)?)/i.exec(clean);
	const match = labelled ?? /(https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?\S*)/i.exec(clean);
	if (!match) {
		return null;
	}

	return normalizeUrl(match[1]);
}

/** Collapse a parsed URL to its origin + path with exactly one trailing slash. */
function normalizeUrl(raw: string): string {
	// Drop any trailing punctuation the CLI may append (e.g. a period or comma).
	const trimmed = raw.replace(/[.,;]+$/, '');
	// Normalize the path portion to a single trailing slash.
	const withoutTrailing = trimmed.replace(/\/+$/, '');
	return `${withoutTrailing}/`;
}
