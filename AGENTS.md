# GrandPlan agent guide

This is the entry point for agents working in GrandPlan.
Read the product orientation first, then follow the linked references for detail.

## What GrandPlan is

Good AI output depends on a great plan, and GrandPlan makes reviewing agent plans a first-class experience.
Planning is an essential part of effective development with AI, and it deserves a first-class experience.
GrandPlan is built around one question: what is the best way to review a plan and reach agreement on it, before an agent acts?

An agent writes its plan as a document on disk, and GrandPlan renders it into a rich local review surface.
The long-term shape includes section navigation, typed blocks for diagrams, schemas, API endpoints and code diffs, a live chat connection to the authoring agent, highlight-to-comment threads, and versioned change review.
GrandPlan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the file on disk is the source of truth.

## Current state

Deliverable 1 is shipped in this repo: a static markdown viewer.
`grandplan render <input.md> [output.html]` converts a plain GFM markdown file into a single self-contained themed HTML document with a sticky table of contents built from level-two headings.
The output makes no external requests and reads fine with JavaScript disabled; the only script is a small inline scroll-spy enhancement.

## Architecture at a glance

The pipeline is deliberately small: CLI -> renderer -> self-contained HTML.

- The CLI (`src/cli/`) is built on `runAxiCli()` from `axi-sdk-js`, which owns dispatch, help, structured errors, and output serialization. Keep the integration thin; business logic never lives in the CLI layer.
- The renderer (`src/render/`) is pure: markdown source plus a title in, complete HTML out. It uses unified (remark-parse, remark-gfm, remark-rehype, rehype-slug, rehype-stringify) plus a small rehype transform that wraps tables in scroll containers.
- The review shell (`src/render/shell.ts`) owns the viewer's look: one reading column, warm paper-like light and dark palettes chosen via `prefers-color-scheme`, and a sticky section TOC. The page envelope (`src/render/page.ts`) separately owns how a document is packaged and delivered (doctype, head, inlined styles and scripts); future delivery modes swap the envelope while the shell stays the same.
- Styles are authored with Tailwind v4 in `src/render/global.css`: design tokens and utility classes for the shell markup, plus element-scoped styles for markdown content, which carries no class attributes. `scripts/gen-css.mjs` compiles that file and embeds the result as a generated TypeScript module, so rendered documents inline the full stylesheet and stay self-contained.

Future deliverables build outward from this core: a typed block registry, MDX plan documents, and a local server with a browser bridge for live agent chat and comments.

## Repo layout

- `bin/` - the executable entrypoint; a thin shim over `dist/cli/`.
- `src/cli/` - command dispatch and the `render` command.
- `src/render/` - the pure renderer, with colocated unit tests: `markdown/` (source to HTML plus the section outline), `shell.ts` (the reading surface), `page.ts` (the document envelope), and `render-document.ts` composing them.
- `scripts/` - build-time generators, currently the Tailwind CSS-to-module compiler.
- `examples/` - sample plan documents used by tests and demos.
- `test/` - the Playwright browser spec for the rendered viewer.
- `dist/` - build output (generated, not committed).

## Commands

- Install: `npm install`
- Build: `npm run build` (compiles the Tailwind stylesheet, then tsc to `dist/`)
- Unit tests: `npm test` (vitest, colocated `src/**/*.test.ts`; regenerates the stylesheet first)
- Stylesheet only: `npm run gen:css` (regenerates `src/render/global.generated.ts` from `global.css`; never edit the generated file)
- Browser test: `npx playwright test` (requires a prior build; renders the sample through the built CLI)
- Render: `node bin/grandplan.mjs render examples/sample.md` (or `npx grandplan render <file.md>` once installed)

## Engineering rules

GrandPlan follows the technology rules maintained in `fabricahq/app/_rules` (see the TypeScript and Playwright aggregates there); that repo is the source of truth.
The conventions that matter most here:

- Named exports only; type aliases over interfaces; literal unions over enums.
- `unknown` over `any`; no type assertions (`as`) or non-null assertions (`!`).
- Separate type imports; single-object args for multi-parameter functions; immutable data (`readonly`, `const`).
- Colocate code and tests by feature; kebab-case file names; comments explain why, not what.
- Every authored file starts with a file-level comment saying what it owns or why it exists; every non-trivial function gets a concise description above it (trivial one-liners stay uncommented).
- Generated files always carry `.generated.` in their name (for example `global.generated.ts`), are never edited by hand, and are never committed.
- Keep logic in pure modules and unit-test it there; reserve Playwright for critical user journeys.
- Tests are focused and user-oriented, use "should ... when ..." descriptions, and cover degenerate and boundary cases.

## Contribution workflow

- Sign off every commit for DCO: `git commit -s`.
- Work on feature branches and merge into `main`.
- Keep PRs small and reviewable; one self-contained increment per commit where possible.
