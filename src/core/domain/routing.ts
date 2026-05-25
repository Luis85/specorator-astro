import type { PublishTarget, ResolvedTarget, SiteConfig, SyncPlan } from './types';

/** Convert an arbitrary label into a URL-safe slug. */
export function slugify(input: string): string {
	return input
		.toLowerCase()
		.replace(/\.(base|md)$/i, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Take the file basename (no folders, no extension) from a vault path. */
function baseName(path: string): string {
	const segments = path.split('/');
	const last = segments[segments.length - 1];
	return last.replace(/\.[^.]+$/, '');
}

/**
 * URL-safe slug for a single route segment (an entry basename / slug fallback).
 * Unlike {@link slugify} it never collapses to empty — a basename that slugifies
 * away (e.g. `!!!`) falls back to `entry` so a detail route always has a segment.
 */
export function slugifySegment(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'entry'
	);
}

/**
 * Ensure a single leading slash, no trailing slash (except root), and no
 * interior `//` runs. This is the **one** route normalizer for the whole domain
 * (route table, pages, navigation): they all share it so a route placed in the
 * namespace and a nav/wikilink reference to it compare equal (FR-15). Keeping it
 * in one place stops the three call sites from drifting (e.g. one collapsing
 * `a//b` → `a/b` while another doesn't, so a nav item silently fails to match).
 */
export function normalizeRoute(route: string): string {
	const trimmed = route
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? '/' : `/${trimmed}`;
}

/**
 * Normalize **and** slugify an explicit route (a note's `slug`/`permalink`, or a
 * target's explicit `route`): split into path segments, run each through
 * {@link slugifySegment}, and rejoin with single slashes (leading slash kept).
 *
 * An explicit slug is otherwise emitted verbatim, so a value like `foo)bar baz`
 * or `Über/Café#x` would leak `)`/space/`#`/unicode into markdown links (closing
 * a `[…](…)` early or breaking the URL) and into Astro `getStaticPaths` params.
 * Slugifying per segment makes every placed route URL-safe, exactly like a
 * basename-derived route (FR-15). Empty segments (from interior `//`) are dropped.
 */
export function slugifyRoute(route: string): string {
	const normalized = normalizeRoute(route);
	if (normalized === '/') {
		return '/';
	}
	const segments = normalized
		.split('/')
		.filter((seg) => seg !== '')
		.map((seg) => slugifySegment(seg))
		.filter((seg) => seg !== '');
	return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/** Join a parent route with a child segment, keeping a single leading slash. */
export function joinRoute(route: string, segment: string): string {
	const base = route.replace(/\/+$/g, '');
	return base === '' || base === '/' ? `/${segment}` : `${base}/${segment}`;
}

/**
 * Derive a route for a target. The first published view of a base owns the base
 * slug (`/books`); additional views of the same base are nested under it
 * (`/books/table`). An explicit `route` always wins.
 */
export function deriveRoute(target: PublishTarget, isPrimaryForBase: boolean): string {
	if (target.route && target.route.trim() !== '') {
		// An explicit user-supplied route is slugified per segment so non-URL-safe
		// characters never reach the `[...slug]` namespace or a wikilink (FR-15).
		return slugifyRoute(target.route);
	}
	const base = slugify(baseName(target.basePath));
	if (isPrimaryForBase) {
		return normalizeRoute(base);
	}
	return normalizeRoute(`${base}/${slugify(target.viewName)}`);
}

/**
 * Resolve every include into a concrete route + component/layout, detecting
 * duplicate routes. Pure: all route rules and collision handling live here.
 */
export function planSync(config: SiteConfig): SyncPlan {
	const warnings: string[] = [];
	const targets: ResolvedTarget[] = [];
	const seenRoutes = new Map<string, ResolvedTarget>();
	const seenBases = new Set<string>();

	if (config.includes.length === 0) {
		warnings.push('Site config has no published bases; the site will be empty.');
	}

	for (const include of config.includes) {
		const isPrimaryForBase = !seenBases.has(include.basePath);
		seenBases.add(include.basePath);

		const route = deriveRoute(include, isPrimaryForBase);
		const existing = seenRoutes.get(route);
		if (existing) {
			warnings.push(
				`Route "${route}" is used by both ${existing.basePath} (${existing.viewName}) ` +
					`and ${include.basePath} (${include.viewName}); the latter was skipped.`,
			);
			continue;
		}

		const resolved: ResolvedTarget = {
			basePath: include.basePath,
			viewName: include.viewName,
			route,
			component: include.component ?? 'auto',
			layout: include.layout ?? 'auto',
		};
		seenRoutes.set(route, resolved);
		targets.push(resolved);
	}

	return { targets, warnings };
}
