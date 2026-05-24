# specorator-astro — Requirements

> Companion to `DESIGN.md`. This document is normative: it lists the
> requirements the plugin must satisfy. Each requirement has an ID
> (`FR-*` functional, `NFR-*` non-functional, `ARCH-*`, `TEST-*`, `DIST-*`,
> `QA-*`, `DOC-*`, `DEP-*`) for traceability.

## 0. Scope constraint — native Obsidian only

- **NFR-NATIVE-1** — The plugin MUST depend only on **Obsidian core features**:
  the **Bases** core plugin and the **Web Viewer** core plugin. It MUST NOT
  require, integrate with, or assume the presence of any third-party / community
  Obsidian plugin.
- **NFR-NATIVE-2** — Consequently the Bases **map** view is **excluded** for
  now (its native rendering depends on the external Maps community plugin). The
  supported view types are **table, cards, and list**.
- **NFR-NATIVE-3** — The Node/Astro toolchain (Node.js, npm, Astro) is an
  external _build_ dependency, not an Obsidian plugin; it is permitted and
  inherent to the concept. This constraint concerns Obsidian plugins only.

## 1. Functional requirements

- **FR-1** — Enumerate Base definitions from both standalone `.base` files **and**
  ` ```base ` code blocks embedded in notes.
- **FR-2** — Harvest the **evaluated** results of a Base view (post-filter,
  post-formula) via the official Bases view API (`registerBasesView` /
  `BasesView.onDataUpdated`), reading `this.data.groupedData`,
  `entry.getValue(id)`, `entry.file`, `this.config.getOrder()`, and
  `this.config.getDisplayName(id)` for labels. Because there is **no headless
  evaluation API**, harvest MUST occur through a **mounted view** (a transient or
  pinned leaf — `DESIGN.md §5.1`), and to mirror a user's native table/cards/list
  view the plugin MUST read that view's config (type/order/groupBy/view-local
  filters) from the `.base` and apply it to its harvesting view. The plugin MUST
  NOT reimplement the Bases filter/formula language.
- **FR-3** — Serialize each base/view to a JSON snapshot (schema per
  `DESIGN.md §6`) written into the Astro project in the plugin data folder.
- **FR-4** — Render the native view types **table, cards, list** as Astro
  components, honoring per-view config (order/columns, grouping, card image,
  list markers, etc.).
- **FR-5** — Run `astro dev` and open the resulting `http://localhost:<port>`
  inside Obsidian via the Web Viewer (`setViewState` `type: 'webviewer'`).
- **FR-6** — Run `astro build` to produce a publishable static site from the
  same snapshots.
- **FR-7** — Re-sync snapshots when Base data changes and trigger a dev-server
  live reload (Content Layer loader `watcher`).
- **FR-8** — Expose commands and a **settings tab** that is the source of truth
  for the site config (FR-19) and also covers at least: the `Site/` authoring
  layout (default `Site/components` (FR-11f), `Site/pages` (FR-12) — all
  configurable, D19), dev-server port (default 4321, auto-fallback), Node/binary
  path override, and build output / export location.
- **FR-9** — Scaffold and bootstrap the bundled Astro template into the plugin
  data folder on first run (including dependency install), surfacing build/
  install errors in a visible output channel.
- **FR-10** — Detect and clearly message when the Web Viewer or Bases core
  plugins are disabled, rather than failing silently.
