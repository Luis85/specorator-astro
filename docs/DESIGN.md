# specorator-astro — Design Document

> Status: **Draft / exploration**. This document captures the architecture and
> the key technical decisions for the plugin. It is the output of a research
> phase; sections marked **(unverified)** require a prototype spike before they
> are treated as settled.

## 1. Vision

Obsidian's **Bases** feature turns folders of notes into database-like
collections (tables, cards, lists, maps) by querying note frontmatter. Those
views are powerful but live only inside Obsidian, are styled only by the
active theme, and — critically — **do not render in Obsidian Publish**
(confirmed by Obsidian moderators, Oct 2025). There is no supported way to turn
a Base into a designed, publishable website.

`specorator-astro` is a **desktop Obsidian plugin** that uses your Bases as the
data source for an **Astro** site. The plugin harvests the *evaluated* results
of each Base view into JSON, an Astro project renders them with rich, custom
layouts, and the plugin:

- runs `astro dev` and shows the live site **inside Obsidian** via the built-in
  **Web Viewer** — a live "view layer" over your vault while you work; and
- runs `astro build` to produce a **publishable static site** from the same
  pipeline.

### Why this is novel

No existing tool combines these. Quartz, Flowershow, the Digital Garden plugin,
`obsidian-export`, and MkDocs setups all export *raw markdown* and none are
driven by Bases or use Astro. Obsidian Publish is hosted/proprietary and does
not render Bases. `astro-loader-obsidian` and VaultCMS read markdown at build
time but are not driven by evaluated Bases views and run no in-app preview.
The combination **Bases-as-data → Astro → live in-Obsidian preview → same
pipeline publishes** is unoccupied.

## 2. Goals and non-goals

### Goals
- Build a **complete website**, not just collection views: in addition to
  Bases-driven collections, support **standalone pages authored as vault notes**,
  a **configurable navigation** menu, and a generated **sitemap** (see §5.7).
- Drive page generation from `.base` files **and** ` ```base ` code blocks.
- Faithfully map the **native** Base view types — **table, cards, list** — to
  Astro components.
- Provide a live preview inside Obsidian (dev server in the Web Viewer).
- Produce a publishable static site (`astro build`).
- Make Astro **components and layouts easy to manage and customize** — discover,
  scaffold, assign per base/view, and edit with live preview — without forking
  the bundled template (see §5.6).
- Be high quality: DDD architecture, fully testable, strict quality gates
  (see `REQUIREMENTS.md`).

### Scope: native Obsidian features only
The plugin depends **solely on Obsidian core features** — **Bases** and the
**Web Viewer** core plugins. It does **not** require, integrate with, or assume
any third-party community plugin. One consequence: the Bases **map** view is
**out of scope for now**, because the native map view relies on the separate
official **Maps** community plugin. (A future, fully self-contained Astro map
renderer driven only by coordinate frontmatter — needing no Obsidian plugin —
could revisit this later; see §9.) The supported, always-native view types are
**table, cards, and list**.

### Non-goals (initial)
- **Any dependency on non-core / third-party Obsidian plugins.** Core only.
- The Bases **map** view (depends on the external Maps community plugin).
- Mobile support — the plugin spawns Node processes and is inherently
  **desktop-only** (`isDesktopOnly: true`).
- Re-implementing the Bases query/filter/formula language. Obsidian evaluates
  it; we only harvest the results.
- Hosting/deployment service. The build output is the user's to deploy.
- Bidirectional editing (web → vault). The flow is vault → site only.

## 3. Background (verified facts)

The three integration points were verified against current (May 2026) sources:

- **Web Viewer**: a plugin can open any URL in an in-app tab via
  `leaf.setViewState({ type: 'webviewer', state: { url, navigate: true }, active: true })`.
  Web Viewer is a **core plugin that must be enabled**, else links fall back to
  the system browser. Loading `http://localhost` dev URLs is **(unverified)** —
  Electron `<webview>` generally loads localhost fine, but confirm by testing.
