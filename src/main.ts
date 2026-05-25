import {
	type Editor,
	FileSystemAdapter,
	type Menu,
	Notice,
	Plugin,
	TFile,
	TFolder,
	normalizePath,
	parseYaml,
} from 'obsidian';
import type { AstroProcessPort, BuildExportPort } from './core/ports';
import type { CellValue, PublishTarget } from './core/domain/types';
import { LiveResyncTrigger } from './core/domain/live-resync';
import { UserFacingError } from './core/domain/errors';
import { BuildSite } from './core/usecases/build-site';
import { EnsureProject } from './core/usecases/ensure-project';
import { PreviewSite } from './core/usecases/preview-site';
import { SyncSite } from './core/usecases/sync-site';
import { TranspileLibrary } from './core/usecases/transpile-library';
import {
	astroFenceSnippet,
	buildComponentNote,
	type ComponentNoteStub,
} from './core/domain/component-note-stub';
import {
	appendPublishTarget,
	listViewNames,
	type ParsedBaseFile,
} from './core/domain/harvest-mapping';
import { isComponentLibraryNote } from './core/domain/component-transpile';
import { addNavItem } from './core/domain/navigation';
import { derivePageRoute, isDesignatedPage, isHomeDesignation } from './core/domain/pages';
import { slugifySegment } from './core/domain/routing';
import { AssetSourceAdapter } from './adapters/asset-source-adapter';
import { AstroProcessAdapter } from './adapters/astro-process-adapter';
import { BasesHarvesterAdapter } from './adapters/bases-harvester-adapter';
import { BuildExportAdapter } from './adapters/build-export-adapter';
import { ComponentLibraryAdapter } from './adapters/component-library-adapter';
import { ComponentNoteModal, type ComponentNoteRequest } from './adapters/component-note-modal';
import { ConsentModal } from './adapters/consent-modal';
import { CorePluginsAdapter } from './adapters/core-plugins-adapter';
import { FsSnapshotWriter } from './adapters/fs-snapshot-writer';
import { PageLoaderAdapter } from './adapters/page-loader-adapter';
import { ProjectBootstrapAdapter } from './adapters/project-bootstrap-adapter';
import { RegistryAdapter } from './adapters/registry-adapter';
import { ScaffoldAdapter } from './adapters/scaffold-adapter';
import { AddToSiteModal } from './adapters/add-to-site-modal';
import { ScaffoldModal } from './adapters/scaffold-modal';
import { SettingsStore } from './adapters/settings-store';
import { SiteSettingTab } from './adapters/settings-tab';
import { WebViewerAdapter } from './adapters/web-viewer-adapter';

/** How often the live-resync timer wakes to check the debounce window (ms). */
const RESYNC_TICK_MS = 500;

/**
 * Composition root. Wires adapters (Obsidian/Node) into the pure core use-cases,
 * registers commands, and surfaces use-case results to the user. No domain
 * logic lives here — orchestration (auto-sync on first preview), the
 * trigger/debounce decision (`LiveResyncTrigger`), and the disabled-plugin
 * decision (`checkCorePlugins`) all live in core; this file only feeds them
 * Obsidian events and shows their results as `Notice`s.
 */
export default class SpecoratorAstroViewerPlugin extends Plugin {
	private astro: AstroProcessPort | null = null;

