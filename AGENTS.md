# Big Plan agent guide

This is the entry point for agents working in Big Plan.
Read the product orientation first, then follow the documentation map and linked references for detail.

## What Big Plan is

Good AI output depends on a great plan, and Big Plan makes reviewing agent plans a first-class experience.
Planning is an essential part of effective development with AI, and it deserves a first-class experience.
Big Plan is built around one question: what is the best way to review a plan and reach agreement on it, before an agent acts?

An agent writes its plan as a document on disk, and Big Plan renders it into a rich local review surface.
The long-term shape includes section navigation, typed blocks for diagrams, schemas, API endpoints and code diffs, a live chat connection to the authoring agent, highlight-to-comment threads, and versioned change review.
Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the file on disk is the source of truth.

## Current state

Deliverable 1 is shipped in this repo: a static markdown viewer.
`big-plan render <input.md> [output.html]` converts a plain GFM markdown file into a single self-contained themed HTML document with a responsive table of contents built from level-two headings.
Wide screens use a sticky sidebar; narrower screens use a sticky `Sections` disclosure showing the section count.
Both navigation variants track the current section while the reader scrolls, including short final sections at the bottom of the page, and section links scroll smoothly unless the reader has requested reduced motion.
Declared fenced-code languages receive syntax highlighting, every block code sample gets a copy control, and readers can override the OS light/dark preference with a locally persisted theme control.
Every viewport has a sticky branding bar whose logo follows that active theme, while embedded light and dark favicons follow the OS preference.
The output makes no external requests and remains readable with JavaScript disabled; inline scripts progressively enhance the table of contents, theme control, and code-copy controls.

## Architecture at a glance

The pipeline is deliberately small: CLI -> renderer -> self-contained HTML.

- The CLI (`src/cli/`) is built on `runAxiCli()` from `axi-sdk-js`, which owns dispatch, help, structured errors, and output serialization. Keep the integration thin; business logic never lives in the CLI layer.
- The renderer (`src/render/`) is pure: markdown source plus a fallback title in, complete HTML out. It uses unified (remark-parse, remark-gfm, remark-rehype, rehype-slug, rehype-highlight) to compile markdown into a structured Hypertext Abstract Syntax Tree (HAST) review document, collects the title, section outline, and element ids from that tree, applies rehype transforms such as syntax highlighting, code-copy controls, and table scroll-container wrapping, and serializes with rehype-stringify only after all transforms finish. The shell uses those ids to allocate a collision-free mobile `Overview` anchor.
- The review shell (`src/render/shell/`) owns the viewer's look: one reading column, warm paper-like light and dark palettes that follow `prefers-color-scheme` until explicitly toggled, a sticky branding bar whose logo art follows the active theme, code-block controls, a sticky desktop section sidebar, and a compact sticky mobile `Sections` disclosure. The page envelope (`src/render/page.ts`) separately owns how a document is packaged and delivered (doctype, head, inlined styles, favicon links, and scripts); future delivery modes swap the envelope while the shell stays the same.
- Styles are authored with Tailwind v4.
  `src/render/global.css` is the entry point and owns only what is genuinely global: design tokens, the light and dark palettes and theme overrides, theme-aware branding logo visibility, the layout breakpoint, and target scroll margins.
  Feature styles live with the module that emits their markup: element-scoped styles for plain markdown elements in `src/render/markdown/prose.css`, and the syntax-token palette in `src/render/markdown/code-block/syntax-highlighting.css`.
  Authored markup - the shell and the code-block controls - carries Tailwind utility classes directly; only markup the renderer cannot attach classes to (plain markdown elements, highlighter token spans) gets stylesheet rules.
  `scripts/gen-css.mjs` compiles the entry point (inlining its imports) and embeds the result as a generated TypeScript module, so rendered documents inline the full stylesheet and stay self-contained.
- Browser-side scripts are authored as real TypeScript in `*.browser.ts` files co-located with the concern they belong to (type-checked against `tsconfig.browser.json`, which adds the DOM lib) and compiled by `scripts/gen-browser-scripts.mjs` into generated modules the shell inlines. Shipped documents never reference external code.
- Branding assets (the logos and favicons in `assets/`) are embedded by `scripts/gen-assets.mjs` as a generated data-URI module, so the branding bar and favicon ship inside the document like everything else.

Future deliverables build outward from this core: a typed block registry, MDX plan documents, and a local server with a browser bridge for live agent chat and comments.

## Tech stack

- **Runtime target**: Node.js >= 22, ESM only. The published package runs under plain Node so `npx big-plan` works everywhere; Bun is a development-time choice, not a runtime requirement.
- **Package manager and script runner**: Bun (`bun install`, `bun run <script>`, `bun.lock`).
- **Language**: TypeScript, strict, compiled with tsc; browser-side scripts type-check against `tsconfig.browser.json` (DOM lib) and are transpiled into generated modules.
- **CLI framework**: `axi-sdk-js` (dispatch, help, structured errors, TOON output).
- **Markdown pipeline**: unified (remark-parse, remark-gfm, remark-rehype, rehype-slug, rehype-highlight, rehype-stringify).
- **Styling**: Tailwind v4, compiled at build time by `@tailwindcss/cli` into a generated module; no runtime CSS tooling.
- **Linting**: ESLint v10 flat config with `typescript-eslint`; conventions and architectural guardrails live in `eslint.config.mjs`.
- **Tests**: vitest for units (colocated in `src/**`), Playwright (chromium) for browser journeys.