- **Bases view API**: stable since **Obsidian 1.10.0** (verified in
  `obsidian.d.ts`). A plugin calls `Plugin.registerBasesView(viewId, registration)`
  (returns `false` if Bases is disabled) and extends `BasesView` (a `Component`)
  implementing `abstract onDataUpdated()`. Inside it:
  - `this.data.data: BasesEntry[]` and `this.data.groupedData: BasesEntryGroup[]`
    (each group: `{ key?: Value; entries: BasesEntry[] }`).
  - `entry.getValue(propertyId): Value | null` — Bases has already applied
    filters and computed formulas; `propertyId` is a prefixed `BasesPropertyId`
    (`note.x`, `formula.y`, `file.z`); errors surface as `ErrorValue`.
  - `entry.file: TFile`, `this.config.getOrder(): BasesPropertyId[]`.
  - `Value` exposes `isEmpty()`, `toString()`, `renderTo()`; `parsePropertyId`
    returns `{ type: file | note | formula, name }`.
- **Astro Node API**: `import { dev, build, preview, sync } from 'astro'`.
  `dev(inlineConfig)` returns a server with `.address` (→ `.port`), `.watcher`,
  and `.stop()`. `build(inlineConfig)` runs a production build. `AstroInlineConfig`
  takes `root`, so the plugin can point Astro at the project in its data folder.
- **Child processes**: Obsidian plugins on desktop can `require('child_process')`
  and spawn long-running processes. **PATH caveat**: macOS GUI apps do not
  inherit the login-shell `PATH`, so `spawn('node'|'npm'|'astro')` commonly
  throws `ENOENT` — resolve absolute binary paths or spawn via `bash -lc`.

## 4. Architecture

The plugin follows **DDD + hexagonal (ports & adapters)** so the domain logic is
pure and testable and every Obsidian / Node touchpoint sits behind an interface.
(See `REQUIREMENTS.md §1` for the rationale and rules.)

```
                         ┌──────────────────────────────────────────┐
                         │                main.ts                    │
                         │  Plugin subclass = composition root        │
                         │  (wires adapters → use-cases in onload)    │
                         └───────────────┬────────────────────────────┘
                                         │ depends on
                ┌────────────────────────▼─────────────────────────┐
                │                  application/                      │
                │  use-cases: HarvestBases, SyncSnapshots,           │
                │  RunDevServer, BuildSite, OpenPreview              │
                │  ports (interfaces): BasesPort, VaultPort,         │
                │  SnapshotWriterPort, AstroProcessPort,             │
                │  WebViewerPort, SettingsPort                       │
                └────────────┬───────────────────────┬───────────────┘
                  depends on │                       │ implemented by
                ┌────────────▼───────────┐  ┌─────────▼──────────────────────┐
                │        domain/          │  │        infrastructure/          │
                │ pure entities & VOs:    │  │ adapters (import obsidian/node):│
                │ BaseSnapshot, ViewSpec, │  │ ObsidianVaultAdapter,           │
                │ EntryRow, PropertyId,   │  │ BasesHarvesterAdapter,          │
                │ SiteSpec, PageRoute     │  │ AstroProcessAdapter,            │
                │ (no obsidian/fs/node)   │  │ WebViewerAdapter,               │
                └─────────────────────────┘  │ FsSnapshotWriter, DataSettings  │
                                             └─────────────────────────────────┘
```

Dependency rule: `domain` imports nothing external; `application` imports only
`domain` and its own ports; `infrastructure` and `main.ts` are the only places
allowed to `import { ... } from 'obsidian'` or touch `child_process`/`fs`.

### 4.1 Data flow

