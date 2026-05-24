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
- **Inclusion list** — the user-curated set of `(base, view)` targets to publish.
- **Site config** — the single source of truth, managed in the plugin's
  **native settings** (settings tab) and persisted via Obsidian's data API:
  inclusion list, per-view selection, routes, component/layout bindings,
  navigation, and the site URL.
- **Snapshot** — the JSON the harvester writes for one `(base, view)`, consumed
  by the Astro project.
- **Publish target** — one `(base, view)` to publish; **resolved target** adds a
  concrete route + component/layout after planning.
- **Component note** — an Obsidian note authoring an Astro component as an
  ` ```astro ` code block; transpiled into the Astro project. Opt-in
  (executes at build time).
- **Theme / token** — the default look, driven by CSS-variable design tokens.

## Architecture terms (from the "deep modules" lens)

- **Module** — anything with an interface and an implementation.
- **Depth** — a lot of behaviour behind a small interface (high leverage).
- **Seam** — where an interface lives; behaviour can be swapped without editing
  in place. Our **ports** are the seams between core and adapters.
- **Locality** — change, bugs, and knowledge concentrated in one place.
- **Deletion test** — if deleting a module makes complexity vanish, it was a
  shallow pass-through; if complexity reappears across callers, it earned its
  keep. Prefer deep modules; avoid shallow ones.