## Documentation map

Keep `AGENTS.md` as the entry point; `CLAUDE.md` is a harness shim (symlink) back to this guide.
Satellite docs point back here before giving local guidance.

### Where a fact lives

Every guidance fact has exactly one owning layer; everywhere else points to the owner instead of restating it.
Route by the kind of fact:

- A fact about one file lives in that file's header comment; a fact a check enforces lives in the check and its error message (the architectural layering model, for example, lives in `eslint.config.mjs`).
- A technology coding standard lives in `fabricahq/app/_rules`; because that repo is private, the [Engineering rules](#engineering-rules) section below carries the working set for this repo.
- Setup, build, run, and usage procedures live in the root [README.md](./README.md).
- The contribution workflow (DCO, branches, PR expectations, CI) lives in [CONTRIBUTING.md](./CONTRIBUTING.md).
- A directory-scoped, multi-file, unenforced boundary lives in that directory's `README.md` local map.
- Product orientation, architecture, and cross-cutting conventions with no deeper owner live in this guide.

Layers this repo does not need yet (skills, ADRs, long-form reference docs, planning artifacts) are added only when demand appears, following the same one-owner rule.

### README principles

`README.md` files are local maps at decision points, the directory levels where an agent chooses where code belongs; they are never policy.
A local map is a pointer line (this guide plus the single most useful parent map), an ownership paragraph (what the directory owns, and which owners hold what is not here), and at most a few boundary bullets.
Hold every sentence to these five principles:

1. **Earn existence.** A README exists only at a decision point.
   If, after applying the other four principles, nothing remains beyond an ownership statement obvious from the path plus the parent's conventions, delete the whole file.
   Test: could the parent map's conventions plus `ls` answer every placement question this README answers? Then the file should not exist.
2. **One fact, deepest owner.** Every fact lives at the deepest layer that owns it, exactly once, per the routing list above.
   The README keeps only what has no deeper owner: directory-scoped, multi-file, unenforced boundaries.
   Test: open the file, check, or rule the sentence is about. Is the fact already there (or should it be)? Move it down and delete the README copy.
3. **Nothing derivable.** Cut any sentence that is an instance of a convention stated by a parent map or `AGENTS.md`, a rephrase of the README's own ownership paragraph, or reconstructible from `ls` and the path.
   Test: is this sentence true of most sibling directories too? Then it belongs to the parent, not here.
4. **Point, never restate.** Routing is one sentence naming the owner: a doc, check, rule, or external repo.
   No summaries of what the owner says, no reading lists another layer already carries, no duplicated command sequences.
   Test: if the pointed-at owner changed its content tomorrow, would this README need an edit? Then it restated instead of pointed.
5. **No inventories, no now.** Never list files or subfolders with descriptions, never count things, and never describe current state: no "currently", "temporary", "until X graduates", "the only Y so far".
   The tree describes itself; state changes without warning.
   Test: would adding, renaming, or finishing one file make this sentence false? Cut it.

Guidance is demand-driven: add a doc, rule, or map entry only when an agent observably failed or had to ask something it should not have needed to, never speculatively.

## Engineering rules

Big Plan follows the technology rules maintained in `fabricahq/app/_rules` (see the TypeScript and Playwright aggregates there).
That repo is the source of truth, and because it is private, this section carries the working set of conventions for this repo.

Facts a check enforces live in the check: separate type imports, the `any` and non-null-assertion bans, the allow-list architectural layering model (`LAYERS`/`TIERS`), and the Playwright fixtures requirement are all lint-enforced and documented in place in `eslint.config.mjs`.

The unenforced conventions to hold by hand:

- Named exports only; type aliases over interfaces; literal unions over enums; no type assertions (`as`).
- Single-object args for multi-parameter functions; immutable data (`readonly`, `const`).
- Colocate code and tests by feature; kebab-case file names.
- Every authored file starts with a file-level comment saying what it owns or why it exists; every non-trivial function gets a concise description above it (trivial one-liners stay uncommented); comments explain why, not what.
- Generated files always carry `.generated.` in their name (for example `global.generated.ts`) and are never edited by hand.
  They are committed so the codebase is scannable without running the generators; after changing a generator or its inputs, run `bun run gen` and commit the regenerated output alongside (CI fails on drift).
- Keep logic in pure modules and unit-test it there; reserve Playwright for critical user journeys.
- Tests are focused and user-oriented, use "should ... when ..." descriptions, and cover degenerate and boundary cases.
