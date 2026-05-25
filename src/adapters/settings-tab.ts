import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { SettingsStore } from './settings-store';
import type { RegistryPort } from '../core/ports';
import type { PublishTarget } from '../core/domain/types';
import { DEFAULT_DEV_PORT } from '../core/domain/settings-migration';
import {
	addNavItem,
	moveNavItem,
	removeNavItem,
	updateNavItem,
	type NavConfig,
	type NavItem,
	type NavPath,
} from '../core/domain/navigation';
import {
	AUTO,
	availableNames,
	resolveRegistry,
	type ResolvedRegistry,
} from '../core/domain/registry';

/**
 * Native settings tab for editing the site configuration: the absolute site URL,
 * the curated list of published `(base, view)` targets, the toolchain
 * (dev-server port + Node/Astro binary overrides), and the build export location
 * (FR-8, FR-22). Replaces the former hand-edited config note (D4). Mutations look
 * up each target by identity so concurrent edits and removals never write to the
 * wrong row.
 */
export class SiteSettingTab extends PluginSettingTab {
	/**
	 * The discovered + precedence-resolved component/layout names that populate
	 * the per-view dropdowns (FR-11b/d). Cached across a `display()` pass and
	 * refreshed (async) each time the tab opens, since scaffolding a stub adds a
	 * name. `null` until the first scan resolves.
	 */
	private registry: ResolvedRegistry | null = null;

