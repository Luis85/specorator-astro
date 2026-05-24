import type { ResolvedTarget, SiteConfig, ViewSnapshot } from './domain/types';

/** Provides the user's site configuration (managed in the plugin's settings). */
export interface SettingsPort {
	readSiteConfig(): Promise<SiteConfig>;
}

/** Harvests one `(base, view)` target into a serializable snapshot. */
export interface BasesPort {
	harvest(target: ResolvedTarget): Promise<ViewSnapshot>;
}

/** Persists snapshots into the Astro project's data directory. */
export interface SnapshotWriterPort {
	/** Atomically replace all persisted snapshots with exactly this set. */
	commit(snapshots: ViewSnapshot[]): Promise<void>;
}

/** Runs the Astro toolchain (dev server / build) out-of-process. */
export interface AstroProcessPort {
	startDev(): Promise<{ url: string }>;
	build(): Promise<void>;
	stop(): Promise<void>;
}

/** Opens a URL in Obsidian's Web Viewer. */
export interface WebViewerPort {
	open(url: string): Promise<void>;
}
