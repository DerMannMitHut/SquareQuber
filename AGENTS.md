# Repository Guidelines

## Project Structure & Module Organization
- JavaScript single‑page app. Entry in `src/index.html`; app code in `src/` (modules by feature).
- Tests mirror `src/` in `tests/` (e.g., `tests/core/utils.spec.js`).
- Helper commands in `scripts/` (kebab-case, executable). Optional `Makefile` for convenience.
- Static assets in `assets/` during dev; build must inline them into the final HTML.

## Single‑Page, Offline Constraints
- One deliverable: `dist/SquareQuber.html` (self‑contained). No external files at runtime.
- No network usage: do not use `fetch`, `XMLHttpRequest`, `WebSocket`, or remote `import()`.
- No external URLs: avoid CDNs, web fonts, remote images. Inline via Data URLs or embed content.
- Dev can split code/modules; the build must bundle and inline CSS/JS/assets into the single file.

## Build, Test, and Development Commands
- Dev: `npm run dev` (or `scripts/dev`). Opens `dist/SquareQuber.html` if built, else `src/index.html`.
- Test: `npm test` (or `scripts/test`). Runs unit tests and reports summary.
- Lint/Format: `npm run lint` / `npm run format` (or `scripts/lint` / `scripts/format`).
- Build: `npm run build` (or `scripts/build`). Outputs single `dist/SquareQuber.html` with all assets inlined.
Note: If wrappers don’t exist yet, add thin scripts that call your toolchain (esbuild/rollup + plugins to inline CSS/assets). Example: `chmod +x scripts/*`.

## Coding Style & Naming Conventions
- JavaScript/TypeScript: ES2020+, 2‑space indent, 100‑char lines, end with newline.
- Filenames: kebab-case for scripts, camelCase for utilities, PascalCase for components/classes.
- Prefer `const`/`let`, pure functions, small modules. Use explicit exports.
- Run linter/formatter before pushing; fix or justify warnings.

## Testing Guidelines
- Framework: Vitest or Jest with `jsdom` for DOM tests.
- Naming: `*.spec.ts|js` mirroring `src/` paths.
- Coverage: target ≥80% on changed code; add regression tests for every bug fix.
- Offline guard: add a test to assert the build has no `<script src>`, `<link href>`, or `http(s)://` and that `fetch`/`WebSocket` are unused.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat: add qube scheduler`). Keep the subject ≤72 chars and write an informative body when needed. Reference issues (e.g., `Fixes #42`).
- PRs: include purpose, implementation notes, screenshots/logs if UI/CLI output changes, and clear test instructions. Checklist: tests added/updated, docs touched, `scripts/lint` and `scripts/test` pass.

## Security & Configuration Tips
- No external URLs in production output. Quick check: `rg -n "(https?://|<script src=|<link .*href=)" dist/SquareQuber.html`.
- Do not commit secrets. Use `.env.local` (gitignored) and document vars in `.env.example` if needed.
- Pin dependencies where practical and update via PRs.

## Release & Versioning
- Versioning: Follow SemVer (MAJOR.MINOR.PATCH).
- Source of truth: `package.json#version`. The build injects this value into the app (`window.__APP_VERSION__`), which is shown next to the title in the UI.
- Bump rules:
  - PATCH: backwards-compatible fixes, docs, build tweaks.
  - MINOR: backwards-compatible features, UI additions, solver improvements.
  - MAJOR: breaking changes (API, file format, behavior that invalidates prior usage).
- Process:
  1) Bump version: run `scripts/bump <patch|minor|major|X.Y.Z>`.
  2) Build and verify: `npm run build` (check version in `dist/SquareQuber.html`).
  3) Push changes. A pre-push hook enforces that the version increased vs. the remote.
     - Hooks path is set to `.githooks` by repo config; if needed, run `git config core.hooksPath .githooks`.
