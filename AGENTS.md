# AGENTS.md — Specorator Astro Viewer

Guidance for AI agents and humans working in this repo. This file is canonical;
`CLAUDE.md` imports it.

## What this is

A desktop Obsidian plugin that renders the user's **Bases** as a live,
publishable **Astro** website, previewed inside Obsidian's Web Viewer. The full
design and normative requirements live in
[`docs/DESIGN.md`](docs/DESIGN.md) and [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md);
the chunked, agent-executable build sequence is in
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md); domain and architecture
vocabulary is in [`CONTEXT.md`](CONTEXT.md). Read those before non-trivial changes.

## Architecture (enforced — see REQUIREMENTS.md ARCH-1/2)

Pragmatic ports & adapters. Two **enforced** zones under `src/`:

- `src/core/**` — pure. Domain types, route planning, use-cases, and the **ports**
  (interfaces). MUST NOT import `obsidian`, `node:*`, or do any I/O.
- `src/adapters/**` — the only place (with `src/main.ts`) allowed to import
  `obsidian` / Node. Each implements a core port.
- `src/main.ts` — composition root: wires adapters into use-cases, registers
  commands. No domain logic.

Boundaries are machine-enforced by `eslint-plugin-boundaries` (and
`dependency-cruiser` in CI). Put real logic in deep `core` modules behind small
port interfaces; keep adapters thin. Don't extract shallow pass-through modules.

## Commands

- `npm run verify` — the one gate (identical to CI): typecheck → lint →
  format:check → depcruise → test:coverage → build. Run before every commit/push.
- `npm run dev` / `npm run build` — esbuild bundle to `main.js`.
- `npm test` / `npm run test:coverage` — Vitest (core ≥ 90% coverage).
- `npm run lint` / `npm run format` — ESLint / Prettier.
- `npm run depcruise` — dependency-cruiser (cycles/boundaries).

## Conventions

- **Native Obsidian only:** depend solely on the Bases + Web Viewer core
  plugins; never require a third-party community plugin.
- **Desktop only:** `isDesktopOnly: true`; Node lives behind adapters.
- **Tests:** core logic is tested with in-memory fakes (no `obsidian`); the
  `obsidian` module is aliased to `test/__mocks__/obsidian.ts`.
- **Commits:** Conventional Commits (enforced by commitlint). Releases via
  release-please.
- **Security:** `child_process` only ever spawns the project-local toolchain,
  never content-derived commands. Disclose network/file access in the README.

## Map

- `src/core/domain/` — types + pure route planning.
- `src/core/ports.ts` — port interfaces (the seams).
- `src/core/usecases/` — orchestration (`SyncSite`, `PreviewSite`).
- `src/adapters/` — Obsidian/Node implementations.
- `test/` — Vitest specs mirroring `src/`.
