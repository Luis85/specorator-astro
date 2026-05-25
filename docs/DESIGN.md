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
data source for an **Astro** site. The plugin harvests the _evaluated_ results
of each Base view into JSON, an Astro project renders them with rich, custom
layouts, and the plugin:

- runs `astro dev` and shows the live site **inside Obsidian** via the built-in
  **Web Viewer** — a live "view layer" over your vault while you work; and
- runs `astro build` to produce a **publishable static site** from the same
  pipeline.

### Why this is novel

No existing tool combines these. Quartz, Flowershow, the Digital Garden plugin,
`obsidian-export`, and MkDocs setups all export _raw markdown_ and none are
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
  the bundled template. The component library is **authored as Obsidian-
  compatible notes in a configurable vault folder** (see §5.6).
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
  the system browser. Loading `http://localhost` dev URLs is **verified to work**
  (community plugins serve localhost HTTP and view it in-app via the same
  webview). What is _blocked_ is `file://` (it redirects to the system browser) —
  which does not affect us since we use `astro dev`. The one untested corner is
  whether Vite's HMR websocket (`ws://localhost`) is reachable inside the Web
  Viewer's webview partition — confirm in the Phase-0 spike.
- **Bases view API**: stable since **Obsidian 1.10.0** (verified in
  `obsidian.d.ts`). A plugin calls `Plugin.registerBasesView(viewId, registration)`
  (returns `false` if Bases is disabled) and extends `BasesView` (a `Component`)
  implementing `abstract onDataUpdated()`. Inside it:
    - `this.data.data: BasesEntry[]` and `this.data.groupedData: BasesEntryGroup[]`
      (each group: `{ key?: Value; entries: BasesEntry[] }`).
    - `entry.getValue(propertyId): Value | null` — Bases has already applied
      filters and computed formulas; `propertyId` is a prefixed `BasesPropertyId`
      (`note.x`, `formula.y`, `file.z`); errors surface as `ErrorValue`.
    - `entry.file: TFile`, `this.config.getOrder(): BasesPropertyId[]`, and
      `this.config.getDisplayName(id)` for the column label (use this, **not** a
      `properties[id].displayName` lookup).
    - `Value` exposes `isEmpty()`, `toString()`, `renderTo()`; `parsePropertyId`
      returns `{ type: file | note | formula, name }`.
    - **No headless evaluation.** `QueryController` is an empty, non-constructable
      exported class; there is no `app.bases`/`loadBase` API. The factory fires
      **only when a `.base` is opened in a leaf with this view type selected** — so
      harvesting requires a _mounted_ view (see §5.1). This is an architectural
      constraint, not an unknown.
- **Astro Node API**: `import { dev, build, preview, sync } from 'astro'`.
  `dev(inlineConfig)` returns a server whose port is read via
  `(server.address as AddressInfo).port` (it is a Node `AddressInfo`), with
  `.watcher` and `.stop()`. `build(inlineConfig)` runs a production build;
  `AstroInlineConfig` takes `root`. **Caveat:** this programmatic API is still
  flagged **experimental** (changelog-only stability) — pin Astro and prefer the
  child-process binary + stdout URL parse as the default runner (§5.3).
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
                │  ports (interfaces): BasesPort, SettingsPort,      │
                │  SnapshotWriterPort, AstroProcessPort,             │
                │  WebViewerPort                                     │
                └────────────┬───────────────────────┬───────────────┘
                  depends on │                       │ implemented by
                ┌────────────▼───────────┐  ┌─────────▼──────────────────────┐
                │        domain/          │  │        infrastructure/          │
                │ pure entities & VOs:    │  │ adapters (import obsidian/node):│
                │ BaseSnapshot, ViewSpec, │  │ SettingsStore, SiteSettingTab,  │
                │ EntryRow, PropertyId,   │  │ BasesHarvesterAdapter,          │
                │ SiteSpec, PageRoute     │  │ AstroProcessAdapter,            │
                │ (no obsidian/fs/node)   │  │ WebViewerAdapter,               │
                └─────────────────────────┘  │ FsSnapshotWriter                │
                                             └─────────────────────────────────┘
