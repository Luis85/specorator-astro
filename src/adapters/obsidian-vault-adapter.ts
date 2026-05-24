import { normalizePath, type App } from 'obsidian';
import type { SiteConfig } from '../core/domain/types';
import type { VaultPort } from '../core/ports';

/** Reads the site-config note from the vault. */
export class ObsidianVaultAdapter implements VaultPort {
	constructor(
		private readonly app: App,
		private readonly configPath: string,
	) {}

	async readSiteConfig(): Promise<SiteConfig> {
		const path = normalizePath(this.configPath);
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			return { includes: [] };
		}
		// TODO(phase-1): parse the config note's frontmatter/body into a SiteConfig.
		return { includes: [] };
	}
}
