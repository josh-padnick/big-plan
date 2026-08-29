---
title: Features
description: Everything the Big Plan viewer ships today, at a glance.
---

Everything on this page is shipped and works today.

## Reading experience

- One reading column with coordinated light and dark variants for every colour theme.
- A `Settings` dialog built as a sidebar of settings pages beside the page you pick. A standalone document opens it from the branding bar's gear; a live review opens it from **More actions**. Every setting is its own page there, so none crowds another and a later one joins the sidebar instead of lengthening a page. On wide screens the sidebar is a narrow column beside a dominant content pane; on phones it becomes a compact row of pages above a single column, wrapping onto a second row rather than scrolling sideways.
- The `Appearance` page offers `Light`, `Dark`, and `System`. The choice applies immediately, is saved for every review document in this browser, and is applied before the first paint so the other appearance never flashes.
- The `Color theme` page offers `Default`, `Rosé Pine`, `Nord`, `Catppuccin`, and `Brutalist`. A theme is a palette rather than a mode: each one works in both light and dark, appearance still decides which, and every swatch previews that theme's own shades. The choice also applies immediately, is saved across review documents, and is restored before the first paint. `Default` is Big Plan's warm paper look and is what a document with no saved choice renders. `Brutalist` also squares cards and controls, replaces the soft shadows with hard offset slabs, and sets one weight heavier, so it changes the shape of the reading surface and not only its colours; pill-shaped badges stay round.
- `System` follows your OS preference, and is the value you get on a first run or when the browser refuses storage.
- The `Approval message` page holds the covering note saved with a plan approval for the agent handoff. One note covers every plan; there is no separate one per plan. It starts from a standard wording, accepts up to 2,000 characters, saves as you type, and `Reset to default` puts the standard wording back. Emptying the field does the same thing: a blank note falls back to the standard wording, so an approval never carries nothing. If the browser refuses to save, the field keeps what you typed and says so. Like the other settings, it is saved for every review document in this browser.
- A sticky branding bar whose logo follows the effective light or dark appearance, independently of the colour theme.
- In-document `Maximize` controls for fenced code, code snippets and diffs, tree diffs, data tables, database schemas, [flow diagrams](/components/flow-diagram/), and [wireframes](/components/wireframe/), with Escape restoring the reading view after any pending-feedback prompt is resolved.

## Navigation

- A table of contents built from the plan's level-two headings.
- A viewport-bounded sticky sidebar on wide screens, with a fixed `Contents` header and an independently scrolling section list that reveals the active entry when needed; a compact sticky `Sections` menu on narrow ones.
- Section links scroll smoothly, unless you've asked your OS for reduced motion.
- During a wide-screen section-link jump, the sidebar keeps its exact scroll position until the requested section becomes current, then resumes active-entry tracking.
- Collapse controls on Parts, slides, and sub-slides, plus document-wide expand-all and collapse-all controls in the table of contents; TOC jumps expand collapsed ancestors.
- Collapse choices, CodeDiff and FileTreeDiff views, and database-schema column order and visibility persist only for the exact source path and authored revision, so same-titled plans and distinct authored revisions never share viewer state.
- A static render's document-level review-comment draft follows that same revision-scoped browser-storage rule; live review persistence is described below.

## Live review

- `big-plan review` serves a loopback session with a per-plan review token, comments on slides, components, or selected text, plus plan-wide chat and coding-agent status.
- Sent feedback stays attached to durable threads while the connected coding agent answers, asks for input, declines, warns, or publishes a validated plan revision.
- **What changed** compares each request's claim-time baseline with its result, keeps later historical and stale-premise diffs reviewable, preserves structured component presentation, and guides the reviewer through accepting each changed place; comment threads then offer resolution.
- Confirmed decision answers are saved with the review and stay current only while their decision's content is unchanged; they are readable within the review session rather than delivered to the agent, and a standalone rendered document keeps answers for the reading session only.
- An **Inputs** list names what the review is still waiting for - for now, every decision the plan asks - with each one marked answered, not answered, or stale, and the ones the plan's author called critical marked as such.
- **Approve plan** sits in the branding bar of a live, authoritative review. The dialog shows change sets, decisions, and the covering note from Settings; confirming auto-accepts every change set, writes a durable approval record for the later agent handoff, and stamps the page approved. If the plan later changes, the bar offers Re-approve. Revoke returns the plan to review. Read-only sessions keep showing an approval already in force without offering approval actions; static documents do not show the control.
- **More actions** in a live review offers **Export** and **Settings**, in that order. Export downloads the latest committed plan source as portable Markdown, with every built-in component represented as semantic text. It includes current saved decision answers and an approval only when that approval matches the exported version. Comments, draft agent edits, feedback dispositions, and agent status are excluded. Standalone documents keep the Settings gear and do not offer export because they have no authoritative current source to read.
- Review state and feedback packages stay in an ignored, owner-only `.big-plan/` directory beside the plan.
- When stable-link publication succeeds, a review gets a stable local address that stays identical through runtime restarts, even when the replacement runtime's direct debugging address changes. The CLI presents this stable address as the one to open and labels the runtime address for debugging only; if publication is unavailable, it explains why and falls back to the direct runtime address. A small loopback service serves the live review while one runs, holds an unexpectedly interrupted review for its replacement, explains deliberate endings, starts itself when a command prints an address, and is inspected or stopped with `big-plan service`.