```

Dependency rule: `domain` imports nothing external; `application` imports only
`domain` and its own ports; `infrastructure` and `main.ts` are the only places
allowed to `import { ... } from 'obsidian'` or touch `child_process`/`fs`.

> **Avoid ceremony.** This plugin's "domain" is mostly data shapes + pure
> transforms (harvest → transform → render), not a rich business model, so the
> _load-bearing_ boundary is **pure core (`domain`+`application`) vs. impure
> `adapters`**. Treat `domain`/`application` as organizational subfolders within
> the pure core, not as two separately-enforced layers, and don't manufacture
> value objects/aggregates the problem doesn't need. The boundary that matters
> is mechanically enforced by **`eslint-plugin-boundaries`** (element types +
> the `boundaries/external` rule that confines `obsidian`/`node:*` imports to
> adapters), with `dependency-cruiser` in CI for cycles/orphans
> (`REQUIREMENTS.md §3`).

### 4.1 Data flow

````
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
   maps snapshot.view.type → Table/Cards/List component
        │
        ├─► [AstroProcessAdapter] astro dev → http://localhost:<port>
        │        └─► [WebViewerAdapter] setViewState 'webviewer' → in-app tab
        └─► [AstroProcessAdapter] astro build → dist/ (publishable static site)
````

The same harvest pipeline also ingests other vault inputs: **page notes**
(individual vault notes designated as website pages) become `PageNode`s, a
**navigation config** becomes a `NavigationTree` (both §5.7), and
**component-library notes** are transpiled into Astro components (§5.6). Bases
collections, pages, and navigation together form the `SiteSpec` that Astro
renders into a full site, using the component library to display it.

**Authoring source vs. build artifacts (the one boundary crossing).** Content
_authored_ by the user lives in the **vault**: notes, `.base` files, page notes,
and **component-library notes** (§5.6). Everything the build _consumes or
produces_ — JSON snapshots, transpiled `src/generated/` components, the bundled
template, `node_modules`, `dist/` — lives in the **plugin data folder**, outside
the indexed vault. The harvest/transpile step is exactly the bridge that reads
vault sources and writes data-folder artifacts (so NFR-3's "outside the indexed
vault" applies to _artifacts_, while _sources_ are vault-resident by design).

The only Obsidian-dependent step is the harvest. Because the static build reads
committed JSON snapshots, **publishing does not require Obsidian running at build
time** once snapshots exist.

## 5. Component design

### 5.1 Harvester (BasesPort → BasesHarvesterAdapter)

**Driven by the plugin settings.** Harvesting is scoped to a **user-curated
inclusion list** (D1/D4) held in the plugin's native settings (`SettingsPort`):
a set of base files, each with the **view(s)** the user chose to publish (D3)
and their routes. The harvester iterates only this list — not the whole vault.

**Trigger (D2).** A manual _Sync site_ command is the baseline; the plugin also
auto-syncs on first preview and offers an optional, **debounced live-resync of
just the base currently being previewed** (kept briefly mounted to avoid
re-flashing), with a toggle to disable.

Registers a custom Bases view (`registerBasesView`). In `onDataUpdated()` it
walks `this.data.groupedData`; for each entry it reads every property id in
`config.getOrder()` (plus the `groupBy` property) via `entry.getValue(id)`,
takes the label from `config.getDisplayName(id)`, normalizes each `Value`
(`toString()` / structured extraction), captures `entry.file.path`, and emits a
pure `BaseSnapshot`.

**Harvest requires a _mounted_ view (architectural constraint, not a spike
unknown).** As established in §3, `onDataUpdated()` fires only for a view
Obsidian itself instantiated in a leaf; there is no headless/offscreen path and
no API to evaluate a base to data. Two further consequences shape the design:

1. **A custom view sees only _its own_ view's evaluated entries** — not the
   user's existing table/cards/list views. So to render a base "as the user
   configured it," the harvester must **read that view's config from the `.base`
   file** (type, `order`, `groupBy`, view-local `filters`) and apply it to our
   harvesting view. Bases still performs all filter/formula **evaluation** (we
   never reimplement the query language) — we only mirror the _view config_.
2. **Triggering evaluation needs a visible leaf.** Realistic patterns (the
   Phase-0 gate chooses the least-intrusive that actually works):
    - **Transient harvest leaf** — programmatically open the base with our view
      type (`setViewState({ type: 'bases', state: { file, viewType: <ourId> } })`),
      await `onDataUpdated`, then `leaf.detach()`. Briefly flashes a tab; and it
      is **unverified that `setViewState` will select a _custom_ Bases view type
      programmatically** — this is the single most important Phase-0 check.
    - **Pinned harvest leaf** — a dedicated tab the user keeps open.
    - **User-added view** — the user adds our view to their base once; we harvest
      whenever it is open. Lowest tech risk, highest user friction.

The clean "silent background harvest" UX is **not** achievable with the current
public API; Phase-0's first question is _which visible-leaf pattern is least
intrusive_, not _whether headless works_.

### 5.2 Snapshot writer (SnapshotWriterPort → FsSnapshotWriter)

Serializes the harvested `BaseSnapshot`s to JSON in the Astro project's data
directory. The port exposes a single `commit(snapshots)` call that **atomically
replaces** the whole set (stage to a temp dir, swap on success) so a sync that
fails partway never leaves a half-written data directory; sequencing is owned by
the writer, not the caller. Uses `normalizePath` for any vault-relative paths
and writes via Node `fs` to the plugin data folder (outside the indexed vault
tree, so Obsidian does not index `node_modules`).

### 5.3 Astro process manager (AstroProcessPort → AstroProcessAdapter)

**Primary approach: spawn a child process** running the project-local Astro
binary (`<astro-project>/node_modules/.bin/astro dev|build`). Rationale: a Vite
dev server is heavy and long-running; isolating it from Obsidian's renderer
process avoids freezing the UI and contains crashes/leaks. The adapter:

- resolves the binary path explicitly (with a `bash -lc` fallback and a
  settings override for the Node/binary path to dodge the macOS PATH issue);
  on **Windows** the binary is `astro.cmd`, so use `shell: true` or the explicit
  `.cmd` path;
- pins a deterministic `server.port` **and** parses the printed dev URL from
  stdout (the authoritative source when running the child-process binary);
- pipes stdout/stderr to a plugin output channel for visible build errors;
- **must kill the whole process _tree_ in `onunload`.** `child.kill()` only ends
  the shell, orphaning Vite's `esbuild`/worker descendants. Spawn `detached:true`
  and kill the group (`process.kill(-child.pid)`) on POSIX; use
  `taskkill /pid <pid> /T /F` (or `tree-kill`) on Windows.

_Alternative behind the same port_: the in-process Astro Node API
(`dev()/build()` `require`d from the project's `node_modules`). Easier port/
lifecycle access, but runs Vite inside Obsidian's process — kept as a swappable
adapter, not the default.

### 5.4 Web Viewer (WebViewerPort → WebViewerAdapter)

Opens `http://localhost:<port>` in a `webviewer` leaf via `setViewState`.
Loading localhost is **verified to work** (§3). Guards: check the Web Viewer
core plugin is enabled (fall back to the system browser otherwise), and confirm
Vite's HMR websocket reaches the webview partition — the one remaining Phase-0
check for this path.

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
    generated/        # transpiled FROM the vault component library (regenerated)
      views/ layouts/ components/
    user/             # advanced: hand-written .astro, NEVER overwritten
      layouts/ views/ components/ theme.css
    registry.ts       # maps names -> components (see below)
