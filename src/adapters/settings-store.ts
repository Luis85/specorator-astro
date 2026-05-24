import { debounce, type Plugin } from 'obsidian';
import type { PublishTarget, SiteConfig } from '../core/domain/types';
import type { SettingsPort } from '../core/ports';

/** Everything the plugin persists. The site config is the user-curated publish list. */
export interface PluginSettings {
	site: SiteConfig;
}

function isPublishTarget(value: unknown): value is PublishTarget {
	return (
		typeof value === 'object' &&
		value !== null &&
		'basePath' in value &&
		typeof value.basePath === 'string' &&
		'viewName' in value &&
		typeof value.viewName === 'string'
	);
}

/** Tolerantly parse persisted (possibly stale or hand-edited) data into a valid SiteConfig. */
function parseSiteConfig(data: unknown): SiteConfig {
	if (typeof data !== 'object' || data === null || !('site' in data)) {
		return { includes: [] };
	}
	const site = data.site;
	if (typeof site !== 'object' || site === null) {
		return { includes: [] };
	}
	const siteUrl =
		'siteUrl' in site && typeof site.siteUrl === 'string' ? site.siteUrl : undefined;
	const includes =
		'includes' in site && Array.isArray(site.includes)
			? site.includes.filter(isPublishTarget)
			: [];
	return siteUrl === undefined ? { includes } : { includes, siteUrl };
}

/**
 * Loads, holds, and persists plugin settings via Obsidian's data API, and
 * exposes the site config to the pure core through `SettingsPort`. This replaces
 * the former vault config note as the single source of truth (D4). Writes are
 * debounced so editing the settings tab does not hit disk on every keystroke.
 */
export class SettingsStore implements SettingsPort {
	private settings: PluginSettings = { site: { includes: [] } };
	private readonly persist: () => void;

	constructor(private readonly plugin: Plugin) {
		this.persist = debounce(() => void this.plugin.saveData(this.settings), 500, false);
	}

	async load(): Promise<void> {
		const data: unknown = await this.plugin.loadData();
		this.settings = { site: parseSiteConfig(data) };
	}

	current(): PluginSettings {
		return this.settings;
	}

	/** Mutate the in-memory settings and schedule a debounced save. */
	edit(mutate: (settings: PluginSettings) => void): void {
		mutate(this.settings);
		this.persist();
	}

	/** Persist immediately, e.g. when the settings tab closes. */
	async save(): Promise<void> {
		await this.plugin.saveData(this.settings);
	}

	async readSiteConfig(): Promise<SiteConfig> {
		return this.settings.site;
	}
}
