/**
 * Pure, versioned settings model + forward migration (NFR-8, D4/D19).
 *
 * Settings first expand beyond the site config in C4 (the dev-server port and a
 * Node/binary-path override land here), so this is where the persisted shape
 * gains a **schema version** and a **forward-migration path**. `migrate()`
 * upgrades any older or unversioned persisted blob — including the original
 * un-versioned `{ site }` shape and outright junk — into the current versioned
 * schema, defaulting every new field. It is the single source of truth for "how
 * old settings become current settings," kept pure so the adapter stays a thin
 * load/save shell.
 *
 * Pure: arbitrary value in → `VersionedSettings` out. No I/O, no `obsidian`, no
 * Node.
 */

import { defaultConsent, type ConsentState } from './consent';
import type { PublishTarget, SiteConfig } from './types';

/** The current settings schema version. Bump on any breaking shape change. */
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * Default vault folder for the code-fence component library (FR-11f / FR-8 /
 * D19): each component is a frontmatter markdown note here, transpiled into
 * `src/generated/` behind consent. Configurable in settings; this is the
 * out-of-the-box `Site/components` authoring layout.
 */
export const DEFAULT_LIBRARY_FOLDER = 'Site/components';

/** Obsidian's default dev-server port (D19); auto-fallback happens at runtime. */
export const DEFAULT_DEV_PORT = 4321;

/**
 * Default for the live re-sync toggle (FR-20 / D2). **Off** by default: live
 * re-sync transiently re-mounts the previewed base to re-harvest, which briefly
 * flashes a leaf, so it stays opt-in. Manual "Sync site" and auto-sync on first
 * preview always run regardless of this flag.
 */
export const DEFAULT_LIVE_RESYNC = false;

/**
 * Toolchain/dev-server settings (FR-8): the port Astro is asked to use plus
 * optional absolute overrides for the Node and Astro binaries, used to dodge the
 * macOS GUI `PATH` gap and to point at a non-default install (DESIGN §5.3 /
 * NFR-4).
 */
export interface ToolchainConfig {
	/** Port passed to `astro dev` (Astro auto-falls-back if busy). */
	port: number;
	/** Absolute path to the Node binary, when not resolvable on PATH. */
	nodePath?: string;
	/** Absolute path to the Astro binary, overriding `node_modules/.bin` resolution. */
	astroBinPath?: string;
}

/**
 * Sync-trigger settings (FR-20 / D2): which automatic re-sync behaviors are on.
 * Manual "Sync site" and auto-sync-on-first-preview are unconditional; only the
 * debounced live re-sync of the previewed base is toggleable here.
 */
export interface SyncConfig {
	/** Whether to live-re-sync the actively-previewed base on data changes. */
	liveResync: boolean;
}

/**
 * Build/export settings (FR-8, FR-22 / D6). `astro build` always writes to
 * `dist/` *inside* the data-folder project (NFR-3); this only configures the
 * **Export/Reveal build** action, which copies that `dist/` into a user-chosen
 * location for manual deploy. Optional: empty means "no export destination set"
 * (Export errors with a clear message until the user picks one).
 */
export interface ExportConfig {
	/** Absolute destination directory the built `dist/` is copied into. */
	exportPath?: string;
}

/**
 * Vault component-library settings (FR-11f/g, FR-18 / D11). Holds the
 * configurable library folder (where component notes live) and the persisted,
 * revocable build-execution **consent** that hard-gates transpiling those notes
 * into executable `src/generated/` modules. Consent defaults to NOT granted —
 * the safe `theme/` components are the default path; code-fence components do
 * nothing until the user opts in (and can revoke).
 */
export interface LibraryConfig {
	/** Vault folder the component notes live in (default `Site/components`). */
	folder: string;
	/** Persisted, revocable one-time build-execution consent (FR-18). */
	consent: ConsentState;
}

/** The whole persisted settings document, carrying its schema version. */
export interface VersionedSettings {
	/** Schema version of this persisted document (forward-migration anchor). */
	version: number;
	/** The user-curated publish list + site URL. */
	site: SiteConfig;
	/** Dev-server / toolchain configuration. */
	toolchain: ToolchainConfig;
	/** Sync-trigger configuration (live re-sync toggle). */
	sync: SyncConfig;
	/** Build/export configuration (the Export/Reveal destination). */
	export: ExportConfig;
	/** Vault component-library folder + build-execution consent (FR-11f, FR-18). */
	library: LibraryConfig;
}