```

Template files carry a version header; on upgrade the plugin replaces `theme/`
and leaves `generated/` (rebuilt from the vault) and `user/` untouched.

**Vault-hosted component library (component notes).** The primary authoring
surface is **inside the vault**, not the Astro project. On install the user
sets a **component library folder** (a plugin setting). Each component is a
**fully Obsidian-compatible frontmatter markdown note** in that folder (the
outer fence below is `~~~` only so the inner ` ``` ` renders — the real note
uses normal markdown):

````markdown
---
component:
    name: BookCard # registry name
    kind: view # view | layout | partial
    appliesTo: [cards] # base view types, or "page" / "layout"
    props: [cover, author] # declared inputs (optional, for typing/docs)
---

```astro
---
const { entry } = Astro.props;
---
<article class="book">
  <img src={entry.values["note.cover"]} alt="" />
  <h3>{entry.values["file.name"]}</h3>
  <p>{entry.values["note.author"]}</p>
</article>
```
````

The note stays valid Obsidian markdown (it renders harmlessly as frontmatter +
a fenced code block). The harvester reads each component note, **extracts the
fenced ` ```astro ` block as the template** and the frontmatter as metadata, and
**transpiles** it into a real `.astro` file under `src/generated/` (write the
block verbatim, prepending a generated props script).
Because authoring is plain markdown, components are versioned, synced, searched,
and linked like any other note. The component-library folder is **excluded from
page detection** (§5.7) so components never become website pages.

> **This is build-time code execution — no sandbox.** A ` ```astro ` block
> becomes a real module Vite/Node runs at build time; it can `import`, read
> files, spawn processes — exactly like source. The trust boundary is the **vault
> author** (trusted). The real risk is _importing untrusted component notes_
> (synced/shared/downloaded) — the same class as the next-mdx-remote RCE. There
> is no honest way to sandbox build-time Node, so the mitigation is **explicit
> consent + disclosure**, not a fake sandbox (see §5.10). A **safe default
> exists**: the bundled `theme/` components are fixed, Zod-prop-validated, and
> need no author code — code-fence components are the **power-user** layer for
> those who accept the trade-off. Most users get full customization (props,
> theme CSS, layout assignment) without ever writing executable component code.

