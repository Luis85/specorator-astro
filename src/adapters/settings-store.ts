import type { Plugin } from 'obsidian';
import type { SiteConfig } from '../core/domain/types';
import type { SettingsPort } from '../core/ports';

/** Everything the plugin persists. The site config is the user-curated publish list. */
export interface PluginSettings {
	site: SiteConfig;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	site: { includes: [] },
};

/**
 * Loads, holds, and persists plugin settings via Obsidian's data API, and
 * exposes the site config to the pure core through `SettingsPort`. This replaces
 * the former vault config note as the single source of truth (D4).
 */
export class SettingsStore implements SettingsPort {
	private settings: PluginSettings = { site: { includes: [] } };

	constructor(private readonly plugin: Plugin) {}

	async load(): Promise<void> {
		const data = (await this.plugin.loadData()) as Partial<PluginSettings> | null;
		this.settings = {
			site: {
				includes: [],
				...data?.site,
			},
		};
	}

	current(): PluginSettings {
		return this.settings;
	}

	/** Mutate the in-memory settings and persist them in one step. */
	async update(mutate: (settings: PluginSettings) => void): Promise<void> {
		mutate(this.settings);
		await this.plugin.saveData(this.settings);
	}

	async readSiteConfig(): Promise<SiteConfig> {
		return this.settings.site;
	}
}
