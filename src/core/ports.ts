import type { PageNode, ResolvedTarget, SiteConfig, ViewSnapshot } from './domain/types';
import type { NavConfig, NavigationTree } from './domain/navigation';
import type { RawPageNote } from './domain/pages';
import type { TemplateFile } from './domain/template';
import type { AssetCopyTask, AssetLocation } from './usecases/resolve-assets';
import type { DiscoveredRegistry } from './domain/registry';
import type { LibraryConfig } from './domain/settings-migration';
import type { TranspiledComponent } from './domain/component-transpile';

/** Provides the user's site configuration (managed in the plugin's settings). */
export interface SettingsPort {
	readSiteConfig(): Promise<SiteConfig>;
	/**
	 * The configured standalone-pages folder + component-library folder (FR-12,
	 * FR-11i). `SyncSite` passes these to the pure `buildPageNodes` so designation
	 * (folder membership) and the FR-11i component-library exclusion are decided
	 * over the same folders the page-loader adapter pre-filtered with. Optional so
	 * minimal test wirings (no pages) need not implement it.
	 */
	readPageFolders?(): { pagesFolder: string; libraryFolder: string };
	/**
	 * The curated navigation menu (FR-13; D14). `SyncSite` passes this to the pure
	 * `resolveNavigation` along with the site's known routes, then commits the
	 * resolved tree as the `navigation` snapshot. Optional so minimal test wirings
	 * (no nav) need not implement it — an empty menu is committed instead.
	 */
	readNavConfig?(): NavConfig;
}

/**
 * Provides the vault component-library config — the library **folder** and the
 * persisted, revocable build-execution **consent** (FR-11f, FR-18 / D11). The
 * pure `TranspileLibrary` use-case reads this and **hard-gates** on the consent:
 * when consent is not granted the transpile/emit step is a NO-OP (no `.astro`
 * is ever generated or executed). Persistence lives in the settings adapter.
 */
export interface ComponentLibraryPort {
	/** Snapshot the library folder + persisted consent state. */
	readLibraryConfig(): LibraryConfig;
}

/**
 * Reads the vault component-library notes and writes transpiled `.astro` modules
 * into the project's `src/generated/` tree (FR-11f/g; DESIGN §5.6). The
 * **decision** of what to emit (parse + transpile + skip) is pure
 * (`transpileComponentNote`); this port is the thin I/O seam:
 *
 * - `readLibraryNotes` returns the raw markdown of every note in the configured
 *   library folder (via the Vault API + `cachedRead`), each tagged with its
 *   vault path so a skip can be reported usefully.
 * - `writeGenerated` writes the transpiled files under `src/generated/` ONLY —
 *   it **never deletes** vault content or hand-written `user/` files (NFR-9). It
 *   replaces the generated tier it owns so removed/renamed component notes don't
 *   leave stale modules, but that replacement is scoped to `src/generated/`.
 *
 * `child_process` is NOT used here and NEVER spawns content-derived commands;
 * the only build-time execution is the consented Astro build of the emitted
 * components (the inherent, disclosed risk — DESIGN §5.10).
 */
export interface ComponentLibraryTranspilePort {
	/** Read every component-library note's raw markdown (path + contents). */
	readLibraryNotes(folder: string): Promise<{ path: string; raw: string }[]>;
	/**
	 * Write the transpiled components into `src/generated/` (generated tier only,
	 * NFR-9). Replaces the generated component set so stale modules are cleared.
	 */
	writeGenerated(components: readonly TranspiledComponent[]): Promise<void>;
}

/** Harvests one `(base, view)` target into a serializable snapshot. */
export interface BasesPort {
	harvest(target: ResolvedTarget): Promise<ViewSnapshot>;
}

/**
 * Reads candidate standalone-page notes from the vault (FR-12; DESIGN §5.7).
 *
 * The **decision** of which notes are designated pages, their routes, and the
 * home-page selection is pure (`isDesignatedPage`/`buildPageNodes`); this port
 * is the thin I/O seam that supplies the raw candidate notes the pure folder
 * decides over. The adapter scans markdown notes via the Vault API, reads each
 * note's frontmatter (the metadata cache / `parseYaml`) and its body
 * (`cachedRead` + `toBody`), and returns one {@link RawPageNote} per candidate.
 *
 * It MAY pre-filter to the configured pages folder + frontmatter-flagged notes
 * for efficiency, but designation is ultimately re-decided by the pure core, so
 * supplying a superset is harmless (non-designated notes are dropped there).
 */
export interface PageLoaderPort {
	/** Read the raw candidate page notes (path + frontmatter + optional body). */
	loadPages(): Promise<RawPageNote[]>;
}