> Authoring-format decision **(decided)**: a fenced ` ```astro ` code block is
> the authoring method. Code fences are the native, correct way to embed
> non-markdown content in a vault note — they keep the note fully Obsidian-valid,
> give full Astro power, and need only trivial transpilation. (A future
> "simple mode" with templated-markdown bindings may be layered on top, but the
> fence is the canonical surface.)

**Adding a component.** Two affordances, so the fence is effortless to reach:

- **Right-click / context menu** — via the `editor-menu` workspace event the
  plugin adds _Insert Astro component block_ (drops a ready-to-edit ` ```astro `
  fence at the cursor) and, when the cursor is in a component note,
  _Register as component / Create component here_. A `file-menu` entry on the
  library folder offers _New component note_.
- **Command palette** — a _Create component_ command scaffolds a new component
  note (frontmatter + stub fence) in the library folder.

On save, the plugin re-transpiles the note into `src/generated/`. **HMR caveat
(Astro 6):** _editing_ an existing generated component hot-reloads, but a
**newly created** `.astro` file is a known Astro/Vite limitation — new files
aren't picked up until the dev server restarts. So _Create component_ (a new
file) triggers a programmatic dev-server restart (`stop()` + re-`dev()`); the
cleaner long-term approach is to expose components through a **stable virtual
module / registry barrel** so the file set never changes and only contents do.
Note this is distinct from the Content Layer `watcher` (§5.5), which reloads
**data** snapshots only — it does **not** recompile `.astro` source.

**Registry + resolution.** A generated `registry.ts` maps a **component name**
(string) to an imported `.astro` component, scanning `generated/` (from vault
notes), `user/`, and `theme/`. Precedence on name collision:
**vault component note → hand-written `user/` → `theme/` default.** Each
snapshot's `view.type` resolves to a component name (default: the view type
itself — `table`/`cards`/`list`), overridable per base/view (below). Layouts
resolve the same way.

**Assignment (which layout/component renders a given base/view).** Stored in the
**plugin settings** (D4 — not a data-folder sidecar and not in the `.base`
file, whose editor may drop unknown keys), keyed by `{ basePath | codeblock-id,
viewName }` → `{ component, layout, route }`. The settings are the single
source of truth for the inclusion list, per-view selection, routes, bindings,
navigation, and the `site` URL; the snapshot writer copies the resolved binding
into each snapshot so Astro renders deterministically.

**Management affordances:**

- Commands: _Scaffold component/layout from template_ (creates a stub in
  `user/`), _Assign layout/component to base view…_ (picker over discovered
  names), _Open Astro project / component in file manager_.
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
route table — the single source of truth for collision detection across the
shared `[...slug]` namespace. `[[wikilinks]]` are resolved **in the
harvester/loader against that route table** (Astro has no built-in wikilink
resolver), not at render time. Newly _designating_ a note as a page is fine for
`astro build` but, like new components, needs a dev-server restart to appear.

