import { debounce, type Plugin } from 'obsidian';
import type { SiteConfig } from '../core/domain/types';
import type { NavConfig } from '../core/domain/navigation';
import type { ComponentLibraryPort, SettingsPort } from '../core/ports';
import { grantConsent, revokeConsent, type ConsentState } from '../core/domain/consent';
import {
	defaultSettings,
	migrate,
	type ExportConfig,
	type LibraryConfig,
	type PagesConfig,
	type SyncConfig,
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
export class SettingsStore implements SettingsPort, ComponentLibraryPort {
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

	/** Snapshot the current sync-trigger config (live-resync toggle, FR-20). */
	readSyncConfig(): SyncConfig {
		return { ...this.settings.sync };
	}

	/** Snapshot the current build/export config (Export/Reveal destination, FR-22). */
	readExportConfig(): ExportConfig {
		return { ...this.settings.export };
	}

	/**
	 * Snapshot the component-library config (folder + consent, FR-11f / FR-18).
	 * The transpile use-case reads this through {@link ComponentLibraryPort} and
	 * hard-gates on `consent`; the settings tab + consent command edit it.
	 */
	readLibraryConfig(): LibraryConfig {
		const { library } = this.settings;
		return { folder: library.folder, consent: { ...library.consent } };
	}

	/**
	 * Snapshot the standalone-pages config (the pages folder, FR-12). The
	 * page-loader adapter reads this to decide which notes are designated pages.
	 */
	readPagesConfig(): PagesConfig {
		return { ...this.settings.pages };
	}

	/**
	 * Snapshot the curated navigation menu (FR-13; `SettingsPort`). `SyncSite`
	 * resolves this against the route table into the committed `navigation`
	 * snapshot; the settings tab edits it. Returned as a structuredClone so callers
	 * can't mutate the held config in place.
	 */
	readNavConfig(): NavConfig {
		return structuredClone(this.settings.nav);
	}

	/**
	 * The pages folder + component-library folder the pure `buildPageNodes` needs
	 * to decide designation and the FR-11i component exclusion (`SettingsPort`).
	 */
	readPageFolders(): { pagesFolder: string; libraryFolder: string } {
		return {
			pagesFolder: this.settings.pages.folder,
			libraryFolder: this.settings.library.folder,
		};
	}

	/**
	 * Record one-time build-execution consent (FR-18 / D11), stamping advisory
	 * provenance (the schema version + an ISO timestamp). Persists immediately so
	 * a crash after granting does not lose the user's decision.
	 */
	async grantLibraryConsent(): Promise<void> {
		this.settings.library.consent = grantConsent(
			this.settings.version,
			new Date().toISOString(),
		);
		await this.save();
	}

	/** Revoke build-execution consent (FR-18: revocable); the gate shuts again. */
	async revokeLibraryConsent(): Promise<void> {
		this.settings.library.consent = revokeConsent();
		await this.save();
	}

	/** The current consent state (for the consent command/UI to reflect). */
	currentConsent(): ConsentState {
		return { ...this.settings.library.consent };
	}
}
