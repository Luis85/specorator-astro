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
- **Component note** — an Obsidian note authoring an Astro component as an
  ` ```astro ` code block; transpiled into the Astro project. Opt-in
  (executes at build time).
- **Snapshot loader** — the template's custom Astro Content Layer loader
  (`src/content/loader.ts`) that reads the committed data dir (`<project>/data/`,
  resolved from `config.root`, outside `src/`), validates each snapshot against
  the **Zod 4** `snapshotSchema`, and feeds the `snapshots` collection. Each
  entry's id is its authoritative listing `route`. In dev it registers a
  `watcher.on('change'/'add', …)` over the data dir so re-syncing live-reloads
  the preview (FR-7); this reloads **data** only, not `.astro` source.
- **Registry barrel** — the template's `src/registry.ts`, a single stable module
  mapping a component/layout **name** → an imported `.astro` component
  (`resolveView`/`resolveLayout`). Keeping every view behind one barrel keeps the
  file set stable so adding a view never trips Astro's new-file HMR gap (D9).
- **View dispatch** — the `[...slug].astro` route emits one static listing page
  per snapshot via `getStaticPaths()` and renders it with the registry component
  named by `render.component`, defaulting to the view `type` (`table`/`cards`/
  `list`) when the binding is `'auto'`.
- **Theme / token** — the default look, driven by CSS-variable design tokens.
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