**Navigation (D14).** The **primary, authoritative** source is an ordered,
nestable nav list **curated in the plugin settings**, with an
_add to nav_ helper when a base/page is included. Page frontmatter hints
(`nav: { title, order, group }`) and folder structure are offered only as
optional auto-suggestions, never the primary source (inferred nav is brittle).
The resolved tree is written to a `navigation` snapshot; Astro layouts render it
as the site menu (and breadcrumbs), so the same nav appears across all pages.

**Sitemap.** The build emits a standard `sitemap.xml` via the official
**`@astrojs/sitemap`** Astro integration (an **Astro build integration, not an
Obsidian plugin** — permitted under NFR-NATIVE-3). It requires `site` set to an
`http(s)` URL and **crawls statically-generated routes** (including `[...slug]`
via `getStaticPaths`), so the project **must stay `output: 'static'`** (it is);
non-enumerated routes go in `customPages`. Caveat: some `@astrojs/*` integrations
shipped Astro-6 peer ranges that npm rejects — the bootstrap (§5.9) may need
`--legacy-peer-deps`; verify the pinned `@astrojs/sitemap` peer range at install.
An in-site human-readable "site map" page can also be generated from the route
table.

**Harvest additions & markdown body.** Beyond `BasesHarvesterAdapter`, a
dedicated page-loader adapter (phase 2) reads designated page notes into
`PageNode`s; the `NavigationTree` is resolved from the settings-defined nav list. For **page bodies**, prefer pointing a `glob()` loader at the
`.md` files (native, simplest) over embedding markdown in snapshots; reserve
snapshot-embedded `body` for where Bases-resolved values are needed. Obsidian-
flavored markdown is only partially portable: `astro-loader-obsidian` resolves
`[[wikilinks]]`/`![[embeds]]` but **not** callouts, block refs, transclusions, or
Dataview — add a remark/rehype plugin for callouts and accept that full Obsidian
fidelity is out of scope. Pages render through the registry-based component/
layout system (§5.6).

### 5.8 Asset pipeline

Card covers (`note.cover`), inline images, and `![[embeds]]` point at **vault
attachments** (vault-relative paths or wiki-embeds). The build must make these
reachable to Astro. The harvester resolves each referenced attachment via the
metadata cache, **copies (or hard-links) it into the Astro project's `public/`**
under a stable path, and **rewrites the `src`/embed reference** in snapshots and
page bodies to that public URL. Decisions: dedupe by content hash; copy only
referenced attachments (not the whole vault); leave optimization to Astro's
`<Image>`/assets where feasible, else serve as-is. Missing attachments degrade
to a placeholder with a build warning rather than failing the build.

### 5.9 Bootstrap & first run

First run scaffolds the template into the data folder and installs dependencies
— the make-or-break first experience. Design points:

- **Toolchain detection first.** A **system Node is a documented prerequisite**
  (D10 — no bundled/auto-downloaded runtime). Probe for Node/npm (using the NFR-4
  resolution); if absent, show actionable install guidance and a settings field
  for the Node path — never fail silently.
- **Install UX.** Run `npm install` (with `--legacy-peer-deps` if the pinned
  integrations require it, §5.7) via the process adapter, streaming progress to a
  visible panel; the install is large and slow, so it is explicit and cancelable.
- **Offline / partial failure.** Detect no-network and explain; make bootstrap
  **idempotent and resumable** (re-run safely after a partial failure) rather
  than leaving a half-installed project.
- **Bundled vs fetched.** The template source is bundled with the plugin;
  `node_modules` is fetched on first run (bundling them is impractical). Record
  this trade-off so the network dependency is expected, not surprising.

### 5.10 Security & trust model

- **Trust boundary.** The **vault author is trusted**; the plugin runs their
  content. The threats are (a) **component notes authored by someone else**
  (synced, shared, downloaded) — which become **build-time code execution**
  (§5.6) — and (b) **supply chain** via `npm install`.
- **No sandbox claim.** Build-time Node cannot be honestly sandboxed; the plugin
  must not pretend otherwise.
- **Mitigations.** Enabling the code-fence component library requires **one-time
  explicit consent**; the safe `theme/` components (Zod-validated, no author
  code) are the default. The README **discloses** network use, file access
  outside the vault, and that component notes execute at build time (NFR-6 /
  marketplace requirements). `child_process` only ever spawns the project-local
  toolchain, never content-derived commands.
