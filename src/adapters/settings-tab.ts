import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { SettingsStore } from './settings-store';

/**
 * Native settings tab for editing the site configuration: the absolute site URL
 * and the curated list of published `(base, view)` targets. Replaces the former
 * hand-edited config note (D4).
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
					.onChange(async (value) => {
						const trimmed = value.trim();
						await this.store.update((settings) => {
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
						.onChange(async (value) => {
							await this.store.update((settings) => {
								settings.site.includes[index].basePath = value.trim();
							});
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('View name')
						.setValue(target.viewName)
						.onChange(async (value) => {
							await this.store.update((settings) => {
								settings.site.includes[index].viewName = value.trim();
							});
						}),
				)
				.addText((text) =>
					text
						.setPlaceholder('/route (optional)')
						.setValue(target.route ?? '')
						.onChange(async (value) => {
							const trimmed = value.trim();
							await this.store.update((settings) => {
								settings.site.includes[index].route =
									trimmed === '' ? undefined : trimmed;
							});
						}),
				)
				.addExtraButton((button) =>
					button
						.setIcon('trash')
						.setTooltip('Remove this view')
						.onClick(() => {
							void this.store
								.update((settings) => {
									settings.site.includes.splice(index, 1);
								})
								.then(() => {
									this.display();
								});
						}),
				);
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText('Add published view')
				.setCta()
				.onClick(() => {
					void this.store
						.update((settings) => {
							settings.site.includes.push({ basePath: '', viewName: '' });
						})
						.then(() => {
							this.display();
						});
				}),
		);
	}
}
