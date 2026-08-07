---
title: Features
description: Everything the Big Plan viewer ships today, at a glance.
---

Everything on this page is shipped and works today.

## Reading experience

- One reading column with warm, paper-like light and dark palettes.
- A `Settings` dialog behind the branding bar's gear, offering `Light`, `Dark`, and `System` appearance; phones get compact full-width choices in a centered, internally scrollable sheet, while wider screens keep the three-card layout. The choice applies immediately, is saved for every review document in this browser, and is applied before the first paint so the other palette never flashes.
- `System` follows your OS preference, and is the value you get on a first run or when the browser refuses storage.
- A sticky branding bar whose logo follows the active theme.
- In-document `Maximize` controls for fenced code, code snippets and diffs, tree diffs, data tables, database schemas, [flow diagrams](/components/flow-diagram/), and [wireframes](/components/wireframe/), with Escape restoring the reading view after any pending-feedback prompt is resolved.

## Navigation

- A table of contents built from the plan's level-two headings.
- A sticky sidebar on wide screens; a compact sticky `Sections` menu on narrow ones.
- Section links scroll smoothly, unless you've asked your OS for reduced motion.
- Collapse controls on Parts, slides, and sub-slides, plus document-wide expand-all and collapse-all controls in the table of contents; TOC jumps expand collapsed ancestors.
- Collapse choices, CodeDiff and FileTreeDiff views, database-schema column order and visibility, and a document-level review-comment draft persist only for the exact source path and authored revision, so same-titled plans and distinct authored revisions never share viewer state.

## Code

- Syntax highlighting for fenced code blocks with a declared language.
- Unknown and undeclared languages stay plain and readable.

## Plan authoring

- An MDX plan format made of standard Markdown, GFM, and built-in components; imports, exports, expressions, and inline JSX are rejected and never executed.
- Positional diagnostics that aggregate recoverable unsupported syntax, unknown components, invalid attributes, and malformed component content after MDX parses.
- `Slide` markers from a closed, growing catalog, with type-specific authoring guidance, derived structural names, plan-specific h2 titles, and conservative objective lint.
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
- `QuickDecision` components for standalone brief questions with recommendations and a reading-session answer flow, without a comparison expander.
- `Wireframe` components for true-width product screens with device-honest fixed or growing frames, walkable prototypes, opt-in common layout patterns, and an open vocabulary for custom layouts.

## Output

- A plan ships as two review artifacts: the authoritative MDX source and one self-contained interactive HTML render. The render stays readable with scripts disabled; its interactive affordances may require the embedded viewer scripts.
- With JavaScript disabled, the render explains that its full content remains readable while interactive affordances such as sorting, collapse, maximize, and comments are unavailable.
- One self-contained HTML file with styling and branding embedded.
- A tiny embedded head script that applies a saved appearance before the first paint, an embedded settings script for the appearance dialog, and one embedded viewer script (TOC scroll-spy, hover popovers, CodeDiff and FileTreeDiff view selection, deck collapse, database-schema columns and index jumps, comment drafts, figure maximize, flow-diagram review, and wireframe navigation and scaling); content stays fully readable with scripts disabled.
- No external requests, ever.
- Renders anywhere Node.js 22+ runs, straight from `npx big-plan render`.

See the [CLI reference](/reference/cli/) for command details.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
