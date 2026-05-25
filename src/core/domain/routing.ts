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

/** Ensure a single leading slash and no trailing slash (except root). */
function normalizeRoute(route: string): string {
	const trimmed = route.trim().replace(/^\/+|\/+$/g, '');
	return trimmed === '' ? '/' : `/${trimmed}`;
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
		return normalizeRoute(target.route);
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