- **Data-loss safety.** Regeneration only ever writes `src/generated/`; it
  **never deletes** vault content or hand-written `user/` files. Uninstall
  cleanup of the (large) data-folder project is offered, gated behind
  confirmation.

## 6. Snapshot data model (proposed)

One snapshot per base/view. Shape (illustrative):

```jsonc
{
	"baseId": "books",
	"source": { "kind": "file", "path": "Books/books.base" }, // or kind:"codeblock"
	"view": {
		"type": "cards",
		"name": "Reading list",
		"order": ["file.name", "note.author", "formula.ppu"],
		"groupBy": { "property": "note.status", "direction": "ASC" },
		"options": { "image": "note.cover", "imageFit": "cover", "cardSize": 240 },
	},
	"render": { "component": "cards", "layout": "BaseLayout" }, // resolved binding (§5.6)
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
						"formula.ppu": "12.50",
					},
					"body": { "format": "markdown", "content": "..." }, // optional
				},
			],
		},
	],
	"generatedAt": "2026-05-24T00:00:00.000Z",
}
```

**Note body (decision).** The Bases entry exposes property values, not the note
body. **Page bodies** (§5.7) render via a `glob()` loader over the `.md` files
(native, simplest). The snapshot-embedded `body` field is used only where a
**collection entry** needs its body rendered alongside Bases-resolved values;
when used, the harvester ships markdown and resolves Obsidian links against the
route table before write.

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

| #   | Risk                                                                      | Severity | Mitigation                                                                                                                   |
| --- | ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Harvest needs a _mounted_ view; no headless API (constraint, not unknown) | **High** | Visible transient/pinned leaf (§5.1); Phase-0 picks least-intrusive; verify programmatic custom-`viewType` selection         |
| 2   | Code-fence component notes = **build-time code execution** (RCE class)    | **High** | Safe Zod-validated `theme/` default; arbitrary `.astro` behind one-time consent; README disclosure; no sandbox claim (§5.10) |
| 3   | Astro HMR doesn't pick up **new** files (new component/page)              | Med      | Dev-server restart on create; stable virtual-module/registry barrel (§5.6)                                                   |
| 4   | `node`/`npm`/`astro` binary resolution; process-tree kill; Windows `.cmd` | Med      | Abs paths, `bash -lc`, settings override; kill process group / `taskkill` (§5.3)                                             |
| 5   | Toolchain friction (Node + slow/offline `npm install`)                    | Med      | Idempotent, resumable bootstrap; visible progress; toolchain probe (§5.9)                                                    |
| 6   | Bases young; GUI-emitted view keys undocumented                           | Med      | Read defensively; adapter isolation; contract-test fixtures; pin `minAppVersion`                                             |
| 7   | Large-vault performance; `onDataUpdated` re-fires often                   | Med      | Respect `limit`; **debounce** re-harvest; incremental writes                                                                 |
| 8   | Astro programmatic API + `@astrojs/*` peer ranges experimental/strict     | Low/Med  | Pin Astro; child-process + stdout parse; `--legacy-peer-deps` if needed                                                      |
| 9   | Marketplace review scrutiny (`child_process`, network, exec)              | Low/Med  | Disclosures; security-minded code; expect manual review                                                                      |
| 10  | Strategic: native Bases-in-Publish is on Obsidian's roadmap               | Med      | Lead on the unoccupied wedge (live in-Obsidian preview + Astro design + self-host)                                           |
| 11  | Desktop-only (no mobile)                                                  | Accepted | `isDesktopOnly: true`; `Platform` guards                                                                                     |

## 9. Phased roadmap

> **MVP wedge.** The smallest lovable product proves the one thing nobody else
> does: **a Base, rendered well, live, inside Obsidian, that also builds to a
> static site.** Everything below the MVP line is real but explicitly _post-
> validation_ — do not build the full website builder before proving the wedge.

