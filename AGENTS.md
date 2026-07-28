# Big Plan agent guide

This is the entry point for agents working in Big Plan.
Read the product orientation first, then follow the documentation map and linked references for detail.

## What Big Plan is

Good AI output depends on a great plan, and Big Plan makes reviewing agent plans a first-class experience.
Planning is an essential part of effective development with AI, and it deserves a first-class experience.
Big Plan is built around one question: what is the best way to review a plan and reach agreement on it, before an agent acts?

An agent writes its plan as a document on disk, and Big Plan renders it into a rich local review surface.
The long-term shape includes components for diagrams, schemas, API endpoints and code diffs, a live chat connection to the authoring agent, highlight-to-comment threads, and versioned change review.
Big Plan focuses exclusively on that upfront moment of agreement - not code review, not project management.
Everything runs locally, and the file on disk is the source of truth.

## Current state

Deliverable 2 is shipped in this repo, now rendered end to end by the React component library: MDX plan documents with components, compiled once and delivered as machine JSON or self-contained human HTML.
`big-plan render <input.mdx> [output.html]` converts a static-subset MDX plan document into a single self-contained themed HTML document, and `big-plan compile <input.mdx> [output.json]` emits the same validated plan model as JSON for agents and tools.
The static subset rejects imports, exports, expressions, and unsupported attributes with hard-fail diagnostics carrying line and column positions, while the built-in BigDecision, Callout, CodeDiff, CodeSnippet, DatabaseTableSchema, FileTree, FileTreeDiff, GraphqlOperation, GrpcMethod, HttpEndpoint, and SmallDecisionSet components provide validated plan-native presentation.
GFM tables, task lists, footnotes, and autolinks remain supported, but MDX does not support four-space indented code blocks; plans use fenced code blocks instead.
Supported declared fenced-code languages receive syntax highlighting, and readers' OS light/dark preference styles the document through CSS alone.
Rendered documents are deliberately inert: they ship no scripts, make no external requests, and remain fully readable everywhere - navigation runs on native anchors, the mobile `Sections` disclosure and every component detail drawer are native `details` elements, wide content scrolls inside its own containers, and controls that would need a script never appear.
Interactive review aids - theme override, copy controls, diff view switching, tabbed sections, full-screen viewing, option selection, and criterion weighting - belong to the forthcoming live review application, which hydrates the same components.

## Architecture at a glance

The pipeline is deliberately small: CLI -> renderer -> self-contained HTML or plan-model JSON.

- The CLI (`src/cli/`) is built on `runAxiCli()` from `axi-sdk-js`, which owns dispatch, help, structured errors, and output serialization. `derived-output-command.ts` owns the shared safe read, derive, guarded-write, and result sequence; individual commands supply only output-specific facts.
- The plan model (`src/model/`) owns the framework-free contract consumed by render targets: compiled component models, shared attribute validation and diagnostics, and `authored-body.ts` for structural fence mechanics. It imports no other project-local layer; `eslint.config.mjs` enforces that boundary.
- The UI library (`src/ui/`) owns reusable React views that consume compiled models from `src/model/`. It does not serialize them. React icons render the local official Lucide icon-node data directly, while model-carried prose crosses the HAST-to-React bridge.
- The renderer (`src/render/`) is pure: MDX source plus a fallback title in, complete HTML or a validated plan model out. It uses unified (remark-parse, remark-gfm, remark-mdx, remark-rehype) to compile the static subset into structured HAST, captures authored title/sections after heading slugging, then compiles each registered plan element once. Model delivery stops before top-level presentation; HTML delivery crosses the single React-to-HAST adapter before syntax highlighting and table wrapping. Nested presentation is materialized only when a parent model must retain it inside authored HAST. Parsing and component validation collect positional diagnostics and hard-fail before delivery, and rehype-stringify serializes HTML only after transforms finish. The shell uses final rendered ids to allocate a collision-free mobile `Overview` anchor.
- The review shell (`src/render/shell/`) owns the viewer's look: one reading column, warm paper-like light and dark palettes that follow `prefers-color-scheme`, a sticky branding bar whose logo art follows the active theme, a sticky desktop section sidebar, and a compact sticky mobile `Sections` disclosure. The page envelope (`src/render/page.ts`) separately owns how an inert document is packaged and delivered (doctype, head, inlined styles, and favicon links); future delivery modes swap the envelope while the shell stays the same.
- Styles are authored with Tailwind v4.
  `src/render/global.css` is the entry point and owns design tokens, the light and dark palettes, the layout breakpoint, target scroll margins, and page-level rules.
  Element-scoped styles for plain markdown elements live in `src/render/markdown/prose.css`, and the syntax-token palette lives in `src/render/markdown/code-block/syntax-highlighting.css`.
  Authored markup carries Tailwind utility classes where practical; stylesheet rules handle plain markdown elements, highlighter token spans, palette-dependent component variants, and stateful diff layouts.
  `scripts/gen-css.mjs` compiles the entry point (inlining its imports) and embeds the result as a generated TypeScript module, so rendered documents inline the full stylesheet and stay self-contained.
- Branding assets (the logos and favicons in `assets/`) are embedded by `scripts/gen-assets.mjs` as a generated data-URI module, so the branding bar and favicon ship inside the document like everything else.

Future deliverables build outward from this core with a local server and browser bridge for live agent chat and comments.

## Tech stack

- **Runtime target**: Node.js >= 22, ESM only. The published package runs under plain Node so `npx big-plan` works everywhere; Bun is a development-time choice, not a runtime requirement.
- **Package manager and script runner**: Bun (`bun install`, `bun run <script>`, `bun.lock`).
- **Language**: TypeScript, strict, compiled with tsc; UI components are TSX compiled with the automatic JSX runtime.
- **CLI framework**: `axi-sdk-js` (dispatch, help, structured errors, TOON output).
- **Markdown pipeline**: unified (remark-parse, remark-gfm, remark-mdx, remark-rehype, rehype-slug, rehype-highlight, rehype-stringify).
- **React**: reusable React views live in `src/ui/`; the renderer's one React-to-HAST adapter owns `renderToStaticMarkup` for HTML delivery. Model delivery skips top-level presentation; it materializes only a nested component whose HAST must remain inside a parent model's authored body for JSON compatibility. `hast-util-to-jsx-runtime` bridges model-carried HAST prose into React. Nothing React ships in rendered output.
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
- Icons all come from Lucide and live one file per icon in `src/render/icons/lucide/`, named by the Lucide catalog name; a component never defines icon path data locally.
- Generated files always carry `.generated.` in their name (for example `global.generated.ts`) and are never edited by hand.
  They are committed so the codebase is scannable without running the generators; after changing a generator or its inputs, run `bun run gen` and commit the regenerated output alongside (CI fails on drift).
- `global.css` owns design tokens, palettes, and page-level rules only; component-specific styles are colocated with the component and imported from `global.css`; authored markup prefers Tailwind utilities, and stylesheet rules are reserved for variants, state, pseudo-elements, and live-application-created elements.
- Keep logic in pure modules and unit-test it there; reserve Playwright for critical user journeys.
- Tests are focused and user-oriented, use "should ... when ..." descriptions, and cover degenerate and boundary cases.
- Long browser journeys narrate as named `test.step` phases - short present-tense claims such as "the jump lands the heading clear of the sticky bar" - so a test reads top to bottom as a story and a failure names its phase.
  Setup locators shared across phases are declared once before the first step, and shared assertion plumbing (such as `boxOf`) lives in `test/fixtures.ts` rather than being repeated inline.
