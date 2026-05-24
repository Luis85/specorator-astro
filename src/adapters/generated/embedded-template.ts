/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Produced by scripts/embed-template.mjs from templates/astro/**, which is the
 * editable source of truth. Run `npm run build` (or `node scripts/embed-template.mjs`)
 * to regenerate. Embedding the template into main.js is mandatory because the
 * release ships only main.js + manifest.json + styles.css (DIST-BRAT-1).
 *
 * 10 file(s) embedded.
 */
import type { TemplateFile } from '../../core/domain/template';

export const EMBEDDED_TEMPLATE_FILES: readonly TemplateFile[] = [
	{
		path: "astro.config.mjs",
		ownership: "template",
		contents: "// @ts-check\nimport { defineConfig } from 'astro/config';\n\n// Static output is mandatory: the published site is a deployable static bundle\n// and @astrojs/sitemap (added in C15) crawls statically-generated routes\n// (docs/DESIGN.md §5.7, REQUIREMENTS.md FR-14). Do not switch to SSR.\nexport default defineConfig({\n\toutput: 'static',\n});\n",
	},
	{
		path: "package.json",
		ownership: "template",
		contents: "{\n\t\"name\": \"specorator-astro-site\",\n\t\"version\": \"0.0.0\",\n\t\"private\": true,\n\t\"type\": \"module\",\n\t\"description\": \"Bundled Astro project scaffolded by Specorator Astro Viewer into the plugin data folder. Edit src/user/** to customize; src/theme/** is template-owned and replaced on upgrade.\",\n\t\"scripts\": {\n\t\t\"dev\": \"astro dev\",\n\t\t\"build\": \"astro build\",\n\t\t\"check\": \"astro check\"\n\t},\n\t\"dependencies\": {\n\t\t\"astro\": \"6.3.7\"\n\t},\n\t\"devDependencies\": {\n\t\t\"@astrojs/check\": \"0.9.9\",\n\t\t\"typescript\": \"6.0.3\"\n\t}\n}\n",
	},
	{
		path: "src/pages/index.astro",
		ownership: "template",
		contents: "---\n/*\n * Template-owned home route. Proves the scaffolded project is runnable from\n * first bootstrap and exercises the layout + registry seam. The data-driven\n * collection and detail routes arrive with C5/C8.\n */\nimport { resolveLayout, resolveView } from '../registry';\n\nconst BaseLayout = resolveLayout('BaseLayout');\nconst Placeholder = resolveView('placeholder');\n---\n\n<BaseLayout title=\"Specorator site\">\n\t<Placeholder />\n</BaseLayout>\n",
	},
	{
		path: "src/registry.ts",
		ownership: "template",
		contents: "/*\n * specorator-template-version: 1\n *\n * Component & layout registry — the stable barrel that maps a registry *name*\n * to an Astro component (docs/DESIGN.md §5.6). Keeping all components behind one\n * barrel dodges Astro's new-file HMR gap (D9): the file set never changes, only\n * its contents do.\n *\n * Precedence on a name collision (FR-11j): vault component note (`generated/`)\n * → hand-written `user/` → bundled `theme/` default. The richer scanning of\n * `generated/` and `user/` arrives with C5/C11/C12; C1 ships the theme defaults\n * and the resolution seam.\n */\nimport Placeholder from './theme/views/Placeholder.astro';\nimport BaseLayout from './theme/layouts/BaseLayout.astro';\n\ntype AstroComponent = (props: Record<string, unknown>) => unknown;\n\nconst views: Record<string, AstroComponent> = {\n\t// C5 registers the real `table` / `cards` / `list` components here.\n\tplaceholder: Placeholder as unknown as AstroComponent,\n};\n\nconst layouts: Record<string, AstroComponent> = {\n\tBaseLayout: BaseLayout as unknown as AstroComponent,\n};\n\n/** Resolve a view-component name to a component, falling back to the placeholder. */\nexport function resolveView(name: string): AstroComponent {\n\treturn views[name] ?? views.placeholder;\n}\n\n/** Resolve a layout name to a layout component, falling back to BaseLayout. */\nexport function resolveLayout(name: string): AstroComponent {\n\treturn layouts[name] ?? layouts.BaseLayout;\n}\n",
	},
	{
		path: "src/theme/layouts/BaseLayout.astro",
		ownership: "template",
		contents: "---\n/*\n * specorator-template-version: 1\n * Template-owned default site layout. Replaced on plugin upgrade.\n * To customize without losing your work on upgrade, add a same-named layout\n * under src/user/layouts/ (it shadows this via the registry, FR-11a/FR-11j).\n */\nimport '../styles/tokens.css';\nimport '../../user/theme.css';\n\ninterface Props {\n\ttitle?: string;\n}\n\nconst { title = 'Specorator site' } = Astro.props;\n---\n\n<!doctype html>\n<html lang=\"en\">\n\t<head>\n\t\t<meta charset=\"utf-8\" />\n\t\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n\t\t<title>{title}</title>\n\t</head>\n\t<body>\n\t\t<main class=\"sp-shell\">\n\t\t\t<slot />\n\t\t</main>\n\t</body>\n</html>\n\n<style>\n\tbody {\n\t\tmargin: 0;\n\t\tbackground: var(--sp-color-bg);\n\t\tcolor: var(--sp-color-fg);\n\t\tfont-family: var(--sp-font-body);\n\t}\n\t.sp-shell {\n\t\tmax-width: var(--sp-maxwidth);\n\t\tmargin: 0 auto;\n\t\tpadding: var(--sp-space);\n\t}\n</style>\n",
	},
	{
		path: "src/theme/styles/tokens.css",
		ownership: "template",
		contents: "/*\n * specorator-template-version: 1\n * Template-owned default design tokens. Replaced on plugin upgrade.\n * User overrides belong in src/user/theme.css, which loads last and wins.\n */\n:root {\n\t--sp-color-bg: #ffffff;\n\t--sp-color-fg: #1a1a1a;\n\t--sp-color-muted: #6b7280;\n\t--sp-color-accent: #3b5bdb;\n\t--sp-font-body:\n\t\t-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;\n\t--sp-space: 1rem;\n\t--sp-radius: 0.5rem;\n\t--sp-maxwidth: 64rem;\n}\n\n@media (prefers-color-scheme: dark) {\n\t:root {\n\t\t--sp-color-bg: #11151c;\n\t\t--sp-color-fg: #e6e6e6;\n\t\t--sp-color-muted: #9aa4b2;\n\t\t--sp-color-accent: #748ffc;\n\t}\n}\n",
	},
	{
		path: "src/theme/views/Placeholder.astro",
		ownership: "template",
		contents: "---\n/*\n * specorator-template-version: 1\n * Template-owned placeholder view. The real table/cards/list view components\n * arrive in chunk C5; this exists so the scaffolded project is runnable from\n * first bootstrap (C1) and so the registry seam has something to resolve.\n */\ninterface Props {\n\theading?: string;\n}\n\nconst { heading = 'No collections synced yet' } = Astro.props;\n---\n\n<section class=\"sp-placeholder\">\n\t<h1>{heading}</h1>\n\t<p>\n\t\tRun <strong>Sync site</strong> in Obsidian to publish your Bases collections here.\n\t</p>\n</section>\n\n<style>\n\t.sp-placeholder {\n\t\tcolor: var(--sp-color-muted);\n\t}\n\t.sp-placeholder h1 {\n\t\tcolor: var(--sp-color-fg);\n\t}\n</style>\n",
	},
	{
		path: "src/user/README.md",
		ownership: "user",
		contents: "# `src/user/` — your files, never overwritten\n\nEverything in this directory is **user-owned**. The plugin creates it once on\nfirst bootstrap and never touches it again on upgrade (FR-11a / NFR-7).\n\n- `theme.css` — design-token overrides (loads last, so it wins).\n- `layouts/`, `views/`, `components/` — hand-written `.astro` that **shadow**\n  the bundled `src/theme/**` defaults of the same name (registry precedence,\n  FR-11j). Create these directories as you need them.\n\nThe bundled defaults live in `src/theme/**` and are replaced wholesale on each\nplugin upgrade — never edit those in place; override here instead.\n",
	},
	{
		path: "src/user/theme.css",
		ownership: "user",
		contents: "/*\n * User-owned theme overrides. This file is created once on first bootstrap and\n * is NEVER overwritten when the plugin's bundled template is upgraded\n * (FR-11a / NFR-7). Redefine the design tokens from src/theme/styles/tokens.css\n * here — because it loads last, your values win without editing any component.\n *\n * Example:\n *   :root { --sp-color-accent: #e8590c; }\n */\n",
	},
	{
		path: "tsconfig.json",
		ownership: "template",
		contents: "{\n\t\"extends\": \"astro/tsconfigs/strict\",\n\t\"include\": [\".astro/types.d.ts\", \"**/*\"],\n\t\"exclude\": [\"dist\"]\n}\n",
	},
];