- **Phase 0 — Foundation + de-risk:** stand up the **agentic development
  environment** first (core/adapters skeleton, the `verify` gate,
  ESLint/Prettier/Vitest + boundary rules, husky hooks, CI, `AGENTS.md`,
  SessionStart bootstrap — see `REQUIREMENTS.md §10`). Then run the spikes that
  gate everything: (a) **least-intrusive harvest** — open a base in a transient
  leaf with our view type and confirm `setViewState` selects a _custom_ Bases
  `viewType` programmatically and `onDataUpdated` fires; (b) confirm Vite's HMR
  websocket works inside the Web Viewer; (c) spawn the project-local `astro`
  binary, parse its URL, and kill the process tree cleanly. Go/no-go gate.
- **Phase 1 — MVP:** curated inclusion list in native settings → one `.base` →
  **table + cards** collection **plus per-entry detail pages** (core-fidelity
  bodies + the **asset pipeline**, §5.8) → JSON snapshots → bundled **safe**
  Astro template (Zod-validated, no author code, one token theme) → transient
  harvest (hybrid trigger) → `astro dev` → open in Web Viewer; live resync on
  data change (the "wow"); `astro build` → `dist/` + export.
- **Phase 2 — Customization:** settings tab, list view, per-base/view component
  & layout **assignment** (sidecar), the **vault-hosted code-fence component
  library** behind one-time consent (§5.6/§5.10), _Create component_ + right-
  click affordances.
- **Phase 3 — Full website (post-validation):** standalone **page** notes + home
  page, the **navigation** menu (model decided, D14), `sitemap.xml` + site-URL
  SEO, cross-page wikilink resolution, multiple / code-block bases. (A
  self-contained Astro map renderer from coordinate frontmatter — no Obsidian
  plugin — could be evaluated here without breaking the native-only rule.)
- **Phase 4 — Release:** docs (TypeDoc), BRAT beta, marketplace submission.

## 10. Open questions

Resolved by the deep review: headless harvest is **impossible** (use a mounted
leaf, §5.1); Web Viewer **loads localhost** (§3); page note-body rendering uses
**`glob()`** (§6). Still open:

