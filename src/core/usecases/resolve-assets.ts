import {
	AssetResolver,
	decideAssetAvailability,
	isImageReference,
	missingAsset,
	normalizeReference,
} from '../domain/asset-resolver';
import type { AssetRef, CellValue, EntryGroup, EntrySnapshot, ViewSnapshot } from '../domain/types';

/**
 * What the impure side reports about one candidate asset reference once it has
 * been resolved against the vault (metadata cache). Returned by {@link AssetLocator}.
 */
export interface AssetLocation {
	/** The concrete vault-relative path the reference resolves to. */
	vaultPath: string;
	/** The source file size in bytes, when known (drives the size guard). */
	sizeBytes?: number;
}

/**
 * The pure seam the asset pipeline uses to turn a raw reference (relative to the
 * referencing note) into a concrete vault file, or `null` if it cannot be found.
 * The adapter implements this against Obsidian's metadata cache; here it is just
 * an injected function so {@link resolveSnapshotAssets} stays pure and testable.
 */
export type AssetLocator = (reference: string, fromNotePath: string) => AssetLocation | null;

/** One file the copier must place under the project's `public/` tree. */
export interface AssetCopyTask {
	/** Vault-relative source path to copy from. */
	source: string;
	/** Public URL (leading slash) the copy lands at, e.g. `/assets/cover.png`. */
	url: string;
}

/** The result of running the (pure) asset pipeline over a snapshot set. */
export interface ResolveAssetsResult {
	/** The snapshots with image values rewritten + `assets`/`imageProperties` set. */
	snapshots: ViewSnapshot[];
	/** The deduped copy plan (only referenced, locatable sources). */
	copyPlan: AssetCopyTask[];
	/** Non-fatal warnings (missing/oversized assets degraded to placeholders). */
	warnings: string[];
}

/** Tuning for the asset pipeline. */
export interface ResolveAssetsOptions {
	/** Max source size to copy; larger ones degrade to a placeholder. Optional. */
	maxSizeBytes?: number;
}

/**
 * Pure asset pipeline (FR-16; DESIGN §5.8). Given the harvested snapshots and a
 * locator (the metadata-cache seam), it:
 *
 * 1. scans every entry value in display order for image references
 *    ({@link isImageReference} — MVP: card covers / image-typed values, D7),
 * 2. locates each via the injected {@link AssetLocator},
 * 3. asks {@link decideAssetAvailability} whether to copy it or degrade it to a
 *    placeholder (missing/oversized → warning, never fatal),
 * 4. **rewrites** the value to the resolved public URL (or the placeholder),
 * 5. records the per-snapshot `assets` manifest + which property ids are images,
 *    and accumulates a single deduped copy plan across all snapshots.
 *
 * It does **no I/O**: the locator reads the cache (sync) and the returned copy
 * plan is executed by the adapter afterwards. One {@link AssetResolver} is shared
 * across all snapshots so the public URL space is globally consistent (same
 * source → same URL everywhere; basename collisions disambiguated).
 */
export function resolveSnapshotAssets(
	snapshots: readonly ViewSnapshot[],
	locate: AssetLocator,
	options: ResolveAssetsOptions = {},
): ResolveAssetsResult {
	const resolver = new AssetResolver();
	const copyPlan: AssetCopyTask[] = [];
	const copyPlanned = new Set<string>();
	const warnings: string[] = [];

	const out = snapshots.map((snapshot) =>
		rewriteSnapshot(snapshot, {
			resolver,
			locate,
			options,
			copyPlan,
			copyPlanned,
			warnings,
		}),
	);

	return { snapshots: out, copyPlan, warnings };
}

/** Shared mutable accumulators threaded through the per-snapshot rewrite. */
interface PipelineContext {
	resolver: AssetResolver;
	locate: AssetLocator;
	options: ResolveAssetsOptions;
	copyPlan: AssetCopyTask[];
	copyPlanned: Set<string>;
	warnings: string[];
}