	constructor(
		app: App,
		plugin: Plugin,
		private readonly store: SettingsStore,
		/** Optional: when present, the per-view dropdowns list discovered names. */
		private readonly registryPort?: RegistryPort,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Kick off (or refresh) the registry scan; re-render when it resolves so
		// the dropdowns gain the discovered names. The first synchronous paint uses
		// whatever is already cached (text inputs until the scan lands).
		this.refreshRegistry();

		new Setting(containerEl)
			.setName('Site URL')
			.setDesc(
				'Absolute URL of the published site. Optional for preview; required at build for canonical links and the sitemap.',
			)
			.addText((text) =>
				text
					.setPlaceholder('https://example.com')
					.setValue(this.store.current().site.siteUrl ?? '')
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							settings.site.siteUrl = trimmed === '' ? undefined : trimmed;
						});
					}),
			);

		new Setting(containerEl).setName('Published views').setHeading();

		const includes = this.store.current().site.includes;
		includes.forEach((target, index) => {
			const setting = new Setting(containerEl)
				.setName(`View ${String(index + 1)}`)
				.addText((text) =>
					text
						.setPlaceholder('Books/books.base')
						.setValue(target.basePath)
						.onChange((value) => {
							this.store.edit((settings) => {
								const i = settings.site.includes.indexOf(target);
								if (i !== -1) settings.site.includes[i].basePath = value.trim();
							});
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('View name')
						.setValue(target.viewName)
						.onChange((value) => {
							this.store.edit((settings) => {
								const i = settings.site.includes.indexOf(target);
								if (i !== -1) settings.site.includes[i].viewName = value.trim();
							});
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('/route (optional)')
						.setValue(target.route ?? '')
						.onChange((value) => {
							const trimmed = value.trim();
							this.store.edit((settings) => {
								const i = settings.site.includes.indexOf(target);
								if (i !== -1)
									settings.site.includes[i].route =
										trimmed === '' ? undefined : trimmed;
							});
						}),
				);

			// Component/layout assignment (FR-11c/d). When the registry scan has
			// resolved, present dropdowns populated from the discovered names (plus
			// an `auto` option); the choice persists into the target's
			// `component`/`layout`, which planning + harvest resolve into the snapshot.
			this.addAssignmentDropdown(setting, target, 'component');
			this.addAssignmentDropdown(setting, target, 'layout');

			setting.addExtraButton((button) =>
				button
					.setIcon('trash')
					.setTooltip('Remove this view')
					.onClick(() => {
						this.store.edit((settings) => {
							const i = settings.site.includes.indexOf(target);
							if (i !== -1) settings.site.includes.splice(i, 1);
						});
						this.display();
					}),
			);
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText('Add published view')
				.setCta()
				.onClick(() => {
					this.store.edit((settings) => {
						settings.site.includes.push({ basePath: '', viewName: '' });
					});
					this.display();
				}),
		);

		this.displayPages(containerEl);
		this.displayNavigation(containerEl);
		this.displayComponentLibrary(containerEl);
		this.displaySyncTriggers(containerEl);
		this.displayToolchain(containerEl);
		this.displayBuild(containerEl);
	}

	/**
	 * Standalone pages section (FR-12 / FR-8). Sets the vault folder whose notes
	 * become website pages (default `Site/pages`, configurable). A note carrying a
	 * `site: true` / `type: page` frontmatter flag is also published from anywhere;
	 * one page (an explicit `home: true`, or an `index`/`home` note in the folder)
	 * becomes the home page (`/`).
	 */
	private displayPages(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Pages').setHeading();

		new Setting(containerEl)
			.setName('Pages folder')
			.setDesc(
				'Vault folder whose notes become standalone website pages. A note with `site: true` or `type: page` frontmatter is also published as a page from anywhere. One page (an explicit `home: true`, or an `index`/`home` note in the folder) becomes the home page (/).',
			)
			.addText((text) =>
				text
					.setPlaceholder('Site/pages')
					.setValue(this.store.readPagesConfig().folder)
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							settings.pages.folder = trimmed === '' ? 'Site/pages' : trimmed;
						});
					}),
			);
	}

	/**
	 * Navigation section (FR-13; D14). Curate the ordered, nestable site menu: each
	 * item has a title and an optional target route (a page/collection route; blank
	 * → a structural label/group). Add top-level items or children, reorder with the
	 * up/down buttons, and remove items. The curation **decisions** are the pure
	 * `core/navigation` helpers (`addNavItem`/`moveNavItem`/`removeNavItem`/
	 * `updateNavItem`); this method is the thin Obsidian adapter that renders them
	 * and persists each edit. The nav is resolved against the route table at sync
	 * time into the committed `navigation` snapshot — so an unknown route here is
	 * harmless (it renders as a label, with a sync warning).
	 */
	private displayNavigation(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Navigation').setHeading();

		new Setting(containerEl).setDesc(
			'Curated site menu shown on every page (with breadcrumbs). Items are ordered top to bottom and can be nested. Set a target route to make an item a link; leave it blank for a section label. An unknown route renders as a label.',
		);

		const nav = this.store.readNavConfig();
		this.renderNavItems(containerEl, nav, nav.items, []);

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText('Add nav item')
				.setCta()
				.onClick(() => {
					this.editNav((current) => addNavItem(current, [], { title: 'New item' }));
					this.display();
				}),
		);
	}

	/**
	 * Recursively render one sibling list of nav items at `parentPath`, indenting
	 * nested levels so the tree structure reads at a glance. Each row exposes a
	 * title + target-route input, reorder (up/down), add-child, and remove. Every
	 * mutation routes through a pure `core/navigation` helper and re-renders.
	 */
	private renderNavItems(
		containerEl: HTMLElement,
		nav: NavConfig,
		items: readonly NavItem[],
		parentPath: NavPath,
	): void {
		items.forEach((item, index) => {
			const path: number[] = [...parentPath, index];
			const depth = parentPath.length;
			const setting = new Setting(containerEl)
				.setName(`${'— '.repeat(depth)}${item.title || '(untitled)'}`)
				.addText((text) =>
					text
						.setPlaceholder('Title')
						.setValue(item.title)
						.onChange((value) => {
							this.editNav((current) =>
								updateNavItem(current, path, { title: value }),
							);
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('/route (blank = label)')
						.setValue(item.route ?? '')
						.onChange((value) => {
							this.editNav((current) =>
								updateNavItem(current, path, { route: value }),
							);
						}),
				);

			setting.addExtraButton((button) =>
				button
					.setIcon('chevron-up')
					.setTooltip('Move up')
					.onClick(() => {
						this.editNav((current) => moveNavItem(current, path, -1));
						this.display();
					}),
			);
			setting.addExtraButton((button) =>
				button
					.setIcon('chevron-down')
					.setTooltip('Move down')
					.onClick(() => {
						this.editNav((current) => moveNavItem(current, path, +1));
						this.display();
					}),
			);
			setting.addExtraButton((button) =>
				button
					.setIcon('corner-down-right')
					.setTooltip('Add sub-item')
					.onClick(() => {
						this.editNav((current) => addNavItem(current, path, { title: 'New item' }));
						this.display();
					}),
			);
			setting.addExtraButton((button) =>
				button
					.setIcon('trash')
					.setTooltip('Remove this item')
					.onClick(() => {
						this.editNav((current) => removeNavItem(current, path));
						this.display();
					}),
			);

			// Render this item's children one level deeper.
			if (item.children !== undefined && item.children.length > 0) {
				this.renderNavItems(containerEl, nav, item.children, path);
			}
		});
	}

	/**
	 * Apply a pure curation transform to the persisted nav config and schedule a
	 * debounced save. Re-reads the current config inside `edit` so concurrent text
	 * edits compose correctly.
	 */
	private editNav(transform: (config: NavConfig) => NavConfig): void {
		this.store.edit((settings) => {
			settings.nav = transform(settings.nav);
		});
	}

	/**
	 * Component library section (FR-11f, FR-18 / D11). Sets the vault folder where
	 * component notes live (default `Site/components`, configurable) and surfaces
	 * the build-execution **consent** toggle. The consent control discloses that
	 * component notes run at build time with no sandbox; flipping it on grants the
	 * one-time consent the transpile gate reads, off revokes it. Both persist.
	 */
	private displayComponentLibrary(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Component library').setHeading();

		new Setting(containerEl)
			.setName('Component library folder')
			.setDesc(
				'Vault folder holding your component notes (each a frontmatter note with an `astro` code-fence). Notes here are excluded from website pages and transpiled into components.',
			)
			.addText((text) =>
				text
					.setPlaceholder('Site/components')
					.setValue(this.store.readLibraryConfig().folder)
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							settings.library.folder = trimmed === '' ? 'Site/components' : trimmed;
						});
					}),
			);

		new Setting(containerEl)
			.setName('Enable component library (build-time code execution)')
			.setDesc(
				'Off by default. When on, component notes are transpiled into real components that run at build time with no sandbox — they can import code, read files, and run processes, exactly like project source. Only enable for notes you trust.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.store.currentConsent().granted).onChange((value) => {
					void (value
						? this.store.grantLibraryConsent()
						: this.store.revokeLibraryConsent());
				}),
			);
	}

	/**
	 * Scan the project for component/layout names (FR-11b), merge them by
	 * precedence (the pure `resolveRegistry`), cache the result, and re-render so
	 * the dropdowns gain the discovered names. No-op when no registry port is
	 * wired (minimal/test setups keep the text-only tab). Re-running is cheap and
	 * picks up a freshly-scaffolded stub when the tab is reopened.
	 */
	private refreshRegistry(): void {
		const port = this.registryPort;
		if (port === undefined) {
			return;
		}
		void port
			.discover()
			.then((discovered) => {
				const next = resolveRegistry(discovered);
				const changed = JSON.stringify(next) !== JSON.stringify(this.registry);
				this.registry = next;
				// Re-render once the names land (or change) so the dropdowns appear.
				if (changed) {
					this.renderWithRegistry();
				}
			})
			.catch(() => {
				// A scan failure (e.g. project not yet bootstrapped) just leaves the
				// text-input fallback; never block the rest of the settings tab.
			});
	}

	/**
	 * Re-render the tab body using the already-cached registry, without kicking
	 * off another scan (which `display()` would). Guards against re-rendering when
	 * the tab is not currently shown.
	 */
	private renderWithRegistry(): void {
		if (this.containerEl.isShown()) {
			// `display()` re-scans; calling it here would loop. Inline the redraw by
			// clearing + re-running the synchronous body via the public entry, which
			// is safe because `refreshRegistry` only re-renders when names *changed*.
			this.display();
		}
	}

	/**
	 * Add a component/layout assignment control to a published-view row (FR-11c/d).
	 * When the registry has resolved, this is a **dropdown** of the discovered
	 * names plus an `auto` option (auto → the view type for a component, the
	 * default layout for a layout); before the scan lands (or with no registry
	 * port) it degrades to a free-text field so the assignment is always editable.
	 * The chosen value persists into the target's `component`/`layout`; `auto`
	 * clears the override so planning/harvest fall back.
	 */
	private addAssignmentDropdown(
		setting: Setting,
		target: PublishTarget,
		field: 'component' | 'layout',
	): void {
		const current = target[field] ?? AUTO;
		const names =
			this.registry === null
				? null
				: availableNames(
						field === 'component' ? this.registry.components : this.registry.layouts,
					);

		const apply = (value: string): void => {
			const next = value.trim();
			this.store.edit((settings) => {
				const i = settings.site.includes.indexOf(target);
				if (i === -1) return;
				if (next === '' || next === AUTO) delete settings.site.includes[i][field];
				else settings.site.includes[i][field] = next;
			});
		};

		if (names === null) {
			setting.addText((text) =>
				text
					.setPlaceholder(field === 'component' ? 'component (auto)' : 'layout (auto)')
					.setValue(current === AUTO ? '' : current)
					.onChange(apply),
			);
			return;
		}

		// Include the currently-selected name even if the scan no longer lists it
		// (e.g. a since-deleted user file) so the user's choice stays visible.
		const options = new Set<string>([AUTO, ...names]);
		if (current !== AUTO) options.add(current);
		setting.addDropdown((dropdown) => {
			for (const name of options) {
				dropdown.addOption(name, name === AUTO ? `auto (${field})` : name);
			}
			dropdown.setValue(current).onChange(apply);
		});
	}

	/**
	 * Build section (FR-8, FR-22 / D6). `astro build` always writes to `dist/`
	 * inside the data-folder project; this only sets the **Export/Reveal build**
	 * destination — the absolute directory that `dist/` is copied into for manual
	 * deploy. Leave blank to skip export (the action errors with a clear message
	 * until a destination is set). NFR-9: the export copies into the destination,
	 * never deleting anything already there.
	 */
	private displayBuild(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Build').setHeading();

		new Setting(containerEl)
			.setName('Export location (optional)')
			.setDesc(
				'Absolute path of a folder the built site (dist/) is copied into when you export the build, ready to deploy to any static host. Leave blank to keep the build only in the plugin data folder.',
			)
			.addText((text) =>
				text
					.setPlaceholder('/path/to/my-published-site')
					.setValue(this.store.current().export.exportPath ?? '')
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							if (trimmed === '') delete settings.export.exportPath;
							else settings.export.exportPath = trimmed;
						});
					}),
			);
	}

	/**
	 * Sync-trigger section (FR-20 / D2). Manual "Sync site" and auto-sync on the
	 * first preview always run; this toggle controls only the optional, debounced
	 * live re-sync of the base currently being previewed (which briefly re-mounts
	 * it to re-harvest), so it ships off and is opt-in.
	 */
	private displaySyncTriggers(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Sync').setHeading();

		new Setting(containerEl)
			.setName('Live re-sync the previewed base')
			.setDesc(
				'When previewing, re-sync automatically (debounced) as you edit notes in the base on screen. Off by default; "Sync site" and the first preview always sync regardless.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.store.current().sync.liveResync).onChange((value) => {
					this.store.edit((settings) => {
						settings.sync.liveResync = value;
					});
				}),
			);
	}

	/**
	 * Toolchain section (FR-8 / DESIGN §5.3): the dev-server port Astro is asked
	 * to use (it auto-falls-back if busy, so the printed URL stays authoritative)
	 * plus optional absolute overrides for the Node and Astro binaries. The
	 * overrides exist to dodge the macOS GUI `PATH` gap and to point at a
	 * non-default install (NFR-4); empty means "resolve automatically".
	 */
	private displayToolchain(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Toolchain').setHeading();

		new Setting(containerEl)
			.setName('Dev-server port')
			.setDesc(
				`Port requested for "astro dev" (default ${String(DEFAULT_DEV_PORT)}). Astro auto-falls-back if the port is busy; the preview opens the URL Astro actually prints.`,
			)
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_DEV_PORT))
					.setValue(String(this.store.current().toolchain.port))
					.onChange((value) => {
						const parsed = Number.parseInt(value.trim(), 10);
						this.store.edit((settings) => {
							settings.toolchain.port =
								Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DEV_PORT;
						});
					}),
			);

		new Setting(containerEl)
			.setName('Node binary path (optional)')
			.setDesc(
				'Absolute path to the node executable. Leave blank to resolve it from the shell path. Set this when Obsidian cannot find node — common on macOS, where GUI apps do not inherit the login-shell path.',
			)
			.addText((text) =>
				text
					.setPlaceholder('/usr/local/bin/node')
					.setValue(this.store.current().toolchain.nodePath ?? '')
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							if (trimmed === '') delete settings.toolchain.nodePath;
							else settings.toolchain.nodePath = trimmed;
						});
					}),
			);

		new Setting(containerEl)
			.setName('Astro binary path (optional)')
			.setDesc(
				'Absolute path to the astro binary, overriding the project-local node_modules/.bin/astro. Leave blank to use the installed project binary.',
			)
			.addText((text) =>
				text
					.setPlaceholder('/path/to/node_modules/.bin/astro')
					.setValue(this.store.current().toolchain.astroBinPath ?? '')
					.onChange((value) => {
						const trimmed = value.trim();
						this.store.edit((settings) => {
							if (trimmed === '') delete settings.toolchain.astroBinPath;
							else settings.toolchain.astroBinPath = trimmed;
						});
					}),
			);
	}

	override hide(): void {
		// Flush any debounced edits when the tab closes.
		void this.store.save();
	}
}
