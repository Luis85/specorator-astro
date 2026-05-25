# CONTEXT.md — glossary

Shared vocabulary for this project. Use these terms consistently in code,
comments, and discussion.

## Domain terms

- **Base** — an Obsidian Bases definition (a `.base` file, or a ` ```base ` code
  block) that queries notes by frontmatter into table/cards/list views.
- **View** — one named view inside a base (a table, cards, or list). Map views
  are out of scope (they need the external Maps plugin).
- **Harvest** — capturing a view's _evaluated_ entries (post-filter,
  post-formula) by mounting a custom Bases view and reading `onDataUpdated`.
  There is no headless evaluation API; harvesting needs a mounted leaf.
- **Transient leaf** — a briefly-opened, auto-closed tab used to mount a base
  and harvest it.
- **Harvesting view** — the plugin's own namespaced custom Bases view
  (`registerBasesView`), mounted in a transient leaf only so Obsidian evaluates
  the base and fires `onDataUpdated`; it renders nothing.
- **View-config mirroring** — reproducing the user's chosen native view by
  reading that view's `type`/`groupBy`/`order` from the `.base` (Bases still
  evaluates the filters/formulas; the plugin never reimplements the query
  language). Unsupported types (e.g. map) fall back to `table`.
- **Inclusion list** — the user-curated set of `(base, view)` targets to publish.
- **Site config** — the single source of truth, managed in the plugin's
  **native settings** (settings tab) and persisted via Obsidian's data API:
  inclusion list, per-view selection, routes, component/layout bindings,
  navigation, and the site URL.
- **Snapshot** — the JSON the harvester writes for one `(base, view)`, consumed
  by the Astro project.
- **Sync** — harvesting every included target and **atomically committing** the
  resulting snapshots as one set (the `SyncSite` use-case); the writer owns the
  clear+write so a partial failure never leaves a half-written site.
- **Preview** — starting the Astro dev server and opening it in the Web Viewer
  (the `PreviewSite` use-case). The full preview flow it composes is _ensure
  project → guard core plugins → auto-sync (first preview only) → start dev →
  open Web Viewer_.
- **Auto-sync on first preview** — the preview flow harvests once before
  starting the dev server so the preview reflects current data, latched
  per-session in `PreviewSite` so subsequent previews don't re-sync (D2; FR-20).
- **Build** — producing a deployable static site with `astro build` (the
  `BuildSite` use-case behind `AstroProcessPort.build()`). The flow it composes
  is _guard core plugins (Bases only — build never previews) → ensure project →
  auto-sync → `astro build` → `dist/`_. Unlike preview it **re-syncs on every
  build** (no session latch) so the produced `dist/` always reflects current
  Bases data; a non-zero `astro build` exit propagates as a failure the root
  shows as a Notice (FR-6, FR-22; D6).
- **Build output & export** — `astro build` always writes `dist/` _inside_ the
  data-folder project (NFR-3). The **Export/reveal build** action
  (`BuildExportPort` → `BuildExportAdapter`) copies that `dist/` into the
  user-chosen **export location** (the optional `export.exportPath` setting,
  FR-8) and reveals it in the OS file manager for manual deploy (FR-22; D6). The
  copy **copies into** the destination (recursive `node:fs` `cp`) and never
  deletes anything already there (NFR-9); reveal goes through Electron's `shell`,
  resolved defensively. The composition root makes only the thin guards (unset
  destination, missing build), each surfaced as a Notice.
- **Live re-sync trigger** — the pure debounce/decision state machine
  (`LiveResyncTrigger`) for re-syncing the actively-previewed base on data
  changes: given change events + a quiet window + the `sync.liveResync` toggle,
  it decides _whether/when_ to fire (rapid edits collapse to one fire; only the
  previewed base counts). The Obsidian event subscription + wall-clock timer are
  the adapter/`main.ts`'s thin job; the decision is core (D2; FR-20).
- **Core-plugins guard** — the pure FR-10 decision (`checkCorePlugins`) that,
  given whether **Bases**/**Web Viewer** are enabled and which an operation
  requires, returns a clear Notice message; the raw plugin-state read is the
  thin `CorePluginsPort` → `CorePluginsAdapter` (Obsidian's `internalPlugins`).
- **User-facing error** — a `UserFacingError` thrown by a use-case when a
  user-fixable precondition fails (e.g. a disabled core plugin); the composition
  root shows its message verbatim as a `Notice` instead of "see console."
- **Publish target** — one `(base, view)` to publish; **resolved target** adds a
  concrete route + component/layout after planning.
- **Component note** — a fully Obsidian-compatible frontmatter markdown note in
  the configurable **component-library folder** (default `Site/components`,
  FR-11f) authoring an Astro component: a `component:` frontmatter block
  (`name`/`kind`/`appliesTo`/`props`) + exactly one ` ```astro ` code-fence. It
  renders harmlessly in Obsidian and is **transpiled** into a real `.astro` under
  `src/generated/` (the fence verbatim + a prepended generated props script).
  Opt-in: it **executes at build time** with no sandbox, so transpilation is
  hard-gated by one-time **consent** (D11; §5.6).
- **Component transpiler** — the pure `component-transpile.ts`
  (`transpileComponentNote`): raw note markdown → either a `TranspiledComponent`
  (its generated `.astro` path under
  `src/generated/{views,layouts,components}/<Name>.astro` plus the file contents)
  or a `SkippedNote` carrying a reason. A note that is not a well-formed component
  (no `component:` frontmatter, no `name`, not exactly one ` ```astro ` fence,
  malformed metadata) is **skipped, never thrown** (FR-11g), so a stray note
  neither emits a module nor crashes the sync. The `generated` tier it targets
  shadows `user/` then `theme/` (FR-11j). The vault read + the `src/generated/`
  write are the `ComponentLibraryTranspilePort`/adapter's job.
- **Consent gate** — the pure `consent.ts` (`shouldTranspileLibrary`) over a
  persisted, revocable `ConsentState` (`granted` + advisory `grantedVersion`/
  `grantedAt`), held in the versioned settings `library.consent` (default NOT
  granted, **fail-closed** in `migrate()`). It is the load-bearing FR-18/D11
  mitigation: build-time Node can't be honestly sandboxed, so the `TranspileLibrary`
  use-case **no-ops before any I/O** when consent is absent/revoked — no `.astro`
  is generated or executed; only an explicit `granted === true` opens it. The
  `ConsentModal` (no sandbox claim) + settings toggle grant/revoke it.
- **Leakage predicate** — the pure `isComponentLibraryNote(path, libraryFolder)`
  (FR-11i) that excludes component-library notes from page detection so they
  never become website pages; an empty library folder matches nothing
  (exclusion is opt-in). The C13 page-loader consumes this seam.
- **Snapshot loader** — the template's custom Astro Content Layer loader
  (`src/content/loader.ts`) that reads the committed data dir (`<project>/data/`,
  resolved from `config.root`, outside `src/`), validates each snapshot against
  the **Zod 4** `snapshotSchema`, and feeds the `snapshots` collection. Each
  entry's id is its authoritative listing `route`. In dev it registers a
  `watcher.on('change'/'add', …)` over the data dir so re-syncing live-reloads
  the preview (FR-7); this reloads **data** only, not `.astro` source.
- **Standalone page** — a website page backed by an individual designated vault
  note (FR-12; DESIGN §5.7), distinct from a Bases-driven collection. A note is
  _designated_ either by living in the configured pages folder (default
  `Site/pages`) OR by an opt-in frontmatter flag (`site:true`/`type:page`/
  `page:true`) — and never if it's a component-library note (the _leakage
  predicate_, FR-11i). Exactly one designated note may be the **home page**
  (`/`); first-wins on conflicts. The pure decisions (`pages.ts`:
  `isDesignatedPage`/`derivePageRoute`/`buildPageNodes`) live in core.
- **PageNode** — the committed shape of one standalone page (`{ path, route,
title, isHome, frontmatter, body? }`). Its `route` joins the **global** route
  table alongside listing/detail routes, so page↔page and page↔collision are
  detected once and page-body `[[wikilinks]]` resolve against the same table
  (`resolveSiteBodies`). The writer commits the set to `data/pages.json` in the
  **same atomic swap** as the snapshots (FR-3/FR-12); a body-less page renders
  title-only.
- **Page loader** — the thin I/O seam (`PageLoaderPort` / `PageLoaderAdapter`)
  that scans markdown notes and supplies the raw candidate notes (path +
  frontmatter + frontmatter-stripped body) the pure `buildPageNodes` decides
  designation over. It pre-filters to the pages folder + flagged notes for
  efficiency (a superset is harmless — designation is re-decided in core).
- **Pages loader** — the template's sibling Content Layer loader (`pagesLoader`
  in `src/content/loader.ts`) that reads `data/pages.json`, validates each
  PageNode against the **Zod 4** `pageNodeSchema`, and feeds the `pages`
  collection (entry id = the page `route`). The home page (`/`) renders via
  `index.astro`; non-home pages render through `[...slug].astro` and the `page`
  view — so the static `/` never collides with the dynamic catch-all.
- **Navigation (curated menu)** — an **ordered, nestable** site menu curated in
  settings (`NavConfig`: a tree of `NavItem` = `{ title, route?, children? }`).
  The settings list is the **authoritative** source (D14); page-frontmatter
  `nav` hints + folder structure are optional suggestions only (a documented
  seam, not implemented as required). Curation edits are pure
  (`core/navigation.ts`: `addNavItem`/`removeNavItem`/`moveNavItem`/
  `updateNavItem`, addressing items by an index-trail `NavPath`); the settings
  tab is the thin adapter, plus an **add-to-nav** command that appends the
  active note (route derived via the page helpers).
- **Navigation resolution** — the pure `resolveNavigation(navConfig, knownRoutes)`
  (`core/navigation.ts`) folds the curated config into a resolved
  **NavigationTree** (`NavNode` = `{ title, route?, children }`): it normalizes +
  validates each route against the site's known routes (every placed
  listing/detail/page route, exposed by `resolveSiteBodies`), keeps an off-site
  item as a **label** (route cleared) with a warning — curation is never silently
  lost — and drops blank-title items. `SyncSite` runs it and the writer commits
  the tree to `data/navigation.json` in the **same atomic swap** as snapshots +
  pages (FR-13).
- **Breadcrumbs** — the ancestor trail for a route, `breadcrumbsFor(route, tree)`
  (pure core, mirrored template-side in `src/theme/navigation.ts`): the chain of
  resolved nodes from the top of the tree down to the matching node, with a
  synthetic **home** crumb (`/`) leading every non-home trail; an off-menu route
  falls back to just `[Home]`. `BaseLayout` renders the menu (`NavMenu.astro`,
  recursive, `aria-current` on the active item) + breadcrumbs (`Breadcrumbs.astro`)
  on **every** page from the `navigation` collection, so navigation is consistent
  site-wide.
- **Navigation loader** — the template's third Content Layer loader
  (`navigationLoader` in `src/content/loader.ts`) that reads `data/navigation.json`,
  validates the tree against `navigationTreeSchema`, and stores it under one fixed
  id (`'site'`) so `BaseLayout` reads it once per page.
- **Registry barrel** — the template's `src/registry.ts`, a single stable module
  mapping a component/layout **name** → an imported `.astro` component
  (`resolveView`/`resolveLayout`). The typed `theme/` defaults are the base; it
  then overlays `import.meta.glob`-discovered `user/` then `generated/`
  components, so a same-named user (or vault) component **shadows** the theme
  default at render time (FR-11b/j). Keeping every component behind one barrel
  keeps the file set stable so adding a component never trips Astro's new-file
  HMR gap (D9).
- **View dispatch** — the `[...slug].astro` route emits one static listing page
  per snapshot via `getStaticPaths()` and renders it with the registry component
  named by `render.component`, defaulting to the view `type` (`table`/`cards`/
  `list`) when the binding is `'auto'`.
- **Registry tiers & precedence** — components/layouts are discovered across
  three tiers — `theme/` (bundled defaults), `user/` (hand-written `.astro`,
  never overwritten), and `generated/` (transpiled vault notes, the C12 seam).
  On a name collision the precedence is **`generated` → `user` → `theme`**
  (FR-11j). The pure `resolveRegistry` (`core/domain/registry.ts`) folds the
  per-tier names into a deduped, sorted available-name list recording the winning
  tier per name; the fs scan that produces the per-tier names is the
  `RegistryPort`/`RegistryAdapter`.
- **Assignment resolution** — which component/layout renders a `(basePath,
viewName)` is stored in the plugin settings as the optional
  `PublishTarget.component`/`layout` (the sidecar, D4 — not the `.base` file).
  The pure `resolveBinding`/`resolveAssignment` collapse `'auto'`/unset to the
  view **type** (component) and the default layout `BaseLayout`, keeping any
  explicit name verbatim; `buildViewSnapshot` applies it so the snapshot's
  `render` carries concrete names that match the template dispatch.
- **Registry discovery & scaffold** — `RegistryPort.discover()` scans the
  project's `theme/`/`user/`/`generated/` view+layout dirs for `.astro` names
  (raw, pre-precedence) to populate the settings assignment **dropdowns**;
  `ScaffoldPort.scaffold(kind, name)` writes a **user-owned** stub under
  `src/user/views|layouts/`, **never overwriting** an existing file (NFR-9). Stub
  content is the pure `scaffold-stub.ts`; the `Scaffold component/layout` command
  drives it via the `ScaffoldModal`.
- **Asset pipeline** — resolving referenced vault attachments (card covers /
  image-typed values, MVP per D7) to stable `public/` URLs and copying them into
  the build (FR-16). Split: the **pure** half (`asset-resolver.ts` +
  `resolveSnapshotAssets`) normalizes refs (strips `![[…|alt#sub]]`), assigns a
  percent-safe `/assets/…` URL, **dedupes** (same source → one URL) and
  disambiguates basename collisions, rewrites entry values, and emits a copy
  plan + warnings; the **I/O** half (`AssetSourcePort`/`AssetSourceAdapter`)
  locates refs via the metadata cache and copies files (content-hash dedupe).
- **Asset manifest & image properties** — optional snapshot fields the pipeline
  adds: `ViewSnapshot.assets` (`{ source, url }[]`, the copy list) and
  `view.imageProperties` (property ids whose values are images). Image-typed
  values are rewritten to their public URL so views render them as `<img>`.
- **Graceful degradation (assets)** — a missing or oversized attachment is
  **never fatal** (FR-16): the pure `decideAssetAvailability`/`missingAsset`
  decision rewrites the value to a placeholder URL (`/assets/_missing.svg`,
  shipped in the template) and records a build warning instead of failing.
- **Route table** — the pure single source of truth for the site's shared
  `[...slug]` namespace (`route-table.ts`, `buildRouteTable`; FR-15, DESIGN §5.7).
  Given the resolved targets + their entries it places every **listing** route
  (one per `(base, view)`) and **detail** route (one per published entry)
  deterministically, **detects collisions** across the whole namespace
  (entry/listing/listing) and resolves them **first-wins** — a later listing is
  skipped (like `planSync`), a later detail route gets a numeric suffix so every
  entry keeps a page (FR-21) — recording a warning each. It also exposes a
  **route resolver** (vault path / note name → on-site route | `null`).
- **Wikilink resolver** — the pure `[[wikilink]]` rewriter (`wikilinks.ts`,
  `resolveWikilinks`; FR-15, D8). DESIGN §5.7 mandates wikilinks resolve in the
  harvester **against the route table, not at render time**: on-site links
  become markdown links to routes; off-site (unpublished) links become the
  **unpublished-link marker** (below). Image embeds (`![[…]]`) are left to the
  asset pipeline; block refs / transclusions / Dataview are **out of scope** and
  pass through (never throw).
- **Unpublished link / not-published marker** — an off-site `[[wikilink]]` (its
  target is not on the site) resolves to an inline raw-HTML
  `<span class="sp-unpublished">` instead of an `<a>` (FR-24, D17; C16). It is
  visibly-distinct, **non-clickable** "not published" text the body pipeline
  passes through and the global token sheet styles. Off-site targets are
  **NEVER** auto-published (privacy-safe): the resolver only ever maps to a route
  the table already placed. Each off-site link is collected (`OffSiteLink` →
  `onOffSite` sink) and surfaced as a build **warning** naming the link + its
  source note, via the same `warnings` channel `SyncSite` bubbles up.
- **Detail page** — the per-entry route (`/books/dune`) rendering the entry's
  values + note **body** at core fidelity (FR-21, D8). The template's
  `[...slug].astro` `getStaticPaths` emits one per entry alongside the listings;
  the `Detail` view renders the body through `markdown.ts` (unified: GFM +
  Obsidian **callout** transform → HTML), with wikilinks/embeds pre-resolved.
- **Entry body & body resolution** — the optional `EntrySnapshot.body`
  (`{ format:'markdown', content }`) the harvester reads via `cachedRead` +
  frontmatter strip (`toBody`). After harvest, the pure `resolveSnapshotBodies`
  builds the **global** route table from all snapshots and rewrites each body's
  wikilinks to routes before commit (so cross-base links resolve and collisions
  warn) — DESIGN §5.7, §6.
- **Theme / token** — the one polished default look, expressed entirely as
  CSS-variable **design tokens** in `theme/styles/tokens.css` (color/surface/
  text/border, a spacing & radius scale, fluid `clamp()` typography, shadows).
  Light is the `:root` default; dark applies via `prefers-color-scheme` AND an
  explicit `[data-theme]` hook, and the scale is responsive phone→desktop. Every
  view/layout consumes **only** tokens (no hard-coded colors) so the whole site
  re-skins from one sheet (D9; NFR-10).
- **Token cascade / override** — the rule that makes a user re-skin work with no
  component edits: `BaseLayout` imports `theme/styles/tokens.css` **first** and
  the user-owned `user/theme.css` **last**, so a `--sp-*` token redefined there
  wins by equal-specificity cascade order. `verify:template` proves this
  structurally — the fixture overlays a sentinel override and the built CSS
  bundle is asserted to contain it ordered after the default token block
  (FR-11a / NFR-7 / D9).
- **Astro template** — the bundled Astro project under `templates/astro/**`,
  the **editable source of truth**. Gated by `npm run verify:template` (Astro
  `check` + a fixture build). Not shipped as loose files: a build step embeds it
  into `main.js` (see _embedded template_).
- **Embedded template** — the generated TS asset module
  (`src/adapters/generated/embedded-template.ts`) that `scripts/embed-template.mjs`
  serializes from `templates/astro/**` so the template ships inside `main.js`
  (DIST-BRAT-1). `embed:template:check` keeps it in sync in CI.
- **Template-owned vs. user-owned** — each templated file's ownership
  (`classifyOwnership`): `src/user/**` is **user-owned** (written once, never
  overwritten — FR-11a/NFR-9); everything else is **template-owned** (rewritten
  on every bootstrap, which doubles as the upgrade path).
- **Bootstrap** — ensuring the Astro project is scaffolded + installed in the
  data folder before any sync/preview/build (the `EnsureProject` use-case behind
  `ProjectBootstrapPort`). Idempotent and resumable; the pure use-case decides
  if/what to scaffold, driving the adapter's raw I/O via `BootstrapDriverPort`.
- **Toolchain config** — the dev-server port (default **4321**, auto-fallback)
  plus optional absolute **Node / Astro binary path** overrides, held in the
  versioned settings (`ToolchainConfig`). The overrides exist for the macOS GUI
  `PATH` gap and non-default installs (FR-8 / NFR-4).
- **Versioned settings & forward migration** — the persisted settings document
  carries a `version` and is upgraded on load by the pure `migrate()`
  (`settings-migration.ts`), which tolerantly lifts older/unversioned blobs
  (incl. the pre-C4 `{ site }` shape) and junk to the current schema, defaulting
  new fields (NFR-8 / D4).
- **Dev URL parse** — the dev-server URL is taken from the line Astro **prints**
  to stdout (`parseDevServerUrl`), not from the requested port: Astro
  auto-falls-back if the port is busy, so the printed URL is **authoritative**.
- **Process-tree kill** — teardown must end the whole spawned group, not just the
  shell: the adapter spawns `detached` and `stop()` signals the group
  (`process.kill(-pid)` on POSIX, `taskkill /T /F` on Windows) so no orphaned
  vite/node keeps holding the port (NFR-2/NFR-4).

## Architecture terms (from the "deep modules" lens)

- **Module** — anything with an interface and an implementation.
- **Depth** — a lot of behaviour behind a small interface (high leverage).
- **Seam** — where an interface lives; behaviour can be swapped without editing
  in place. Our **ports** are the seams between core and adapters.
- **Locality** — change, bugs, and knowledge concentrated in one place.
- **Deletion test** — if deleting a module makes complexity vanish, it was a
  shallow pass-through; if complexity reappears across callers, it earned its
  keep. Prefer deep modules; avoid shallow ones.