```
 vault .md + frontmatter + .base files / ```base blocks
        │
        │  Bases evaluates filters + formulas  (Obsidian's job)
        ▼
 [BasesHarvesterAdapter]  registered BasesView → onDataUpdated()
        │     reads groupedData, entry.getValue(id), config.getOrder()
        ▼
 domain BaseSnapshot  (pure object: view config + groups + rows)
        │
        ▼
 [FsSnapshotWriter]  one JSON snapshot per base/view, in the plugin
        │            data folder's Astro project (src/data or content)
        ▼
 Astro project (.obsidian/plugins/specorator-astro/astro)
   custom Content Layer loader ingests JSON (watcher → live reload)
   maps snapshot.view.type → Table/Cards/List/Map component
        │
        ├─► [AstroProcessAdapter] astro dev → http://localhost:<port>
        │        └─► [WebViewerAdapter] setViewState 'webviewer' → in-app tab
        └─► [AstroProcessAdapter] astro build → dist/ (publishable static site)
```

The same harvest pipeline also ingests two non-Bases inputs (see §5.7): **page
notes** (individual vault notes designated as website pages) become `PageNode`s,
and a **navigation config** becomes a `NavigationTree`. Bases collections, pages,
and navigation together form the `SiteSpec` that Astro renders into a full site.

The only Obsidian-dependent step is the harvest. Because the static build reads
committed JSON snapshots, **publishing does not require Obsidian running at build
time** once snapshots exist.

## 5. Component design

### 5.1 Harvester (BasesPort → BasesHarvesterAdapter)
Registers a custom Bases view (`registerBasesView`). In `onDataUpdated()` it
walks `this.data.groupedData`; for each entry it reads every property id in
`config.getOrder()` (plus the `groupBy` property) via `entry.getValue(id)`,
normalizes each `Value` (`toString()` / structured extraction), captures
`entry.file.path`, and emits a pure `BaseSnapshot`.

**#1 risk — headless harvesting (unverified).** `onDataUpdated()` only fires for
a view that Obsidian has instantiated with a `QueryController` + `containerEl`,
i.e. a *mounted* view. There is **no documented API to evaluate a Base to data
without a leaf**. Candidate strategies, in order of preference, to be settled by
a Phase-0 spike:
1. Mount the harvest view in a **detached/hidden leaf**, harvest, then detach.
2. Harvest **on demand** when the user opens the preview (acceptable UX).
3. Fallback: parse `.base` YAML ourselves and re-implement filters/formulas —
   heavy, brittle, explicitly a non-goal; last resort only.

### 5.2 Snapshot writer (SnapshotWriterPort → FsSnapshotWriter)
Serializes each `BaseSnapshot` to JSON in the Astro project's data directory.
Uses `normalizePath` for any vault-relative paths and writes via Node `fs` to
the plugin data folder (outside the indexed vault tree, so Obsidian does not
index `node_modules`).

### 5.3 Astro process manager (AstroProcessPort → AstroProcessAdapter)
**Primary approach: spawn a child process** running the project-local Astro
binary (`<astro-project>/node_modules/.bin/astro dev|build`). Rationale: a Vite
dev server is heavy and long-running; isolating it from Obsidian's renderer
process avoids freezing the UI and contains crashes/leaks. The adapter:
- resolves the binary path explicitly (with a `bash -lc` fallback and a
  settings override for the Node/binary path to dodge the macOS PATH issue);
- pins a deterministic `server.port` (or parses the printed URL from stdout);
- pipes stdout/stderr to a plugin output channel for visible build errors;
- **must kill the process in `onunload`** (child processes are not auto-managed).

*Alternative behind the same port*: the in-process Astro Node API
(`dev()/build()` `require`d from the project's `node_modules`). Easier port/
lifecycle access, but runs Vite inside Obsidian's process — kept as a swappable
adapter, not the default.

### 5.4 Web Viewer (WebViewerPort → WebViewerAdapter)
Opens `http://localhost:<port>` in a `webviewer` leaf via `setViewState`.
Guards: check Web Viewer core plugin is enabled; fall back to the system
browser otherwise. Localhost loading is **(unverified)** — Phase-0 spike.

### 5.5 Astro project (template, lives in plugin data folder)
A bundled template Astro project, scaffolded into
`.obsidian/plugins/specorator-astro/astro` on first run, then `npm install`ed.
Contains:
- a **custom Content Layer loader** (Astro 5+) that reads the JSON snapshots
  from a path outside `src/`, validates them with a Zod schema, and registers a
  `watcher.on('change', …)` so rewriting a snapshot triggers a dev re-render;
- a `[...slug].astro` dynamic route driven by `getStaticPaths()` over the
  snapshot collection;
- a view-type dispatch (`{ table: Table, cards: Cards, list: List }[viewType]`);
- `base` config support for serving the build under a subpath.

(No map component: the native Bases map view requires the external Maps plugin,
which is out of scope — see §2.)

`astro-loader-obsidian` is reusable prior art for wikilink/embed resolution if
we render note bodies.

### 5.6 Component & layout management

A first-class goal is that users can manage and customize the Astro
**components and layouts** that render their Bases, without hand-wiring Astro
internals and without their work being clobbered when the bundled template is
upgraded.

**Template vs. user separation (upgrade-safe).** The scaffolded project splits
into two trees:

```
<astro-project>/
  src/
    theme/            # template-owned defaults (overwritten on upgrade)
      layouts/        #   BaseLayout.astro, SiteLayout.astro
      views/          #   Table.astro, Cards.astro, List.astro
      styles/         #   default tokens / CSS
    user/             # user-owned, NEVER overwritten on upgrade
      layouts/        #   custom layouts
      views/          #   custom view components
      components/     #   reusable partials
      theme.css       #   user overrides
    registry.ts       # maps names -> components (see below)
```

Template files carry a version header; on upgrade the plugin replaces `theme/`
and leaves `user/` untouched. A user "ejects" a default by copying it into
`user/` and editing there.

**Registry + resolution.** A generated `registry.ts` maps a **component name**
(string) to an imported `.astro` component, scanning both `theme/views` and
`user/views` with **user entries shadowing template entries of the same name**.
Each snapshot's `view.type` resolves to a component name (default: the view
type itself — `table`/`cards`/`list`), but the assignment can be overridden
per base/view (below). Layouts resolve the same way.