- **FR-11 (Component/layout management)** — Users MUST be able to manage Astro
  components and layouts easily:
    - **FR-11a** — The scaffolded project MUST separate **template-owned** files
      (upgradable) from **user-owned** components/layouts/theme (never overwritten
      on upgrade). See `DESIGN.md §5.6`.
    - **FR-11b** — A **registry** MUST discover available view components and
      layouts by name, with user definitions shadowing template defaults of the
      same name.
    - **FR-11c** — Users MUST be able to **assign** a component and layout to a
      specific base/view; the assignment is stored in a plugin-managed **sidecar
      config** (not by mutating `.base` files), and resolved into each snapshot.
    - **FR-11d** — The plugin MUST provide affordances to **scaffold** a new
      component/layout from a stub and to **assign** layouts/components via the
      settings UI (dropdowns populated from the registry).
    - **FR-11e** — Editing a component/layout/theme file while the dev server runs
      MUST be reflected live in the Web Viewer preview (HMR).
    - **FR-11f (Vault component library)** — The component library MUST be
      authorable **inside the vault** in a **configurable folder** set via plugin
      settings (on install). Each component is a **fully Obsidian-compatible
      frontmatter markdown note** (renders harmlessly in Obsidian).
    - **FR-11g (Transpilation)** — The plugin MUST read each component note,
      extract its metadata (frontmatter) and template (a fenced ` ```astro `
      block), and transpile it into a real Astro component available to the site
      and registry (see `DESIGN.md §5.6`). Because transpiled components are
      **executed at build time** (no sandbox), enabling the code-fence library MUST
      require **one-time explicit consent** (FR-18), and the **default** path MUST
      be the safe, Zod-prop-validated bundled `theme/` components that need no
      author code.
    - **FR-11h (Add component)** — The plugin MUST provide a _Create component_
      command that scaffolds a new component note in the library folder. _Editing_
      an existing component MUST hot-reload; for a **newly created** component the
      plugin MUST make it available without manual steps by restarting the dev
      server or using a stable virtual-module/registry barrel (Astro does not HMR
      new files — `DESIGN.md §5.6`).
    - **FR-11k (Right-click insertion)** — The plugin MUST add **editor
      context-menu** (right-click) actions, via the `editor-menu` workspace event,
      to _Insert Astro component block_ (a ` ```astro ` code fence at the cursor)
      and to register/create a component from the current note, plus a `file-menu`
      _New component note_ action on the library folder. Code fences are the
      canonical authoring surface (decided — see `DESIGN.md §5.6`); the right-click
      actions exist so users never hand-type the fence. Events MUST be registered
      via `registerEvent` for auto-cleanup (OBS-4).
    - **FR-11i (No page leakage)** — The component-library folder MUST be excluded
      from website page detection (FR-12) so component notes never become pages.
    - **FR-11j (Precedence)** — On name collision, resolution precedence MUST be:
      vault component note → hand-written `user/` `.astro` → bundled `theme/`
      default.
- **FR-12 (Standalone pages)** — Beyond Bases collections, the plugin MUST turn
  **individual vault notes** into website pages. A note opts in via frontmatter
  (e.g. `site: true` / a `page` type) or a configured "pages" folder; one note
  MUST be designatable as the **home page** (`/`). Page bodies render as markdown
  with `[[wikilinks]]` resolved to site routes.
- **FR-13 (Navigation)** — The plugin MUST produce a configurable **navigation**
  menu (ordered, optionally nested) whose items point at page or collection
  routes. Sources, in priority order: an explicit navigation config (sidecar or
  designated note), page frontmatter hints (`nav: { title, order, group }`), then
  a folder-structure fallback. The resolved tree MUST render consistently across
  all pages (see `DESIGN.md §5.7`).
- **FR-14 (Sitemap)** — The build MUST emit a standard `sitemap.xml` (via the
  `@astrojs/sitemap` Astro integration), and MAY also generate an in-site
  human-readable site map page from the route table.
- **FR-15 (Routing)** — Routes MUST derive deterministically from
  `slug`/`permalink` frontmatter, falling back to a `normalizePath`-cleaned
  path/basename, with a route table that resolves cross-page and
  page→collection links.
- **FR-16 (Asset pipeline)** — Referenced vault attachments (card covers, inline
  images, `![[embeds]]`) MUST be resolved and copied/linked into the Astro
  `public/` tree with references rewritten to public URLs; only referenced
  attachments are copied; a missing attachment degrades to a placeholder + build
  warning, never a build failure (`DESIGN.md §5.8`).
- **FR-17 (Bootstrap & first run)** — First run MUST: probe for the Node/npm
  toolchain (actionable guidance + settings path override if absent); run
  dependency install with visible, cancelable progress (`--legacy-peer-deps` if
  pinned integrations require it); detect offline; and be **idempotent and
  resumable** after partial failure (`DESIGN.md §5.9`).
