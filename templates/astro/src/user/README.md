# `src/user/` — your files, never overwritten

Everything in this directory is **user-owned**. The plugin creates it once on
first bootstrap and never touches it again on upgrade (FR-11a / NFR-7).

- `theme.css` — design-token overrides (loads last, so it wins).
- `layouts/`, `views/`, `components/` — hand-written `.astro` that **shadow**
  the bundled `src/theme/**` defaults of the same name (registry precedence,
  FR-11j). Create these directories as you need them.

The bundled defaults live in `src/theme/**` and are replaced wholesale on each
plugin upgrade — never edit those in place; override here instead.