/** Persists snapshots into the Astro project's data directory. */
export interface SnapshotWriterPort {
	/**
	 * Atomically replace all persisted snapshots, standalone pages, the resolved
	 * navigation tree, **and** the SEO site sidecar with exactly these in a single
	 * atomic swap (FR-3, FR-12, FR-13, FR-14, FR-23). `pages`, `navigation`, and
	 * `siteUrl` default to empty/absent so callers/tests that only commit
	 * collection snapshots are unaffected; when present, all sets are committed in
	 * the SAME swap as the snapshots, so a failed commit leaves the prior data dir
	 * (snapshots + pages + navigation + site) intact. `siteUrl` is the optional
	 * Astro `site` URL the template build reads to emit `sitemap.xml` +
	 * canonical/OpenGraph; absent leaves it unset (dev/build still succeed).
	 */
	commit(
		snapshots: ViewSnapshot[],
		pages?: PageNode[],
		navigation?: NavigationTree,
		siteUrl?: string,
	): Promise<void>;
}

/**
 * Resolves + copies referenced vault attachments into the Astro project's
 * `public/` tree (FR-16; DESIGN §5.8). The **decision** of what to resolve,
 * rewrite, and copy is pure (`resolveSnapshotAssets`); this port is the thin I/O
 * seam for the two side-effecting halves it cannot do itself:
 *
 * - `locate` reads Obsidian's metadata cache to turn a (possibly wiki) reference
 *   into a concrete vault file (relative to the referencing note), synchronously
 *   — so the pure pipeline can call it inline while rewriting.
 * - `copyAll` executes the resulting copy plan: it copies each referenced vault
 *   file into `public/`, **deduped by content hash** (skip identical bytes
 *   already present) and copying **only** referenced files; a source that has
 *   gone missing since `locate` is skipped with a returned warning, never fatal.
 */
export interface AssetSourcePort {
	/** Resolve a reference (relative to `fromNotePath`) to a vault file, or null. */
	locate(reference: string, fromNotePath: string): AssetLocation | null;
	/**
	 * Copy every task into `public/` (deduped by content hash). Returns non-fatal
	 * warnings for any source that could not be copied (e.g. vanished mid-sync).
	 */
	copyAll(tasks: readonly AssetCopyTask[]): Promise<{ warnings: string[] }>;
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
 * Copies the built site out of the data folder and reveals it in the OS file
 * manager (FR-22 / D6). `astro build` always writes to `dist/` *inside* the
 * data-folder project (NFR-3); this port is the thin I/O seam for the manual
 * **Export/Reveal build** action:
 *
 * - `exportBuild` copies `<projectDir>/dist` into `destDir` (creating it if
 *   needed) and returns the absolute path that now holds the copy. It **copies
 *   into** the destination and never deletes pre-existing content there (NFR-9
 *   — no data loss); a missing `dist/` (never built) is surfaced as an error
 *   the root shows as a Notice. Plain `node:fs` copy — never a `child_process`.
 * - `reveal` opens a path in the OS file manager so the user can grab the
 *   exported files for manual deploy.
 */
export interface BuildExportPort {
	/** Copy `<projectDir>/dist` into `destDir`; returns the absolute copy path. */
	exportBuild(destDir: string): Promise<{ exportedTo: string }>;
	/** Open a path in the OS file manager (best-effort). */
	reveal(absolutePath: string): Promise<void>;
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
 * Discovers the component/layout NAMES available in the scaffolded project
 * (FR-11b; DESIGN §5.6) so the settings UI can populate its assignment dropdowns
 * and the assignment resolver knows the universe of names.
 *
 * The fs scan is the only impure part: the adapter walks each tier's view +
 * layout dirs (`theme/`, `user/`, and the `generated/` seam for C12) for
 * `.astro` files and returns their basenames grouped by tier. The **precedence
 * merge** of those tiers (vault → user → theme, FR-11j) is the pure
 * `resolveRegistry`; this port returns the raw per-tier names so that pure
 * resolution stays testable and the adapter stays a thin directory read.
 */
export interface RegistryPort {
	/** Scan the project's tiers for component/layout names (raw, pre-precedence). */
	discover(): Promise<DiscoveredRegistry>;
}

/**
 * Scaffolds a new **user-owned** component/layout stub `.astro` file into the
 * project's `src/user/` tree (FR-11d; DESIGN §5.6). The decision of where a stub
 * lives and what it contains is small enough to keep with the adapter; the one
 * load-bearing rule is the safety invariant:
 *
 * - **NFR-9 (no data loss):** an existing file is **never** overwritten —
 *   `scaffold` reports `created: false` and leaves the file untouched. Only a
 *   brand-new path is written.
 */
export interface ScaffoldPort {
	/**
	 * Create a user-owned stub for `name` of `kind` ('view' | 'layout'). Returns
	 * the project-relative path written and whether it was newly created (false →
	 * a file of that name already existed and was left intact, NFR-9).
	 */
	scaffold(kind: 'view' | 'layout', name: string): Promise<{ path: string; created: boolean }>;
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