- Will `setViewState` select a **custom** Bases `viewType` programmatically so a
  transient harvest leaf works without the user clicking the view? (The single
  most important Phase-0 check — if not, harvest UX degrades to "user adds/opens
  the view once".)
- Is reading a native view's **view-local `filters`/`order`/`groupBy`** from the
  `.base` enough to reproduce that view exactly via our harvesting view?
- New-component delivery: programmatic dev-server **restart** vs **virtual
  module / registry barrel** — which is more robust under Astro 6?
- In-process Astro Node API vs child process — memory/UX trade-off on a real
  vault (child process is the default; confirm the in-process adapter is worth
  keeping).

## 11. Decisions log (interview)

Decisions resolved interactively (supersede earlier open questions where they
conflict; full integration into the sections above is pending):

- **D1 — Curated inclusion list.** Harvest is driven by a **user-curated list of
  base files** the user adds to the site; the transient harvester iterates that
  list (not whole-vault auto-discovery). Refines §5.1.
- **D2 — Trigger = hybrid.** Manual "Sync site" baseline + auto-sync on first
  preview + optional **debounced live-resync of only the actively-previewed
  base** (kept briefly mounted to smooth updates); toggle to disable.
- **D3 — View granularity.** List is base **files**; per base the user picks
  which view(s) to publish (default = the base's default view); each selected
  `(base, view)` → its own route.
- **D4 — Native settings (revised).** Site configuration (inclusion list,
  per-view selection, routes, component/layout bindings, navigation, site URL)
  lives in the plugin's **native settings**, edited via the settings tab and
  persisted through Obsidian's data API (`loadData`/`saveData`). _Supersedes the
  earlier vault config note (`Site/site.md`), which in turn absorbed the
  `view-bindings.json`/`navigation.json` sidecars._ Config is schema-versioned
  with forward migration (NFR-8).
- **D5 — Single site (v1).** One settings document → one Astro project → one
  preview/build; architecture leaves room for multiple sites later.
- **D6 — Build output.** `astro build` → `dist/` in the plugin data folder +
  an **"Export/Reveal build"** action; manual deploy to any host; deploy
  _guidance_ stays Phase 3.
- **D7 — Detail pages from the start.** Each base entry gets its own generated
  detail page. **Consequence: note-body rendering + the asset pipeline (FR-16)
  move into the MVP** (no longer Phase 3).
- **D8 — Core markdown fidelity.** Bodies render markdown + frontmatter,
  `[[wikilinks]]`/`![[image embeds]]` resolved to routes/assets, callouts via a
  remark/rehype plugin; block refs, transclusions, Dataview **out of scope v1**.
- **D9 — One theme + CSS tokens.** A single polished default theme driven by
  CSS-variable tokens (light/dark, responsive), overridable via one user
  `theme.css`; deeper changes via the component system. Component delivery uses a
  **stable virtual-module/registry barrel** (sidesteps Astro's new-file HMR gap).

- **D10 — Require system Node.** Node is a documented prerequisite; bootstrap
  detects + guides (path-override setting); no bundled runtime. Deps via `npm`
  on first run; no pre-vendored `node_modules`; offline fails gracefully.
- **D11 — Component consent.** Safe parameterized `theme/` components are the
  default; the build-time-executing **code-fence library is opt-in behind
  one-time consent**; right-click insertion works within the library folder.
- **D12 — Pragmatic ports & adapters.** Two enforced zones — pure `core/`
  (domain + use-cases + ports) and `adapters/` — boundaries machine-enforced
  (`eslint-plugin-boundaries`). Confirms the §4 architecture.
- **D13 — MIT license.**
- **D14 — Explicit navigation.** Nav is an ordered, nestable list curated in the
  plugin settings (single source of truth) with an "add to nav" helper;
  frontmatter/folder structure only as optional suggestions.

- **D15 — Distribution.** BRAT beta first; submit to the community marketplace
  after the risky surfaces harden (matches Phase 4).
- **D16 — Site URL.** A `site` URL in the plugin settings; optional for
  dev/preview (localhost origin), required at `astro build` to emit `sitemap.xml`
    - canonical/OG (warn-don't-fail if missing).
- **D17 — Unpublished links.** Wikilinks to notes not on the site render as plain
  text (styled "not published") + a build-warning list; targets are **never
  auto-included** (privacy-safe, self-contained).

- _(D18 intentionally unused — a draft decision was folded into D19 before
  ratification; the number is retained as a gap so existing D19 cross-references
  in REQUIREMENTS.md and source comments stay stable.)_

- **D19 — Ratified defaults.** Plugin `id: specorator-astro-viewer`, name
  **"Specorator Astro Viewer"** ("Specorator" alone is reserved for a separate
  plugin); package manager **npm**; dev port **4321** (auto-fallback if busy, configurable);
  default vault layout under **`Site/`** (`Site/components`, `Site/pages`) for
  authoring, all configurable (site config now lives in **native settings**, D4);
  **`AGENTS.md` canonical** with
  `CLAUDE.md` symlinked; **Conventional Commits** + commitlint + release-please +
  Dependabot; required CI checks = typecheck, lint, format:check, test:coverage,
  build; config/settings schema **versioned with forward migration**.

**Revised MVP (per D7):** one base → **table + cards** collection **plus
per-entry detail pages** (core-fidelity bodies + assets) → curated list in
native settings → transient harvest (hybrid trigger) → safe default theme → live
preview in Web Viewer → `astro build` to `dist/` + export.

## 12. Sources

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
[VaultCMS / Astro Suite](https://davidvkimball.com/posts/astro-suite-for-obsidian/) ·
[Obsidian Publish pricing](https://obsidian.md/pricing) ·
[Obsidian roadmap](https://obsidian.md/roadmap/)

Review pass (2nd): [Astro programmatic API (experimental)](https://docs.astro.build/en/reference/programmatic-reference/) ·
[Astro new-file HMR issue #15333](https://github.com/withastro/astro/issues/15333) ·
[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) ·
[Astro v6 upgrade (Node ≥22.12, Zod 4)](https://docs.astro.build/en/guides/upgrade-to/v6/) ·
[safe-mdx (allowlist pattern)](https://github.com/holocron-hq/safe-mdx) ·
[next-mdx-remote RCE CVE-2026-0969](https://advisories.gitlab.com/pkg/npm/next-mdx-remote/CVE-2026-0969/) ·
[eslint-plugin-boundaries](https://www.npmjs.com/package/eslint-plugin-boundaries) ·
[AGENTS.md standard](https://agents.md)
