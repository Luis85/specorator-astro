import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { SettingsStore } from './settings-store';
import { DEFAULT_DEV_PORT } from '../core/domain/settings-migration';

/**
 * Native settings tab for editing the site configuration: the absolute site URL,
 * the curated list of published `(base, view)` targets, and the toolchain
 * (dev-server port + Node/Astro binary overrides, FR-8). Replaces the former
 * hand-edited config note (D4). Mutations look up each target by identity so
 * concurrent edits and removals never write to the wrong row.
 */
export class SiteSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly store: SettingsStore,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

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
			new Setting(containerEl)
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
				)
				.addExtraButton((button) =>
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

		this.displaySyncTriggers(containerEl);
		this.displayToolchain(containerEl);
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