	override async onload(): Promise<void> {
		// `manifest.dir` is the plugin's vault-relative install dir; it is always
		// present for an installed plugin. Assert it so a malformed manifest fails
		// loudly here rather than silently rooting the project at `/astro` (FIX 5).
		const manifestDir = this.manifest.dir;
		if (manifestDir === undefined || manifestDir === '') {
			throw new Error('Specorator: plugin manifest has no install directory.');
		}
		// Normalize so the derived project/data paths use canonical separators (OBS-3).
		const projectDir = normalizePath(`${manifestDir}/astro`);
		const settings = new SettingsStore(this);
		await settings.load();

		// Registry discovery (FR-11b) + scaffold (FR-11d) seams. The settings tab
		// reads discovered names to populate the per-view component/layout dropdowns;
		// the scaffold command writes user-owned stubs (never overwriting, NFR-9).
		const registry = new RegistryAdapter(projectDir);
		const scaffold = new ScaffoldAdapter(projectDir);
		this.addSettingTab(new SiteSettingTab(this.app, this, settings, registry));

		const bases = new BasesHarvesterAdapter(this.app, this);
		const writer = new FsSnapshotWriter(projectDir);
		const webViewer = new WebViewerAdapter(this.app);
		const corePlugins = new CorePluginsAdapter(this.app);
		// Resolve the toolchain config lazily so port/binary edits in the settings
		// tab are honored on the next dev/build without re-wiring. stdout/stderr
		// stream to the console for now (C4 will surface a visible panel).
		const astro = new AstroProcessAdapter(projectDir, () => settings.readToolchainConfig(), {
			write: (line) => {
				console.warn(`[specorator] ${line.replace(/\n$/, '')}`);
			},
		});
		this.astro = astro;

		// Bootstrap: the pure EnsureProject use-case drives the I/O adapter so the
		// scaffold/install decision stays testable. Install progress streams to an
		// output channel (C4 adds a visible panel); install/offline failures reject
		// and surface via the command catch blocks below (FR-17 / D10).
		const bootstrapDriver = new ProjectBootstrapAdapter(projectDir);
		const bootstrap = new EnsureProject(bootstrapDriver);

		// Asset pipeline (FR-16): resolve referenced attachments via the metadata
		// cache and copy them into the project's `public/`. Desktop-only, so the
		// vault always has a `FileSystemAdapter` with an absolute base path; if it
		// somehow isn't one, skip the asset step (sync still works without covers).
		const fsAdapter = this.app.vault.adapter;
		const vaultBasePath =
			fsAdapter instanceof FileSystemAdapter ? fsAdapter.getBasePath() : undefined;
		const assets =
			vaultBasePath !== undefined
				? new AssetSourceAdapter(this.app, projectDir, vaultBasePath)
				: undefined;

		// Standalone pages (FR-12; DESIGN §5.7): the page loader supplies candidate
		// designated notes (pages folder + frontmatter-flagged), which the pure
		// `buildPageNodes` folds into PageNodes the sync commits alongside views.
		const pageLoader = new PageLoaderAdapter(
			this.app,
			() => settings.readPagesConfig().folder,
			() => settings.readLibraryConfig().folder,
		);

		const sync = new SyncSite(settings, bases, writer, corePlugins, assets, pageLoader);
		const preview = new PreviewSite(bootstrap, corePlugins, sync, astro, webViewer);

		// Vault component library (FR-11f/g, FR-18 / D11): transpile code-fence
		// component notes into src/generated/ — but ONLY behind the one-time
		// build-execution consent gate (the use-case no-ops when consent is absent;
		// the gate is pure core). Wired to run before sync/build so generated
		// components are present when Astro renders.
		const library = new ComponentLibraryAdapter(this.app, projectDir);
		const transpile = new TranspileLibrary(settings, library);

		// Build/export (FR-6, FR-22 / D6): BuildSite auto-syncs then runs `astro
		// build` to `dist/`; the export adapter copies that `dist/` to the chosen
		// location and reveals it. Desktop-only, so `vaultBasePath` is present; if
		// it somehow isn't a FileSystemAdapter, export is unavailable.
		const build = new BuildSite(bootstrap, corePlugins, sync, astro);
		const exporter =
			vaultBasePath !== undefined
				? new BuildExportAdapter(projectDir, vaultBasePath)
				: undefined;

		this.addCommand({
			id: 'sync-site',
			name: 'Sync site',
			callback: async () => {
				try {
					await bootstrap.ensureProject();
					// Transpile the consented component library before harvest so the
					// site renders with the user's components (gated; no-op otherwise).
					await this.transpileLibrary(transpile);
					const result = await sync.run();
					for (const warning of result.warnings) {
						console.warn(`[specorator] ${warning}`);
					}
					new Notice(`Specorator: synced ${String(result.written)} view(s).`);
				} catch (error) {
					this.notifyFailure('sync', error);
				}
			},
		});

		this.addCommand({
			id: 'preview-site',
			name: 'Preview site',
			callback: async () => {
				try {
					// Ensure the project + transpile the consented library before the
					// preview flow auto-syncs, so the preview reflects user components.
					await bootstrap.ensureProject();
					await this.transpileLibrary(transpile);
					await preview.run();
				} catch (error) {
					this.notifyFailure('preview', error);
				}
			},
		});

		this.addCommand({
			id: 'build-site',
			name: 'Build site',
			callback: async () => {
				try {
					await bootstrap.ensureProject();
					await this.transpileLibrary(transpile);
					const result = await build.run();
					for (const warning of result.warnings) {
						console.warn(`[specorator] ${warning}`);
					}
					new Notice(
						`Specorator: built site to dist/ (${String(result.written)} view(s)).`,
					);
				} catch (error) {
					this.notifyFailure('build', error);
				}
			},
		});

		this.addCommand({
			id: 'export-build',
			name: 'Export/reveal build',
			callback: async () => {
				await this.exportBuild(settings, exporter);
			},
		});

		// Scaffold a user-owned component/layout stub (FR-11d). Ensures the project
		// exists first (so `src/user/` is present), then writes a stub — never
		// overwriting (NFR-9, enforced in the adapter). The modal is pure UI.
		this.addCommand({
			id: 'scaffold-component',
			name: 'Scaffold component/layout',
			callback: () => {
				new ScaffoldModal(this.app, (request) => {
					void (async () => {
						try {
							await bootstrap.ensureProject();
							const result = await scaffold.scaffold(request.kind, request.name);
							new Notice(
								result.created
									? `Specorator: created ${result.path}. Assign it in settings, then run a sync.`
									: `Specorator: ${result.path} already exists — left untouched.`,
							);
						} catch (error) {
							this.notifyFailure('scaffold', error);
						}
					})();
				}).open();
			},
		});

		// Component library consent (FR-18 / D11): a one-time, revocable prompt that
		// discloses build-time execution (no sandbox) and grants/revokes the
		// persisted consent the transpile gate reads.
		this.addCommand({
			id: 'component-library-consent',
			name: 'Enable/disable component library (build-time code execution)',
			callback: () => {
				new ConsentModal(this.app, settings.currentConsent().granted, (decision) => {
					void (async () => {
						if (decision === 'grant') {
							await settings.grantLibraryConsent();
							new Notice(
								'Specorator: component library enabled. Component notes will be transpiled on the next sync.',
							);
						} else if (decision === 'revoke') {
							await settings.revokeLibraryConsent();
							new Notice('Specorator: component library consent revoked.');
						}
					})();
				}).open();
			},
		});

		// Create a new component note (FR-11h): scaffold frontmatter + a stub fence
		// in the library folder. Works regardless of consent (authoring is always
		// allowed; only transpilation/execution is gated).
		this.addCommand({
			id: 'create-component',
			name: 'Create component note',
			callback: () => {
				new ComponentNoteModal(this.app, (request) => {
					void this.createComponentNote(settings, request);
				}).open();
			},
		});

		// Add-to-nav helper (FR-13; D14): append the active note to the curated
		// navigation. For a designated page the target route is derived with the
		// same pure rule the sync uses; otherwise the note's basename seeds a
		// placeholder route the user can refine. The curation decision is the pure
		// `addNavItem`; this command only feeds it the active file + settings.
		this.addCommand({
			id: 'add-to-nav',
			name: 'Add current note to navigation',
			callback: () => {
				this.addActiveNoteToNav(settings);
			},
		});

		// "Add to site" (the #1 onboarding affordance): publish a `.base` view from
		// the command palette. A `checkCallback` hides the command unless the active
		// file is a `.base`, so it only appears when actionable. The actual flow
		// (read/parse/enumerate/pick/append) lives in `addBaseToSite`.
		this.addCommand({
			id: 'add-active-base-to-site',
			name: 'Add active base to site',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const isBase = file !== null && file.extension === 'base';
				if (checking) return isBase;
				if (isBase) this.addBaseToSite(settings, file);
				return isBase;
			},
		});

