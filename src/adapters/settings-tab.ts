import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { SettingsStore } from './settings-store';

/**
 * Native settings tab for editing the site configuration: the absolute site URL
 * and the curated list of published `(base, view)` targets. Replaces the former
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
	}

	override hide(): void {
		// Flush any debounced edits when the tab closes.
		void this.store.save();
	}
}