/** Fresh defaults for a vault that has never persisted settings. */
export function defaultSettings(): VersionedSettings {
	return {
		version: SETTINGS_SCHEMA_VERSION,
		site: { includes: [] },
		toolchain: { port: DEFAULT_DEV_PORT },
		sync: { liveResync: DEFAULT_LIVE_RESYNC },
		export: {},
		library: { folder: DEFAULT_LIBRARY_FOLDER, consent: defaultConsent() },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isPublishTarget(value: unknown): value is PublishTarget {
	return (
		isRecord(value) && typeof value.basePath === 'string' && typeof value.viewName === 'string'
	);
}

/** Keep only the optional override/route fields when they are non-empty strings. */
function parsePublishTarget(value: PublishTarget): PublishTarget {
	const target: PublishTarget = { basePath: value.basePath, viewName: value.viewName };
	if (typeof value.route === 'string' && value.route !== '') target.route = value.route;
	if (typeof value.component === 'string' && value.component !== '') {
		target.component = value.component;
	}
	if (typeof value.layout === 'string' && value.layout !== '') target.layout = value.layout;
	return target;
}

/** Tolerantly parse persisted (possibly stale or hand-edited) `site` config. */
function parseSiteConfig(raw: unknown): SiteConfig {
	if (!isRecord(raw)) {
		return { includes: [] };
	}
	const siteUrl = typeof raw.siteUrl === 'string' ? raw.siteUrl : undefined;
	const includes = Array.isArray(raw.includes)
		? raw.includes.filter(isPublishTarget).map(parsePublishTarget)
		: [];
	return siteUrl === undefined ? { includes } : { includes, siteUrl };
}

/** Tolerantly parse toolchain config, defaulting the port and dropping junk. */
function parseToolchain(raw: unknown): ToolchainConfig {
	if (!isRecord(raw)) {
		return { port: DEFAULT_DEV_PORT };
	}
	const port =
		typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0
			? raw.port
			: DEFAULT_DEV_PORT;
	const toolchain: ToolchainConfig = { port };
	if (typeof raw.nodePath === 'string' && raw.nodePath.trim() !== '') {
		toolchain.nodePath = raw.nodePath.trim();
	}
	if (typeof raw.astroBinPath === 'string' && raw.astroBinPath.trim() !== '') {
		toolchain.astroBinPath = raw.astroBinPath.trim();
	}
	return toolchain;
}

/** Tolerantly parse sync config, defaulting the live-resync flag when absent. */
function parseSync(raw: unknown): SyncConfig {
	if (!isRecord(raw) || typeof raw.liveResync !== 'boolean') {
		return { liveResync: DEFAULT_LIVE_RESYNC };
	}
	return { liveResync: raw.liveResync };
}

/** Tolerantly parse export config, keeping the path only when a non-empty string. */
function parseExport(raw: unknown): ExportConfig {
	if (!isRecord(raw) || typeof raw.exportPath !== 'string' || raw.exportPath.trim() === '') {
		return {};
	}
	return { exportPath: raw.exportPath.trim() };
}

/**
 * Tolerantly parse the persisted consent state (FR-18 / D11). The gate is
 * **fail-closed**: only an explicit `granted === true` boolean opens it; any
 * other shape (absent, junk, a truthy non-boolean) is treated as NOT granted, so
 * a corrupted/hostile blob can never silently authorize build-time execution.
 * Advisory provenance (`grantedVersion`/`grantedAt`) is preserved only when
 * sensibly typed.
 */
function parseConsent(raw: unknown): ConsentState {
	if (!isRecord(raw) || raw.granted !== true) {
		return defaultConsent();
	}
	const consent: ConsentState = { granted: true };
	if (typeof raw.grantedVersion === 'number' && Number.isFinite(raw.grantedVersion)) {
		consent.grantedVersion = raw.grantedVersion;
	}
	if (typeof raw.grantedAt === 'string' && raw.grantedAt.trim() !== '') {
		consent.grantedAt = raw.grantedAt;
	}
	return consent;
}

/**
 * Tolerantly parse the component-library config (FR-11f, FR-18): the library
 * folder defaults to {@link DEFAULT_LIBRARY_FOLDER} when absent/blank, and the
 * consent sub-shape is fail-closed via {@link parseConsent}. Migration-safe: old
 * data lacking `library` gets the safe default (folder set, consent NOT granted).
 */
function parseLibrary(raw: unknown): LibraryConfig {
	const folder =
		isRecord(raw) && typeof raw.folder === 'string' && raw.folder.trim() !== ''
			? raw.folder.trim()
			: DEFAULT_LIBRARY_FOLDER;
	return { folder, consent: parseConsent(isRecord(raw) ? raw.consent : undefined) };
}

/**
 * Upgrade any persisted settings blob to the current versioned schema.
 *
 * Handles three input classes:
 * - **junk / nothing** (`null`, a string, a number) → fresh {@link defaultSettings}.
 * - **the original un-versioned `{ site }` shape** → wrapped with `version` and a
 *   defaulted `toolchain`/`sync`.
 * - **a current versioned document** → re-parsed defensively (idempotent).
 *
 * New optional fields (e.g. `sync.liveResync`, `export.exportPath`, and the
 * `library` block with its **fail-closed** consent, all added after v1) are
 * *defaulted* for old persisted data by the tolerant per-field parsers below —
 * so no schema bump is needed since no existing data is
 * transformed, only filled in.
 *
 * Always returns a fully-populated, valid {@link VersionedSettings}; never throws.
 */
export function migrate(persisted: unknown): VersionedSettings {
	if (!isRecord(persisted)) {
		return defaultSettings();
	}

	// Both unversioned (`version` absent) and versioned blobs flow through the
	// same tolerant parse; new fields default. As the schema grows, branch on
	// `persisted.version` here to chain version-specific upgrades.
	return {
		version: SETTINGS_SCHEMA_VERSION,
		site: parseSiteConfig(persisted.site),
		toolchain: parseToolchain(persisted.toolchain),
		sync: parseSync(persisted.sync),
		export: parseExport(persisted.export),
		library: parseLibrary(persisted.library),
	};
}