- **FR-18 (Security consent & disclosure)** — Enabling build-time-executing
  code-fence components MUST require one-time explicit consent; the README MUST
  disclose network use, out-of-vault file access, and that component notes
  execute at build time. The plugin MUST NOT claim a sandbox and MUST NOT spawn
  content-derived commands (`DESIGN.md §5.10`).

- **FR-19 (Site config in native settings)** — The plugin's **native settings**
  (edited via the settings tab, persisted through Obsidian's data API) are the
  single source of truth for: the curated **inclusion list** of base files, the
  **per-(base,view) selection** and **routes**, component/layout **bindings**,
  **navigation**, and the **site URL**. The settings are schema-versioned with
  forward migration (NFR-8). _Supersedes the earlier vault config note
  (`Site/site.md`)._ (D1/D3/D4/D14/D16)
- **FR-20 (Sync trigger)** — Provide a manual _Sync site_ command; auto-sync on
  first preview; and an optional, **debounced live-resync of only the
  actively-previewed base** (toggle to disable). (D2)
- **FR-21 (Detail pages — MVP)** — Each published base entry MUST render its own
  **detail page** (note body at core fidelity, FR-8/D8) — part of the MVP. (D7)
- **FR-22 (Build output & export)** — `astro build` outputs to `dist/` in the
  plugin data folder; an **Export/Reveal build** action copies it to a chosen
  location; deploy is manual to any static host. (D6)
- **FR-23 (Site URL / SEO)** — A `site` URL in the plugin settings: optional for
  dev/preview (localhost origin), **required at build** to emit `sitemap.xml` +
  canonical/OpenGraph; warn-don't-fail if absent. (D16)
- **FR-24 (Unpublished links)** — Wikilinks to notes **not** on the site render
  as plain text (styled "not published") + a build-warning list; targets are
  **never auto-included** (privacy-safe). (D17)

> **MVP / phasing (updated per interview).** **MVP** = FR-2..FR-10, FR-19..FR-24,
> and FR-16 (assets) for **table + cards collections + per-entry detail pages**
> with the safe default `theme/` components and one token theme. **Post-MVP:**
> FR-1 (code-block bases), FR-11f–k (vault code-fence component library, opt-in),
> and **FR-12–FR-15** (standalone pages, navigation, sitemap — models decided,
> build deferred). See `DESIGN.md §9`/§11.

## 2. Non-functional requirements

- **NFR-1 (Platform)** — Desktop only; MUST set `isDesktopOnly: true` and guard
  Node usage with `Platform.isDesktop`. A **system Node.js is a documented
  prerequisite** (detected + guided; no bundled runtime — D10).
- **NFR-13 (Single site v1)** — v1 supports **one site per vault** (one site
  config in native settings → one Astro project); the design MUST NOT preclude
  multiple sites later (D5).
- **NFR-2 (Isolation)** — A long-running Astro dev server SHOULD run in a child
  process to avoid blocking Obsidian's UI thread; the plugin MUST terminate any
  spawned process in `onunload`.
- **NFR-3 (Data folder)** — Build **artifacts** (the Astro project, `node_modules`,
  snapshots, `src/generated/`, `dist/`) MUST live in the plugin data folder,
  outside the indexed vault. Authoring **sources** (notes, `.base` files, page
  notes, component-library notes) are vault-resident by design; the harvest/
  transpile step is the bridge between the two (`DESIGN.md §4.1`).
- **NFR-4 (Robust binaries)** — Binary resolution MUST tolerate the macOS GUI
  `PATH` problem (absolute path / `bash -lc` / settings override) and Windows
  `.cmd` binaries; process **teardown MUST kill the whole process tree**.
- **NFR-5 (Performance)** — Honor Base `limit`; snapshot writes SHOULD be
  incremental; re-harvest on `onDataUpdated` MUST be **debounced/throttled**.
  Target: usable on vaults up to ~10k notes (state the budget; degrade, don't
  hang).
- **NFR-8 (Settings persistence/migration)** — Settings and sidecars
  (`view-bindings.json`, `navigation.json`) MUST carry a schema version and have
  a forward migration path across plugin upgrades.
- **NFR-9 (Cleanup & data-loss safety)** — Regeneration MUST only write
  `src/generated/` and MUST NEVER delete vault content or hand-written `user/`
  files; uninstall MAY offer (confirmation-gated) removal of the data-folder
  project.
- **NFR-10 (Generated-site quality)** — Bundled `theme/` components MUST emit
  reasonable `<title>`/meta (and OpenGraph/canonical where a `site` URL is set)
  and meet basic accessibility (semantic landmarks, alt text, keyboard nav).
- **NFR-11 (Licensing/i18n)** — License is **MIT** (D13); plugin-UI
  internationalization is **out of scope for v1**.
- **NFR-12 (Namespacing)** — The registered Bases `viewId` and any data-folder
  paths MUST be namespaced to avoid collisions with other plugins.
- **NFR-6 (Privacy/Network)** — Any network access (Astro toolchain, Web Viewer)
  and any file access **outside the vault** MUST be disclosed in the README. No
  client-side telemetry.
- **NFR-7 (Upgrade-safe customization)** — Upgrading the bundled Astro template
  MUST NOT overwrite or discard user-owned components, layouts, or theme files
  (FR-11a). Template-owned files are replaced; the `user/` tree is preserved.

## 3. Architecture requirements (DDD / ports & adapters, pragmatic)

- **ARCH-1** — Two **enforced** zones under `src/`, plus the composition root:
    - `core/` — **pure**, no I/O, never imports `obsidian`/`node:*`. Holds the data
      model (`BaseSnapshot`, `ViewSpec`, `SiteSpec`, route/nav resolution), the
      transforms (markdown→`.astro` transpiler, mapping), the use-cases
      (`HarvestBases`, `SyncSnapshots`, `BuildSite`, …), and the **ports**
      (interfaces): `BasesPort`, `SettingsPort`, `SnapshotWriterPort`,
      `AstroProcessPort`, `WebViewerPort`. (Organize domain vs
      use-cases as subfolders if helpful — but do **not** over-abstract; this
      plugin has almost no business-rule domain.)
    - `adapters/` — implement the ports; the **only** place (besides `main.ts`)
      allowed to import `obsidian` / Node modules.
    - `main.ts` — the `Plugin` subclass = composition root, wiring adapters into
      use-cases in `onload`.
- **ARCH-2** — Boundaries MUST be **machine-enforced** by
  **`eslint-plugin-boundaries`**: `core` may import only `core`; `adapters`/root
  may import `core`+`adapters`; the `boundaries/external` rule confines
  `obsidian`/`astro`/`node:*` imports to `adapters`/root. `dependency-cruiser`
  runs in CI for cycles/orphans.
- **ARCH-3** — Every Obsidian/Node touchpoint MUST sit behind a port so the
  Bases API (young, churn-prone) and the Astro runner are swappable and
  mockable.

## 4. Testability requirements (Vitest)

- **TEST-1** — Use **Vitest** as the test runner.
- **TEST-2** — `core/` MUST be unit-testable with **no `obsidian` import** and no
  real I/O (the primary reason for ARCH-1). The transpiler and harvest
  normalization are pure `core` and tested string/JSON-in → out with golden
  fixtures.
- **TEST-3** — For code that must import `obsidian`, alias it to a hand-written
  stub in `vitest.config.ts`
  (`resolve.alias: { obsidian: '<root>/test/__mocks__/obsidian.ts' }`) — preferred
  over `vi.mock('obsidian', …)`, which can fail to resolve the package entry.
- **TEST-4** — Use the `node` environment for core/process logic; use `jsdom`
  only for DOM/`createEl` rendering tests.
- **TEST-5** — Coverage via `@vitest/coverage-v8`; enforce per-glob thresholds in
  `test.coverage.thresholds`. **`core/**`≥ 90%**;`adapters/**` a lower bar (do
  **not\*\* impose a global 90% — thin I/O adapters invite test-theater).
- **TEST-6** — Add (a) **contract-test fixtures** capturing real
  `BasesEntry`/`groupedData` shapes from a live vault, to test the harvester
  adapter's normalization and catch Bases API churn; and (b) **Astro Container
  API** smoke tests that the transpiled `.astro` actually compiles — kept in the
  slow suite (the Container API is experimental in Astro 6), not the fast loop.

## 5. Distribution requirements

### 5.1 BRAT (beta)

- **DIST-BRAT-1** — GitHub **release assets** MUST include `manifest.json` and
  `main.js` (and `styles.css` only if one exists). `versions.json` is not
  required by BRAT.
- **DIST-BRAT-2** — Release tag, release name, and the `version` inside the
  release's `manifest.json` asset MUST match.
- **DIST-BRAT-3** — During beta, do **not** commit a release `manifest.json` to
  the default branch in a way that triggers Obsidian's normal updater; BRAT
  reads the manifest from release assets.

### 5.2 Community marketplace

- **DIST-MP-1** — Repo MUST contain `README.md`, `LICENSE`, and `manifest.json`.
- **DIST-MP-2** — Each GitHub release MUST attach `main.js`, `manifest.json`
  (and optional `styles.css`); the tag MUST equal the manifest `version`
  (semver `x.y.z`, no leading `v`).
- **DIST-MP-3** — `id` and `name` MUST NOT contain "Obsidian" (or "Obsi-"/
  "-sidian"), MUST be Basic Latin, no emoji, and MUST NOT duplicate core names.
  Chosen (D19): `id: specorator-astro-viewer`, `name: "Specorator Astro Viewer"`
  ("Specorator" alone is reserved for a separate plugin).
- **DIST-MP-4** — `manifest.json` MUST set `isDesktopOnly: true`.
- **DIST-MP-5** — Maintain a root `versions.json` mapping plugin version →
  required `minAppVersion`.
- **DIST-MP-6** — README MUST disclose network use and out-of-vault file access
  (see NFR-6). `minAppVersion` MUST be ≥ the version that shipped the stable
  Bases view API (**1.10.0**).
- **DIST-MP-7** — Submit via the community plugin flow (PR to
  `community-plugins.json`); expect the automated bot review plus manual
  scrutiny of `child_process`/network use.

## 6. Obsidian best-practices (must comply)

Per the official Plugin guidelines:

- **OBS-1** — No `innerHTML` / `outerHTML` / `insertAdjacentHTML`; build DOM via
  `createEl()` / DOM API.
- **OBS-2** — Prefer the **Vault API** over the Adapter API; use
  `Vault.process` over `Vault.modify`, and `Vault.cachedRead` for read-only.
- **OBS-3** — Use `normalizePath()` for any user-defined / vault paths.
- **OBS-4** — Register listeners/intervals/children via `registerEvent`,
  `registerInterval`, `addChild`, `addCommand` for automatic cleanup; manually
  release everything else (spawned processes!) in `onunload`.
- **OBS-5** — Don't keep references to custom views; locate them via
  `getActiveLeavesOfType()`. Don't detach leaves in `onunload`.
- **OBS-6** — Use `this.app`, never the global `app`.
- **OBS-7** — No inline styles; move styling to `styles.css`.

## 7. Quality-gate feedback loop

- **QA-1 (Lint)** — **ESLint** flat config (`eslint.config.mjs`) using
  `typescript-eslint`, **plus the official `eslint-plugin-obsidianmd`** for
  manifest/guideline validation.
- **QA-2 (Format)** — **Prettier** for formatting; append `eslint-config-prettier`
  last in the ESLint config to disable formatting-conflicting rules. Prettier
  owns formatting; ESLint owns correctness.
- **QA-3 (Types)** — `tsc --noEmit` typecheck as a gate.
- **QA-4 (Tests)** — `vitest run --coverage` with enforced thresholds (TEST-5).
- **QA-5 (Boundaries)** — Lint MUST enforce the DDD import boundaries (ARCH-2).
- **QA-6 (Local loop)** — `husky` `pre-commit` → `lint-staged`
  (`eslint --fix` + `prettier --write` on staged files); `pre-push` MUST call
  **exactly `npm run verify`** (AGENT-2) so the local gate and CI gate cannot
  diverge.
- **QA-7 (CI)** — GitHub Actions runs **`npm run verify`** on PRs (the same gate
  as `pre-push`, QA-6): typecheck, lint, format:check, `depcruise` (boundaries),
  test:coverage, and build; all MUST pass to merge.
- **QA-8 (Scripts)** — `package.json` exposes at least: `dev`, `build`, `lint`,
  `format`, `format:check`, `typecheck`, `test`, `test:coverage`, `depcruise`,
  `verify`, `docs`.

## 8. Documentation requirements

- **DOC-1** — **TypeDoc** generates API docs from `src/` (entry points
  `src/core` + `src/main.ts`), output to `docs/api`, via a standalone `docs`
  npm script (independent of the esbuild bundle).
- **DOC-2** — `README.md` covers install (BRAT + manifest), the native-only
  scope, required core plugins (Bases, Web Viewer), the Node/Astro prerequisite,
  and the NFR-6 disclosures.
- **DOC-3** — `DESIGN.md` and this `REQUIREMENTS.md` are kept current as the
  source of truth for architecture and scope.

## 9. Dependency requirements

- **DEP-1** — Pin the **current latest stable** version of every dependency at
  setup, then manage updates deliberately (e.g. Renovate/Dependabot). The
  versions below were **verified against the npm registry on 2026-05-24**.
- **DEP-2** — Target **Node.js Active LTS = v24 "Krypton"** (latest 24.16.0 as
  of 2026-05-24). Set `engines.node` accordingly.
- **DEP-3** — `eslint` 10 and `typescript` 6 are recent majors; verify
  `typescript-eslint` peer-dependency compatibility against TS 6 before locking
  (flagged as the one compatibility risk).
- **DEP-4** — Astro 6 requires **Node ≥ 22.12** (v24 LTS is fine) and ships
  **Vite 7 + Zod 4**; Content Layer loader schemas MUST use Zod 4 syntax. Some
  `@astrojs/*` integrations shipped strict Astro-6 peer ranges — be ready to
  install with `--legacy-peer-deps` (FR-17) and verify peer ranges at pin time.

| Package                                   | Version (2026-05-24) | Role                                 |
| ----------------------------------------- | -------------------- | ------------------------------------ |
| `typescript`                              | 6.0.3                | language / typecheck                 |
| `esbuild`                                 | 0.28.0               | plugin bundler (`main.js`)           |
| `builtin-modules`                         | 5.2.0                | esbuild externals                    |
| `obsidian`                                | 1.12.3               | Obsidian API types                   |
| `@types/node`                             | 25.9.1               | Node types                           |
| `astro`                                   | 6.3.7                | site generator (in project)          |
| `@astrojs/sitemap`                        | 3.7.2                | `sitemap.xml` generation (FR-14)     |
| `vitest`                                  | 4.1.7                | test runner                          |
| `@vitest/coverage-v8`                     | 4.1.7                | coverage                             |
| `eslint`                                  | 10.4.0               | linter                               |
| `typescript-eslint`                       | 8.59.4               | TS ESLint (meta-package)             |
| `eslint-plugin-obsidianmd`                | 0.3.0                | official Obsidian lint rules         |
| `eslint-config-prettier`                  | 10.1.8               | disable format-conflicting rules     |
| `prettier`                                | 3.8.3                | formatter                            |
| `typedoc`                                 | 0.28.19              | API docs                             |
| `husky`                                   | 9.1.7                | git hooks                            |
| `lint-staged`                             | 17.0.5               | staged-file gate                     |
| `eslint-plugin-boundaries`                | 6.0.2†               | import-boundary enforcement (ARCH-2) |
| `dependency-cruiser`                      | 17.4.0†              | CI cycle/orphan checks (ARCH-2)      |
| `@commitlint/cli` + `config-conventional` | latest†              | Conventional Commits (AGENT-8)       |
| `release-please`                          | latest†              | release automation (AGENT-8)         |

Versions without † were confirmed via the npm registry `latest` dist-tag (Node
LTS via nodejs.org). †-marked versions are review-agent-reported — confirm via
npm at pin time. Re-verify all before pinning, as registries move.

## 10. Agentic development environment

The repository MUST provide a development environment designed for **agentic
development** — i.e. one that gives AI coding agents the context and the
guardrails to produce high-quality software, with rules enforced by tooling
rather than trusted to reviewers.

- **AGENT-1 (Agent guidance docs)** — **`AGENTS.md` is the source of truth**
  (the 2026 cross-tool standard); `CLAUDE.md` is a symlink/import of it to avoid
  drift. It MUST document: the architecture and import boundaries (ARCH-1/ARCH-2),
  where code / tests / components live, the canonical commands, the native-only
  scope (NFR-NATIVE-\*), and commit/PR conventions — so an agent has enough
  context to make correct changes without rediscovery.
- **AGENT-2 (One-command verify loop)** — A single aggregate script
  (e.g. `npm run verify`) MUST run the full gate set deterministically
  (typecheck → lint → format:check → test:coverage → build), giving agents one
  fast, unambiguous feedback signal.
- **AGENT-3 (Non-bypassable guardrails)** — The quality gates (QA-1..QA-7) MUST
  run in pre-commit/pre-push hooks **and** CI, so no change — human or agent —
  can merge below the bar. CI MUST NOT allow hooks to be skipped.
- **AGENT-4 (Machine-checkable rules)** — Architectural and style rules MUST be
  machine-enforced (ESLint import-boundary rules for ARCH-2,
  `eslint-plugin-obsidianmd`, strict `tsconfig`), not merely documented, so
  violations fail fast instead of relying on reviewer vigilance.
- **AGENT-5 (Ready-to-run sessions)** — A Claude Code on the web **SessionStart
  hook** MUST bootstrap the environment (install deps, prepare the Astro
  project) and verify the toolchain so agent sessions begin from a green,
  runnable state. (See the `session-start-hook` capability.)
- **AGENT-6 (Fast inner loop)** — Pure domain/application tests (TEST-2) MUST
  run with no Obsidian/Node I/O for sub-second unit feedback; slower
  integration spikes are kept separate so the agent loop stays fast.
- **AGENT-7 (Reproducible)** — Pinned dependency versions (DEP-1) plus a
  committed lockfile MUST make installs reproducible across agent and CI runs.
- **AGENT-8 (Parseable history)** — **Conventional Commits** enforced via
  **commitlint** in a husky `commit-msg` hook; **release-please** drives versioned
  releases (commit-driven; auto-tags the version DIST-MP-2 requires to match the
  manifest). Preferred over changesets for this single-package repo.
- **AGENT-9 (Actionable failures)** — Gate failures, and Astro build/dev errors
  (FR-9), MUST be surfaced with actionable messages so an agent can self-correct
  within the loop.
- **AGENT-10 (Machine-readable contracts)** — Commit a **JSON Schema** for the
  snapshot format and the sidecars (`view-bindings.json`, `navigation.json`) so
  agents (and CI) can validate generated output structurally.
- **AGENT-11 (Golden tests)** — Maintain golden/snapshot tests for the
  transpiler and harvested-JSON shapes as regression fences (TEST-6).
- **AGENT-12 (Required checks & review surface)** — CI gates MUST be configured
  as **branch-protection required status checks** (the actual non-bypass
  mechanism behind AGENT-3); add a **PR template** mapping changes to FR/ARCH
  IDs (§11) and a **CODEOWNERS** + label for `child_process`/network-touching
  files. **Dependabot** (single-package, near-zero config) manages updates.

## 11. Traceability note

Each requirement here maps to a component or decision in `DESIGN.md`
(harvester ↔ FR-2, snapshot writer ↔ FR-3, Astro process manager ↔ FR-5/FR-6,
Web Viewer adapter ↔ FR-5, asset pipeline ↔ FR-16, bootstrap ↔ FR-17, security
↔ FR-18, architecture ↔ ARCH-\*). The deep review **resolved** the prior unknowns:
headless harvest is impossible (FR-2 now mandates a mounted view) and Web Viewer
loads localhost (FR-5 verified). The remaining Phase-0 gate is whether
`setViewState` selects a **custom** Bases `viewType` programmatically
(`DESIGN.md §10`) — the one check that still conditions FR-2's cleanest UX.