**Assignment (which layout/component renders a given base/view).** Stored in a
plugin-managed **sidecar config** (e.g. `view-bindings.json` in the plugin data
folder), keyed by `{ basePath | codeblock-id, viewName }` → `{ component,
layout }`. We deliberately do **not** rely on adding custom keys to `.base`
files, because Obsidian's Bases editor may not preserve unknown keys
**(unverified)** — the sidecar is authoritative. The snapshot writer copies the
resolved binding into each snapshot so Astro renders deterministically.

**Management affordances:**
- Commands: *Scaffold component/layout from template* (creates a stub in
  `user/`), *Assign layout/component to base view…* (picker over discovered
  names), *Open Astro project / component in file manager*.
- Settings tab: per-base / per-view dropdowns populated from the registry's
  discovered component and layout names.
- **Live editing payoff:** because `astro dev` runs with HMR and the preview is
  a Web Viewer tab, editing any `.astro` component or `theme.css` reflects
  **immediately** in-app — the core "manage components easily" experience.

This keeps customization in plain `.astro`/CSS files (no bespoke DSL), upgrade
-safe, and discoverable through the registry and settings UI.

### 5.7 Pages, navigation & sitemap (full website)

The plugin builds a **complete website**, not just collection views. Three
content types compose the `SiteSpec`:

1. **Collection routes** — Bases-driven (§5.1–5.6): a listing route per base
   view plus optional per-entry detail routes.
2. **Page routes** — **individual vault notes** designated as website pages.
   A note opts in via frontmatter (e.g. `site: true` / a `page` type) or by
   living in a configured "pages" folder. Each becomes a route; one note is the
   **home page** (`/`). Page bodies are markdown, with `[[wikilinks]]` between
   pages and to collection entries resolved to site routes.
3. **Navigation** — a `NavigationTree` of ordered, optionally nested items, each
   pointing at a page or collection route.

**Routing / slugs.** Routes derive from a note's `slug`/`permalink` frontmatter,
falling back to a normalized path/basename (`normalizePath`). The plugin owns a
route table so wikilinks across pages and collections resolve deterministically.

**Navigation sources** (resolved in priority order, all native-friendly):
1. an explicit **navigation config** — a plugin-managed sidecar
   (`navigation.json`) or a designated config note containing an ordered list;
2. **page frontmatter** hints (`nav: { title, order, group }`);
3. derived fallback from the pages folder structure.
The resolved tree is written to a `navigation` snapshot; Astro layouts render it
as the site menu (and breadcrumbs), so the same nav appears across all pages.