		this.registerComponentMenus(settings);
		this.registerBaseMenu(settings);
		this.registerLiveResync(settings, sync);
	}

	/**
	 * Append the active note to the curated navigation menu (FR-13). Reads the
	 * note's frontmatter from the metadata cache to decide a sensible target
	 * route — a designated page uses its derived page route, any other note uses
	 * its slugified basename — then folds it into the nav with the pure
	 * `addNavItem`. The route is validated against the real site at the next sync
	 * (an unknown route becomes a label with a warning), so this never has to be
	 * exact. Surfaces the result as a Notice.
	 */
	private addActiveNoteToNav(settings: SettingsStore): void {
		const file = this.app.workspace.getActiveFile();
		if (file === null) {
			new Notice('Specorator: open a note first to add it to the navigation.');
			return;
		}

		const rawFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const frontmatter = toCellValueRecord(rawFrontmatter);
		const { pagesFolder, libraryFolder } = settings.readPageFolders();

		let route: string;
		if (isDesignatedPage(file.path, frontmatter, pagesFolder, libraryFolder)) {
			const isHome = isHomeDesignation(file.path, frontmatter, pagesFolder);
			route = derivePageRoute(file.path, frontmatter, pagesFolder, isHome);
		} else {
			// Not (yet) a designated page: seed a slug from the basename so the user
			// has a starting point; sync validation will flag it if it never exists.
			// Use the canonical single-segment slug rule (routing.ts) so this never
			// drifts from how real routes are derived.
			route = `/${slugifySegment(file.basename)}`;
		}

		const title = typeof frontmatter.title === 'string' ? frontmatter.title : file.basename;
		settings.edit((current) => {
			current.nav = addNavItem(current.nav, [], { title, route });
		});
		new Notice(
			`Specorator: added "${title}" (${route}) to the navigation. Refine it in settings, then sync.`,
		);
	}

	/**
	 * Register the right-click affordance on `.base` files (the #1 onboarding
	 * affordance): a "Specorator: add to site" item that appears ONLY for a
	 * `.base` file. Mirrors the component-library `file-menu` pattern; registered
	 * via `registerEvent` so Obsidian tears it down on unload (OBS-4).
	 */
	private registerBaseMenu(settings: SettingsStore): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'base') {
					return;
				}
				menu.addItem((item) =>
					item
						.setTitle('Specorator: add to site')
						.setIcon('globe')
						.onClick(() => {
							this.addBaseToSite(settings, file);
						}),
				);
			}),
		);
	}

	/**
	 * Publish a `.base` view (the "Add to site" flow). Reads + parses the file,
	 * enumerates its view names via the pure `listViewNames`, then:
	 * - **no named views** → append a single default target (empty `viewName`,
	 *   which `selectViewConfig` resolves to the first/implicit view);
	 * - **exactly one view** → append it directly (skip the picker);
	 * - **several** → open the {@link AddToSiteModal} to let the user pick one.
	 * The publish-list mutation is the pure, idempotent `appendPublishTarget`;
	 * this only does the Vault read + settings persist + Notice. A duplicate
	 * `(basePath, viewName)` pair is reported instead of duplicated. Failures
	 * (unreadable base) surface via the shared `UserFacingError` → Notice path.
	 */
	private addBaseToSite(settings: SettingsStore, file: TFile): void {
		void (async () => {
			try {
				const raw = await this.app.vault.cachedRead(file);
				const parsed = (parseYaml(raw) ?? {}) as ParsedBaseFile;
				const viewNames = listViewNames(parsed);

				if (viewNames.length === 0) {
					// No named views: publish the implicit/first view (empty viewName).
					this.publishTarget(settings, file.path, '');
					return;
				}
				if (viewNames.length === 1) {
					// Exactly one view: skip the picker and publish it directly.
					this.publishTarget(settings, file.path, viewNames[0] ?? '');
					return;
				}
				new AddToSiteModal(this.app, viewNames, (viewName) => {
					this.publishTarget(settings, file.path, viewName);
				}).open();
			} catch (error) {
				this.notifyFailure('add to site', error);
			}
		})();
	}

	/**
	 * Append one `(basePath, viewName)` publish target to the curated publish
	 * list via the pure, idempotent `appendPublishTarget`, persist the settings,
	 * and surface the result. A newly-added target prompts a sync; a pre-existing
	 * one is reported rather than duplicated.
	 */
	private publishTarget(settings: SettingsStore, basePath: string, viewName: string): void {
		const target: PublishTarget = { basePath, viewName };
		let added = false;
		settings.edit((current) => {
			const result = appendPublishTarget(current.site.includes, target);
			current.site.includes = result.includes;
			added = result.added;
		});
		const label = viewName === '' ? 'default view' : `'${viewName}'`;
		new Notice(
			added
				? `Specorator: added ${label} to your site — run Specorator: Sync site to publish.`
				: `Specorator: ${label} is already on your site.`,
		);
	}

	/**
	 * Run the gated component-library transpile (FR-11f/g, FR-18). The consent
	 * hard-gate lives in the pure use-case: when consent is absent this is a
	 * no-op that reads/writes nothing. Skip notes are logged, not surfaced as
	 * failures, so a malformed note never blocks a sync (FR-11g).
	 */
	private async transpileLibrary(transpile: TranspileLibrary): Promise<void> {
		const result = await transpile.run();
		for (const warning of result.warnings) {
			console.warn(`[specorator] ${warning}`);
		}
		if (result.consented && result.emitted > 0) {
			console.warn(`[specorator] transpiled ${String(result.emitted)} component note(s).`);
		}
	}

	/**
	 * Register the right-click affordances (FR-11k, OBS-4): an `editor-menu`
	 * "Insert Astro component block" that drops a ```astro fence at the cursor
	 * (and, inside the library folder, a "Create component here" entry), plus a
	 * `file-menu` "New component note" on the library folder. Registered via
	 * `registerEvent` so Obsidian tears them down on unload. DOM is built by the
	 * menu API only (no innerHTML, OBS-1).
	 */
	private registerComponentMenus(settings: SettingsStore): void {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				menu.addItem((item) =>
					item
						.setTitle('Astro component block: insert code fence')
						.setIcon('code')
						.onClick(() => {
							editor.replaceSelection(astroFenceSnippet());
						}),
				);
				// When the active file is inside the library folder, offer a quick
				// "Create component here" that scaffolds a sibling component note.
				const active = this.app.workspace.getActiveFile();
				const folder = settings.readLibraryConfig().folder;
				if (active !== null && isComponentLibraryNote(active.path, folder)) {
					menu.addItem((item) =>
						item
							.setTitle('Create component note')
							.setIcon('file-plus')
							.onClick(() => {
								new ComponentNoteModal(this.app, (request) => {
									void this.createComponentNote(settings, request);
								}).open();
							}),
					);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file) => {
				const folder = settings.readLibraryConfig().folder;
				// Offer "New component note" on the library folder (or notes within it).
				const inLibrary =
					file instanceof TFolder
						? isComponentLibraryNote(file.path, folder) ||
							isComponentLibraryNote(`${file.path}/.`, folder)
						: isComponentLibraryNote(file.path, folder);
				if (!inLibrary) return;
				menu.addItem((item) =>
					item
						.setTitle('New component note')
						.setIcon('file-plus')
						.onClick(() => {
							new ComponentNoteModal(this.app, (request) => {
								void this.createComponentNote(settings, request);
							}).open();
						}),
				);
			}),
		);
	}

	/**
	 * Create a scaffolded component note in the library folder (FR-11h). The note
	 * text is the pure `buildComponentNote`; this only does the Vault I/O: ensure
	 * the folder exists, then create the note (never overwriting an existing one —
	 * NFR-9) and open it. Surfaces success/conflict as a Notice.
	 */
	private async createComponentNote(
		settings: SettingsStore,
		request: ComponentNoteRequest,
	): Promise<void> {
		try {
			const folder = normalizePath(settings.readLibraryConfig().folder);
			const stub: ComponentNoteStub = buildComponentNote(request.name, request.kind);
			const path = normalizePath(`${folder}/${stub.fileName}`);

			if (this.app.vault.getAbstractFileByPath(folder) === null) {
				await this.app.vault.createFolder(folder);
			}
			// Never clobber an existing note (NFR-9): bail with a clear message.
			if (this.app.vault.getAbstractFileByPath(path) !== null) {
				new Notice(`Specorator: ${path} already exists — left untouched.`);
				return;
			}
			const created = await this.app.vault.create(path, stub.contents);
			await this.app.workspace.getLeaf(true).openFile(created);
			new Notice(
				`Specorator: created ${path}. Enable the component library (consent) and run a sync.`,
			);
		} catch (error) {
			this.notifyFailure('create component', error);
		}
	}

	/**
	 * Drive the pure `LiveResyncTrigger` from Obsidian events (FR-20 / D2). The
	 * decision of *whether/when* to re-sync is core; this only feeds it vault
	 * changes + the wall clock and fires `sync.run()` when the model says to. Both
	 * the metadata subscription and the timer are registered with the plugin so
	 * Obsidian tears them down on unload (OBS-4).
	 */
	private registerLiveResync(settings: SettingsStore, sync: SyncSite): void {
		const trigger = new LiveResyncTrigger({ enabled: settings.readSyncConfig().liveResync });

		// Watch metadata changes for the previewed base's `.base` file. The
		// previewed-base wiring is intentionally minimal here (Phase 1): we treat
		// any `.base` file edit as a candidate and let the pure trigger decide.
		this.registerEvent(
			this.app.metadataCache.on('changed', (file: TFile) => {
				if (file.extension !== 'base') return;
				// Re-read the toggle each event so settings changes take effect live.
				trigger.setEnabled(settings.readSyncConfig().liveResync);
				trigger.setPreviewedBase(file.path);
				trigger.onDataChanged(file.path, Date.now());
			}),
		);

		// A lightweight tick checks the debounce window; the model fires at most
		// once per quiet burst. A `resyncing` latch skips a flush while a prior
		// `sync.run()` is still in flight, so a sync slower than the tick can never
		// start a second concurrent commit racing on the writer's atomic swap (FIX 4a).
		let resyncing = false;
		this.registerInterval(
			window.setInterval(() => {
				if (resyncing) return;
				if (trigger.flush(Date.now())) {
					resyncing = true;
					void sync
						.run()
						.catch((error: unknown) => {
							this.notifyFailure('live re-sync', error);
						})
						.finally(() => {
							resyncing = false;
						});
				}
			}, RESYNC_TICK_MS),
		);
	}

	/**
	 * Run the **Export/Reveal build** action (FR-22 / D6): copy the built `dist/`
	 * to the user-chosen export location and reveal it in the OS file manager.
	 * The only decision here is the two thin guards a composition root may make —
	 * an unset destination and an unavailable exporter (non-desktop fs) — each
	 * surfaced as a clear Notice; the copy/reveal I/O lives in the adapter.
	 */
	private async exportBuild(
		settings: SettingsStore,
		exporter: BuildExportPort | undefined,
	): Promise<void> {
		if (exporter === undefined) {
			new Notice('Specorator: export is unavailable in this environment.');
			return;
		}
		const destDir = settings.readExportConfig().exportPath;
		if (destDir === undefined || destDir === '') {
			new Notice('Specorator: set an export location in settings first.');
			return;
		}
		try {
			const { exportedTo } = await exporter.exportBuild(destDir);
			await exporter.reveal(exportedTo);
			new Notice(`Specorator: exported build to ${exportedTo}.`);
		} catch (error) {
			this.notifyFailure('export', error);
		}
	}

	/**
	 * Surface a use-case failure. A `UserFacingError` (e.g. a disabled core
	 * plugin, FR-10) shows its already-phrased message verbatim; anything else
	 * gets the generic "see console" fallback with the error logged.
	 */
	private notifyFailure(action: string, error: unknown): void {
		if (error instanceof UserFacingError) {
			new Notice(error.message);
			return;
		}
		new Notice(`Specorator: ${action} failed — see console.`);
		console.error(`[specorator] ${action} failed`, error);
	}

	override onunload(): void {
		// Obsidian's onunload is synchronous; fire-and-forget the process teardown.
		void this.astro?.stop();
	}
}

/**
 * Narrow Obsidian's loosely-typed frontmatter record to the JSON-serializable
 * {@link CellValue} subset the pure page-designation helpers consume (mirrors the
 * page-loader adapter's coercion). Only used by the add-to-nav helper, which
 * needs the note's title/route/flag hints; non-scalar values are stringified so
 * the decision logic still sees a usable value.
 */
function toCellValueRecord(raw: Record<string, unknown>): Record<string, CellValue> {
	const out: Record<string, CellValue> = {};
	for (const [key, value] of Object.entries(raw)) {
		out[key] = toCellValue(value);
	}
	return out;
}

/** Coerce one frontmatter value to the JSON-serializable {@link CellValue} subset. */
function toCellValue(value: unknown): CellValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(scalarString);
	}
	return scalarString(value);
}

/** String form of a non-scalar frontmatter value (objects → JSON, never `[object Object]`). */
function scalarString(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return '';
	try {
		return JSON.stringify(value);
	} catch {
		return '';
	}
}
