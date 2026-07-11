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
`grandplan render <input.md> [output.html]` converts a plain GFM markdown file into a single self-contained themed HTML document with a responsive table of contents built from level-two headings.
Wide screens use a sticky sidebar; narrower screens use a compact `Grimm 10.0` plan-review header and a sticky `Sections` disclosure showing the section count.
Declared fenced-code languages receive syntax highlighting, every block code sample gets a copy control, and readers can override the OS light/dark preference with a locally persisted theme control.
The output makes no external requests and remains readable with JavaScript disabled; inline scripts progressively enhance the table of contents, theme control, and code-copy controls.

## Architecture at a glance

The pipeline is deliberately small: CLI -> renderer -> self-contained HTML.

- The CLI (`src/cli/`) is built on `runAxiCli()` from `axi-sdk-js`, which owns dispatch, help, structured errors, and output serialization. Keep the integration thin; business logic never lives in the CLI layer.
- The renderer (`src/render/`) is pure: markdown source, a fallback title, and an optional environment label in, complete HTML out. It uses unified (remark-parse, remark-gfm, remark-rehype, rehype-slug, rehype-highlight) to compile markdown into a structured Hypertext Abstract Syntax Tree (HAST) review document, collects the title, section outline, and element ids from that tree, applies rehype transforms such as syntax highlighting, code-copy controls, and table scroll-container wrapping, and serializes with rehype-stringify only after all transforms finish. The shell uses those ids to allocate a collision-free mobile `Overview` anchor. The environment label defaults to `Grimm 10.0` and is rendered in the mobile header when the document has TOC sections.
- The review shell (`src/render/shell/`) owns the viewer's look: one reading column, warm paper-like light and dark palettes that follow `prefers-color-scheme` until explicitly toggled, code-block controls, a sticky desktop section sidebar, and compact mobile environment and `Sections` chrome. The page envelope (`src/render/page.ts`) separately owns how a document is packaged and delivered (doctype, head, inlined styles and scripts); future delivery modes swap the envelope while the shell stays the same.
- Styles are authored with Tailwind v4.
  `src/render/global.css` is the entry point and owns only what is genuinely global: design tokens, the light and dark palettes, and the layout breakpoint.
  Feature styles live with the module that emits their markup: element-scoped styles for plain markdown elements in `src/render/markdown/prose.css`, and code-block control and syntax-token styles in `src/render/markdown/code-block/`.
  `scripts/gen-css.mjs` compiles the entry point (inlining its imports) and embeds the result as a generated TypeScript module, so rendered documents inline the full stylesheet and stay self-contained.
- Browser-side scripts are authored as real TypeScript in `*.browser.ts` files co-located with the concern they belong to (type-checked against `tsconfig.browser.json`, which adds the DOM lib) and compiled by `scripts/gen-browser-scripts.mjs` into generated modules the shell inlines. Shipped documents never reference external code.

Future deliverables build outward from this core: a typed block registry, MDX plan documents, and a local server with a browser bridge for live agent chat and comments.

## Repo layout

- `bin/` - the executable entrypoint; a thin shim over `dist/cli/`.
- `src/cli/` - command dispatch and the `render` command.
- `src/render/` - the pure renderer, with colocated unit tests: `markdown/` (source to structured HAST, transforms, final serialization, the section outline, title, and element ids), `icons/` (small inline SVG assets for renderer controls), `shell/` (the reading surface: markup with its own `NavEntry` contract, plus browser-side theme, copy, and scroll-spy enhancements), `page.ts` (the document envelope), and `render-document.ts` composing them.
- `scripts/` - build-time generators for the Tailwind CSS module and browser-script modules.
- `examples/` - sample plan documents used by tests and demos.
- `test/` - the Playwright browser spec for the rendered viewer.
- `dist/` - build output (generated, not committed).

## Tech stack

- **Runtime target**: Node.js >= 22, ESM only. The published package runs under plain Node so `npx grandplan` works everywhere; Bun is a development-time choice, not a runtime requirement.
- **Package manager and script runner**: Bun (`bun install`, `bun run <script>`, `bun.lock`). Note: use `bun run test`, not `bun test` - the latter invokes Bun's own test runner instead of vitest.
- **Language**: TypeScript, strict, compiled with tsc; browser-side scripts type-check against `tsconfig.browser.json` (DOM lib) and are transpiled into generated modules.
- **CLI framework**: `axi-sdk-js` (dispatch, help, structured errors, TOON output).
- **Markdown pipeline**: unified (remark-parse, remark-gfm, remark-rehype, rehype-slug, rehype-highlight, rehype-stringify).
- **Styling**: Tailwind v4, compiled at build time by `@tailwindcss/cli` into a generated module; no runtime CSS tooling.
- **Linting**: ESLint v10 flat config with `typescript-eslint`, project conventions, architectural boundaries, and Playwright fixture enforcement.
- **Tests**: vitest for units (colocated in `src/**`), Playwright (chromium) for browser journeys.

## Commands

- Install: `bun install`
- Build: `bun run build` (runs `bun run gen` - stylesheet and browser scripts - then tsc to `dist/`)
- Unit tests: `bun run test` (vitest, colocated `src/**/*.test.ts`; regenerates assets first)
- Lint: `bun run lint` (ESLint flat config; includes the fixtures-import guardrail and the layering rules below)
- Generators only: `bun run gen` (stylesheet via `gen:css`, browser scripts via `gen:browser-scripts`; never edit `*.generated.ts` files)
- Browser test: `bunx playwright test` (requires a prior build; renders the sample through the built CLI)
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
- Keep logic in pure modules and unit-test it there; reserve Playwright for critical user journeys. Specs import `test`/`expect` from `test/fixtures` (lint-enforced) so every spec fails on console errors.
- Layering is lint-enforced, allow-list and default-deny: information flows one way, `cli` -> `render-document` -> { `markdown/`, `shell/`, `page` } -> { `icons/`, `escape-html` }. Each layer declares what it `mayImport` (validated to point strictly downward); everything else is banned. A completeness guard fails lint if any `src/` file is not assigned to a layer, so new files and folders must be placed in the model before they build. See `LAYERS`/`TIERS` in `eslint.config.mjs`.
- Tests are focused and user-oriented, use "should ... when ..." descriptions, and cover degenerate and boundary cases.

## Contribution workflow

- Sign off every commit for DCO: `git commit -s`.
- CI (GitHub Actions, `.github/workflows/ci.yml`) runs `bun run lint`, `bun run build`, and `bun run test` on every pushed branch, including `main` and same-repository PR head branches; fork PRs are not triggered yet.
- Work on feature branches and merge into `main`.
- Keep PRs small and reviewable; one self-contained increment per commit where possible.