**Sitemap.** The build emits a standard `sitemap.xml` via the official
**`@astrojs/sitemap`** Astro integration (configured with the site `site` URL).
Note: this is an **Astro build integration, not an Obsidian plugin**, so it is
permitted under the native-only rule (NFR-NATIVE-3). An in-site, human-readable
"site map" page can also be generated from the route table.

**Harvest additions.** Beyond `BasesHarvesterAdapter`, the `VaultPort` adapter
reads designated page notes (frontmatter + body via `Vault.cachedRead`) into
`PageNode`s and resolves the `NavigationTree`. These join the Bases snapshots in
the Astro project's data directory; pages render through the same registry-based
component/layout system (§5.6).

## 6. Snapshot data model (proposed)

One snapshot per base/view. Shape (illustrative):

```jsonc
{
  "baseId": "books",
  "source": { "kind": "file", "path": "Books/books.base" },   // or kind:"codeblock"
  "view": {
    "type": "cards",
    "name": "Reading list",
    "order": ["file.name", "note.author", "formula.ppu"],
    "groupBy": { "property": "note.status", "direction": "ASC" },
    "options": { "image": "note.cover", "imageFit": "cover", "cardSize": 240 }
  },
  "render": { "component": "cards", "layout": "BaseLayout" },  // resolved binding (§5.6)
  "properties": { "note.author": { "displayName": "Author" } },
  "groups": [
    {
      "key": "Reading",
      "entries": [
        {
          "path": "Books/Dune.md",
          "basename": "Dune",
          "route": "/books/dune",
          "values": {
            "file.name": "Dune",
            "note.author": "Frank Herbert",
            "formula.ppu": "12.50"
          },
          "body": { "format": "markdown", "content": "..." }   // optional
        }
      ]
    }
  ],
  "generatedAt": "2026-05-24T00:00:00.000Z"
}
```

**Note body**: the Bases entry exposes property values, not the note body.
Options (Astro side): (a) ship raw markdown in `body` and render via the
loader's `renderMarkdown` (keeps everything in the data folder, lets us resolve
Obsidian links in the harvester); or (b) point a `glob()` loader at the `.md`
files directly (native, simplest, but bypasses the snapshot pipeline). Decision
deferred to Phase 3.

Alongside per-view base snapshots, the writer emits a **`pages`** snapshot
(one `PageNode` per designated note: route, title, frontmatter, body) and a
single **`navigation`** snapshot (the resolved `NavigationTree`). All three are
consumed by the same Astro Content Layer loaders (§5.7).

## 7. Bases mapping reference

- **View types (native, in scope)**: `table` (columns via `order`, `columnSize`,
  `sort`, `rowHeight`), `cards` (`image`, `imageFit`, `imageAspectRatio`,
  `cardSize`), `list` (markers, nested properties). The `map` view is **out of
  scope** — its native rendering depends on the external Maps community plugin.
- **Property kinds**: `file.*` (name, basename, path, folder, ext, size, ctime,
  mtime, tags, links, properties), note frontmatter (`note.*` / bare), and
  `formula.*`. Value types: string, number, date, list, link, boolean, object,
  plus formula-emitted image/html/icon/duration.
- Some view keys (`columnSize`, `rowHeight`, `cardSize`, `image*`) are
  GUI-emitted but **officially undocumented** — verify against real
  GUI-generated `.base` files when implementing.

## 8. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Headless Bases harvest may require a mounted view | **High** | Phase-0 spike (hidden leaf / on-demand); isolate behind `BasesPort` |
| 2 | Web Viewer loading `localhost` unverified | Med | Phase-0 spike; fall back to system browser |
| 3 | `node`/`npm`/`astro` binary resolution (macOS PATH) | Med | Absolute paths, `bash -lc`, settings override |
| 4 | Toolchain setup friction (Node + npm install) | Med | Bundled template + bootstrap command + clear error surfacing |
| 5 | Bases is young; API/syntax churn | Med | Adapter isolation; pin `minAppVersion`; integration tests |
| 6 | Large-vault build/preview performance | Med | Respect `limit`; incremental snapshot writes |
| 7 | Marketplace review scrutiny (`child_process`, network) | Low/Med | README disclosures; security-minded code; expect manual review |
| 8 | Desktop-only (no mobile) | Accepted | `isDesktopOnly: true`; `Platform` guards |