See [Reviewing a plan](/reference/reviewing/) for the workflow, persistence model, causal diff behavior, and trust boundaries.

## Feedback and revision

- `big-plan review` serves the plan locally for anchored comments, plan-wide chat, agent progress, revision-aware responses, and source diffs without an account or third-party service.
- `big-plan agent` connects a coding-agent session to that live review while the MDX remains authoritative; [Reviewing a plan](/reference/reviewing/) owns the workflow, persistence, revision, and trust-boundary details.

## Code

- Syntax highlighting for fenced code blocks with a declared language.
- Unknown and undeclared languages stay plain and readable.
- Keyboard-accessible copy controls for fenced code, code snippets and diffs, data tables, and database schemas; success replaces the copy icon with a check without shifting the toolbar, updates the accessible name, and suppresses the tooltip until the control resets.

## Plan authoring

- An MDX plan format made of standard Markdown, GFM, and built-in components; imports, exports, expressions, and inline JSX are rejected and never executed.
- Positional diagnostics that aggregate recoverable unsupported syntax, unknown components, invalid attributes, and malformed component content after MDX parses.
- `Slide` markers from a closed, growing catalog, with type-specific authoring guidance, derived structural names, plan-specific heading titles, and conservative objective lint.
- `DecisionAnalysis` components for weighty choices, rendered as keyed qualitative or weighted criteria matrices with lifecycle state, recommendations, required reversibility, optional interactive choice, and calculated totals.
- `Callout` components for notes, tips, warnings, and dangers.
- `CodeDiff` components with optional line numbers and change counts, unified and side-by-side views, and scoped line annotations.
- `CodeSnippet` components for excerpts with optional file identity, file-absolute line numbers, and scoped annotations.
- `DataTable` components for reference datasets with sorting, optional search, selectable and reorderable columns, grouping, and text-fit controls.
- `DatabaseTableSchema` components for one table's schema: a psql-style columns grid with key badges, foreign keys, indexes, checks, and titled verbatim-DDL bands.
- `FileTree` components for plain hierarchies with optional per-entry notes.
- `FileTreeDiff` components with entry-level change status, summaries, and combined or side-by-side before/after views.
- `HttpEndpoint` components for HTTP contracts with location-grouped parameters, request examples, and status-coded responses.
- `GraphqlOperation` components for queries, mutations, and subscriptions with literal argument types, one-level input and payload fields, and grouped executable examples with repeatable labeled responses.
- `GrpcMethod` components for streaming-aware proto signatures, message-typed request and response fields, gRPC status codes, grouped examples, and proto source.
- `QuickDecision` components for standalone brief questions with recommendations and an answer flow, without a comparison expander.
- `Wireframe` components for true-width product screens with device-honest fixed or growing frames, walkable prototypes, opt-in common layout patterns, and an open vocabulary for custom layouts, including named glyphs as standalone marks or inside controls, verbatim references drawn as one bordered object with the copy control inside it, surfaces layered over the page with a dimmed or clear backdrop, and toolbars anchored at both ends.

## Output

- Local, self-contained review delivery; the [two-artifact delivery ADR](https://github.com/josh-padnick/big-plan/blob/main/adr/0001-two-artifact-plan-delivery.md) owns the artifact and script-behavior contract.
- No external requests, ever.
- Renders anywhere Node.js 22+ runs, straight from `npx -y big-plan@latest render`.

See the [CLI reference](/reference/cli/) for command details.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
