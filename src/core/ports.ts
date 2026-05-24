import type { ResolvedTarget, SiteConfig, ViewSnapshot } from './domain/types';
import type { TemplateFile } from './domain/template';

/** Provides the user's site configuration (managed in the plugin's settings). */
export interface SettingsPort {
	readSiteConfig(): Promise<SiteConfig>;
}

/** Harvests one `(base, view)` target into a serializable snapshot. */
export interface BasesPort {
	harvest(target: ResolvedTarget): Promise<ViewSnapshot>;
}

/** Persists snapshots into the Astro project's data directory. */
export interface SnapshotWriterPort {
	/** Atomically replace all persisted snapshots with exactly this set. */
	commit(snapshots: ViewSnapshot[]): Promise<void>;
}

/** Runs the Astro toolchain (dev server / build) out-of-process. */
export interface AstroProcessPort {
	startDev(): Promise<{ url: string }>;
	build(): Promise<void>;
	stop(): Promise<void>;
}

/** Opens a URL in Obsidian's Web Viewer. */
export interface WebViewerPort {
	open(url: string): Promise<void>;
}

/**
 * Reads whether the core plugins this plugin depends on are enabled (FR-10).
 *
 * The raw plugin-state read lives in the adapter (Obsidian's `internalPlugins`
 * surface); the *decision* of what to require and which message to show is pure
 * core logic (`checkCorePlugins`), so this port stays a thin two-flag read.
 */
export interface CorePluginsPort {
	/** Whether the **Bases** core plugin is enabled. */
	isBasesEnabled(): boolean;
	/** Whether the **Web Viewer** core plugin is enabled. */
	isWebViewerEnabled(): boolean;
}

/**
 * Ensures the bundled Astro project is scaffolded and installed in the plugin
 * data folder before any sync/preview/build (FR-9, FR-17; DESIGN §5.9).
 *
 * The contract is **idempotent**: safe to call before every operation. The
 * pure decision logic (what to scaffold, what to leave alone, whether to
 * install) lives in the `EnsureProject` use-case; this port is the seam the
 * composition root and other use-cases depend on.
 */
export interface ProjectBootstrapPort {
	ensureProject(): Promise<{ projectDir: string }>;
}

/**
 * Low-level, side-effecting primitives the pure `EnsureProject` use-case drives.
 *
 * This is the seam where I/O is confined to an adapter while the *decision* of
 * if/what to scaffold (idempotency, never-overwrite-user-files, when to
 * install) stays pure and unit-testable (DESIGN §5.9 — idempotent & resumable,
 * NFR-9 no-data-loss). The adapter implements these against `node:fs` /
 * `child_process`; the use-case never touches I/O directly.
 */
export interface BootstrapDriverPort {
	/** Absolute path of the scaffolded Astro project (`<pluginDir>/astro`). */
	readonly projectDir: string;
	/** The embedded bundled template files (template-owned + user-owned). */
	templateFiles(): TemplateFile[];
	/** Whether a project-relative file already exists on disk. */
	fileExists(projectRelativePath: string): Promise<boolean>;
	/** Whether project dependencies are already installed (`node_modules/.bin/astro`). */
	dependenciesInstalled(): Promise<boolean>;
	/** Write a file (creating parent dirs), overwriting any existing contents. */
	writeFile(projectRelativePath: string, contents: string): Promise<void>;
	/**
	 * Install dependencies (`npm install --legacy-peer-deps`) in the project,
	 * streaming progress to a visible channel. Rejects (does not swallow) on
	 * failure — e.g. offline — so the caller can surface it (FR-17 / D10).
	 */
	installDependencies(): Promise<void>;
}