/** Rewrite one snapshot's image values; collect its asset manifest + image props. */
function rewriteSnapshot(snapshot: ViewSnapshot, ctx: PipelineContext): ViewSnapshot {
	const imageProperties = new Set<string>();
	const assets: AssetRef[] = [];
	const assetSeen = new Set<string>();

	const groups: EntryGroup[] = snapshot.groups.map((group) => ({
		key: group.key,
		entries: group.entries.map((entry) =>
			rewriteEntry(entry, snapshot.view.order, ctx, { imageProperties, assets, assetSeen }),
		),
	}));

	const view: ViewSnapshot['view'] = {
		...snapshot.view,
		...(imageProperties.size > 0 ? { imageProperties: [...imageProperties] } : {}),
	};

	return {
		...snapshot,
		view,
		groups,
		...(assets.length > 0 ? { assets } : {}),
	};
}

/** Per-snapshot collectors for the manifest + image property ids. */
interface SnapshotCollectors {
	imageProperties: Set<string>;
	assets: AssetRef[];
	assetSeen: Set<string>;
}

/** Rewrite one entry's image-typed values to public URLs (or placeholders). */
function rewriteEntry(
	entry: EntrySnapshot,
	order: readonly string[],
	ctx: PipelineContext,
	collect: SnapshotCollectors,
): EntrySnapshot {
	const values: Record<string, CellValue> = { ...entry.values };

	for (const propertyId of order) {
		const raw = values[propertyId];
		if (!isImageReference(raw)) {
			continue;
		}
		// `isImageReference` already guaranteed a non-empty string. Every image
		// reference yields a URL (the resolved public URL, or a placeholder when
		// it degraded), so the property is always flagged for `<img>` rendering.
		collect.imageProperties.add(propertyId);
		values[propertyId] = resolveOne(raw as string, entry.path, ctx, collect);
	}

	return { ...entry, values };
}

/**
 * Resolve a single image reference to the public URL to store in the value.
 * Locates the source **first** (so dedup keys on the concrete vault file — two
 * different references to the same attachment share a URL), then decides
 * copy-vs-degrade, queuing the copy task + manifest entry on success and
 * recording a warning on degrade. Always returns a URL: the resolved public URL
 * when the asset is copied, or the placeholder URL when it degrades (FR-16).
 */
function resolveOne(
	raw: string,
	fromNotePath: string,
	ctx: PipelineContext,
	collect: SnapshotCollectors,
): string {
	const location = ctx.locate(raw, fromNotePath);

	// Resolve the public URL from the CONCRETE vault path (when located) so two
	// references to the same attachment map to one URL + one copy. A reference
	// that is not located — or whose located path does not normalize to an asset
	// — has no copyable source and is treated as missing.
	const resolved = location !== null ? ctx.resolver.resolve(location.vaultPath) : null;

	// Missing (not located / not copyable) → placeholder + warning, never fatal.
	if (resolved === null) {
		const missing = missingAsset(normalizeReference(raw) ?? raw);
		ctx.warnings.push(missing.warning);
		return missing.placeholderUrl;
	}

	// Located but over the size cap → placeholder + warning, never copied.
	const oversized = decideAssetAvailability({
		sourcePath: resolved.sourcePath,
		exists: true,
		...(location?.sizeBytes !== undefined ? { sizeBytes: location.sizeBytes } : {}),
		...(ctx.options.maxSizeBytes !== undefined
			? { maxSizeBytes: ctx.options.maxSizeBytes }
			: {}),
	});
	if (oversized !== null) {
		ctx.warnings.push(oversized.warning);
		return oversized.placeholderUrl;
	}

	// Locatable + within size: queue the copy (deduped globally + per snapshot).
	if (!ctx.copyPlanned.has(resolved.url)) {
		ctx.copyPlanned.add(resolved.url);
		ctx.copyPlan.push({ source: resolved.sourcePath, url: resolved.url });
	}
	if (!collect.assetSeen.has(resolved.url)) {
		collect.assetSeen.add(resolved.url);
		collect.assets.push({ source: resolved.sourcePath, url: resolved.url });
	}
	return resolved.url;
}
