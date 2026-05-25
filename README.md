# Specorator Astro Viewer

Turn the collections you already keep in Obsidian into a real, good-looking
website — and preview that website **inside Obsidian** while you work.

> **Status:** beta. The plugin is installable via [BRAT](#installing-beta-via-brat)
> (or manually from a release) and covers the core experience described below.
> The full design and requirements live in [`docs/DESIGN.md`](docs/DESIGN.md) and
> [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## What it does

You probably already group notes into collections — books, recipes, projects,
people, films — and use Obsidian **Bases** to view them as tables or card
galleries. Those views are powerful, but they only live inside Obsidian: you
can't share a link, publish them, or really design how they look.

Specorator Astro Viewer takes those same Bases and:

- **Renders them as web pages** — your _books_ base becomes a cards gallery,
  your _projects_ base becomes a clean table — using the very filters and
  formulas you already set up in Obsidian.
- **Gives every item its own detail page** built from that note's content.
- **Shows the live site in a tab inside Obsidian** (via the built-in Web
  Viewer), so editing a note updates the page in front of you.
- **Builds a publishable static website** you can host anywhere.

In short: _Bases is the spreadsheet; Specorator Astro Viewer is the designed
website built from it._ It is powered by [Astro](https://astro.build) under the
hood, but you never have to touch Astro to use it.

## Requirements

- **Obsidian on desktop** (Windows / macOS / Linux). It does **not** run on
  mobile.
- Obsidian's built-in **Bases** and **Web Viewer** core plugins enabled.
- **[Node.js](https://nodejs.org) installed** on your computer (a one-time
  install — the plugin detects it and points you to it if it's missing). Node is
  the engine that builds your site.

It relies only on Obsidian's own features — no other community plugins required.

## Installing (beta, via BRAT)

While in beta, install with the
[BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin:

1. Install and enable **BRAT** from Community Plugins.
2. In BRAT, choose **"Add beta plugin"** and enter this repository:
   `Luis85/specorator-astro`.
3. Enable **Specorator Astro Viewer** in Settings → Community plugins.

### Manual install (from a release)

Prefer not to use BRAT? Install by hand:

1. Download `main.js`, `manifest.json`, and `styles.css` from a
   [release](https://github.com/Luis85/specorator-astro/releases).
2. Copy all three into `<vault>/.obsidian/plugins/specorator-astro-viewer/`
   (create the folder if it doesn't exist).
3. Reload Obsidian, then enable **Specorator Astro Viewer** in Settings →
   Community plugins.

A later release will be submitted to the official Community Plugins directory.

## Using it

1. **Choose what goes on your site.** Right-click a `.base` file →
   **"Specorator: add to site"** (or run the command palette's **"Add active
   base to site"** with the base open), then pick which view to publish (cards,
   table, or list). If the base has only one view it is added straight away.
   Your selections live in the plugin's **Settings** tab (Settings → Specorator
   Astro Viewer) under **Published views**, where you can also add targets by
   hand, reorder, re-route, or remove them.
2. **Preview live.** Run **"Preview site"** — a tab opens inside Obsidian
   showing your real website. Edit a note in another pane and watch it refresh.
3. **Style it.** A polished default theme ships out of the box; recolor and
   restyle it via simple CSS variables (fonts, colors, spacing, light/dark) —
   no coding needed.
4. **Build & publish.** Run **"Build site"** to produce a complete static
   website in a folder, use **"Export"** to copy it where you want, and upload
   it to any static host (Netlify, Vercel, GitHub Pages, your own server, …).

### Advanced: design your own components (optional)

If you want full control over how things look, you can author your own
components the Obsidian way — as a normal note with an ` ```astro ` code block
(a right-click action inserts the starter block for you). Because these
components run code when the site is built, this mode is **off by default** and
must be explicitly enabled (see the note below).

## Good to know

- **Desktop only**, because building a site requires running local tools.
- **Disclosures (transparency):**
    - The plugin runs local commands (Node/Astro) and writes the generated site to
      a folder **outside your vault** (the plugin's data folder); it also opens
      your local preview URL in the Web Viewer. It does not send your content
      anywhere and includes no telemetry.
    - **First-run setup downloads dependencies from the npm registry:** the one-time
      project bootstrap runs `npm install`, which fetches Astro and its dependencies
      over the network. This is the only network access the plugin makes; your notes
      are never uploaded.
    - The optional custom-component feature **executes the code you put in
      component notes at build time**, just like any build tool. Only enable it
      for component notes you trust (e.g. ones you wrote) — not notes received from
      others. It is off until you turn it on.
- **First version** focuses on the core: your Bases collections rendered as
  collections + detail pages, previewed live and publishable. Standalone pages
  written as notes, a navigation menu, and an SEO sitemap are designed and
  planned for a later release.

## License

[MIT](LICENSE)

## Learn more

- [Design document](docs/DESIGN.md)
- [Requirements](docs/REQUIREMENTS.md)