## 9. Phased roadmap

- **Phase 0 — Foundation + de-risk:** stand up the **agentic development
  environment** first (DDD skeleton, the `verify` gate, ESLint/Prettier/Vitest
  + import-boundary rules, husky hooks, CI, `CLAUDE.md`, SessionStart bootstrap —
  see `REQUIREMENTS.md §10`). Then run the spikes: (a) harvest one Base to JSON
  via a registered view, ideally headless; (b) open `localhost` in the Web
  Viewer; (c) spawn the project-local `astro` binary and capture its URL.
  Go/no-go gate.
- **Phase 1 — MVP:** one `.base` file → table view → JSON snapshot → bundled
  Astro template → `astro dev` → open in Web Viewer, via a manual command.
- **Phase 2 — Live + build + customization:** auto-sync snapshots on data
  change (loader watcher → HMR), cards & list views, settings tab, `astro build`
  command, and the **component/layout system** (§5.6): template/user split,
  registry resolution, per-base/view assignment via sidecar, and scaffold
  commands.
- **Phase 3 — Full website:** standalone **page** notes + home page, the
  **navigation** model/menu, `sitemap.xml` via `@astrojs/sitemap`, note-body
  rendering + cross-page wikilink resolution, multiple bases / code-block bases,
  publish/deploy guidance. (A self-contained Astro map renderer driven only by
  coordinate frontmatter — no Obsidian plugin dependency — could also be
  evaluated here without breaking the native-only rule.)
- **Phase 4 — Release:** docs (TypeDoc), BRAT beta, marketplace submission.

## 10. Open questions
- Can a `BasesView` be mounted headless/offscreen to harvest without a visible
  tab? (Blocks the cleanest UX — Phase-0.)
- Does Obsidian's Web Viewer load `http://localhost` without CSP friction?
- In-process Astro Node API vs child process — confirm memory/UX tradeoff on a
  real vault.
- Note-body rendering: ship markdown in snapshots vs glob the `.md` files.

## 11. Sources

Obsidian: [Bases](https://help.obsidian.md/bases) ·
[Bases syntax](https://help.obsidian.md/bases/syntax) ·
[Bases views](https://help.obsidian.md/bases/views) ·
[Bases functions](https://help.obsidian.md/bases/functions) ·
[Build a Bases view](https://docs.obsidian.md/Plugins/Guides/Build+a+Bases+view) ·
[obsidian-api `obsidian.d.ts`](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts) ·
[Web Viewer](https://help.obsidian.md/plugins/web-viewer) ·
[open Web Viewer programmatically (forum)](https://forum.obsidian.md/t/how-to-open-the-latest-web-viewer-v1-8-3-programmatically/95840) ·
[API access to Bases results (forum request)](https://forum.obsidian.md/t/provide-api-access-to-the-results-of-bases-view/110660) ·
[Bases + Publish: "Not yet" (forum)](https://forum.obsidian.md/t/do-bases-work-with-obsidian-publish/106703) ·
[1.10.0 release notes (Neowin)](https://www.neowin.net/news/obsidian-1100-released-with-new-features-and-improvements-for-bases/) ·
[child_process in plugins (forum)](https://forum.obsidian.md/t/inquiry-about-downloading-and-executing-local-executables-in-obsidian-plugins/89716)

Astro: [Programmatic API](https://docs.astro.build/en/reference/programmatic-reference/) ·
[Content collections](https://docs.astro.build/en/guides/content-collections/) ·
[Content loader reference](https://docs.astro.build/en/reference/content-loader-reference/) ·
[Configuration reference](https://docs.astro.build/en/reference/configuration-reference/) ·
[Islands](https://docs.astro.build/en/concepts/islands/) ·
[astro-loader-obsidian](https://github.com/aitorllj93/astro-loader-obsidian)

Prior art: [Quartz](https://quartz.jzhao.xyz/) ·
[obsidian-export](https://github.com/zoni/obsidian-export) ·
[VaultCMS](https://github.com/davidvkimball/vaultcms) ·
[Obsidian Publish pricing](https://obsidian.md/pricing)
