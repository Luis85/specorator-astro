import { debounce, type Plugin } from 'obsidian';
import type { SiteConfig } from '../core/domain/types';
import type { SettingsPort } from '../core/ports';
import {
	defaultSettings,
	migrate,
	type ToolchainConfig,
	type VersionedSettings,
} from '../core/domain/settings-migration';

/**
 * Everything the plugin persists, as the current versioned schema. The shape,
 * its schema version, and the forward migration that upgrades older/unversioned
 * persisted blobs all live in the pure `core` migration module (NFR-8); this
 * adapter is the thin load/hold/save shell around Obsidian's data API.
 */
export type PluginSettings = VersionedSettings;

/**
 * Loads, holds, and persists plugin settings via Obsidian's data API, and
 * exposes the site config to the pure core through `SettingsPort`. This replaces
 * the former vault config note as the single source of truth (D4). On load it
 * runs the pure `migrate()` so older/unversioned persisted data (e.g. the
 * pre-C4 `{ site }` shape) is forward-migrated to the current versioned schema
 * (NFR-8). Writes are debounced so editing the settings tab does not hit disk on
 * every keystroke.
 */
export class SettingsStore implements SettingsPort {
	private settings: PluginSettings = defaultSettings();
	private readonly persist: () => void;

	constructor(private readonly plugin: Plugin) {
		this.persist = debounce(() => void this.plugin.saveData(this.settings), 500, false);
	}

	async load(): Promise<void> {
		const data: unknown = await this.plugin.loadData();
		this.settings = migrate(data);
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

	/** Snapshot the current toolchain/dev-server config for the process adapter. */
	readToolchainConfig(): ToolchainConfig {
		return { ...this.settings.toolchain };
	}
}
