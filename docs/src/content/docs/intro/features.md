---
title: Features
description: Everything the Big Plan viewer ships today, at a glance.
---

Everything on this page is shipped and works today.

## Reading experience

- One reading column with warm, paper-like light and dark palettes.
- A palette that follows your OS preference through CSS alone.
- A sticky branding bar whose logo follows the active theme.

## Navigation

- A table of contents built from the plan's level-two headings.
- A sticky sidebar on wide screens; a compact sticky `Sections` menu on narrow ones.
- Section links scroll smoothly, unless you've asked your OS for reduced motion.

## Code

- Syntax highlighting for fenced code blocks with a declared language.
- Unknown and undeclared languages stay plain and readable.

## Plan authoring

- An MDX plan format made of standard Markdown, GFM, and built-in components; imports, exports, expressions, and inline JSX are rejected and never executed.
- Positional diagnostics that aggregate recoverable unsupported syntax, unknown components, invalid attributes, and malformed component content after MDX parses.
- `ComplexDecision` components for weighty choices, rendered as scored criteria matrices or substantive option lists with lifecycle state, recommendations, optional reversibility, and outcomes.
- `Callout` components for notes, tips, warnings, and dangers.
- `CodeDiff` components with optional line numbers and change counts, a unified view, and scoped line annotations.
- `CodeSnippet` components for excerpts with optional file identity, file-absolute line numbers, and scoped annotations.
- `DatabaseTableSchema` components for one table's schema: a psql-style columns grid with key badges, foreign keys, indexes, checks, and titled verbatim-DDL bands.
- `FileTree` components for plain hierarchies with optional per-entry notes.
- `FileTreeDiff` components with entry-level change status, summaries, and a combined change tree.
- `HttpEndpoint` components for HTTP contracts with location-grouped parameters, request examples, and status-coded responses.
- `GraphqlOperation` components for queries, mutations, and subscriptions with literal argument types, one-level input and payload fields, and grouped executable examples with repeatable labeled responses.
- `GrpcMethod` components for streaming-aware proto signatures, message-typed request and response fields, gRPC status codes, grouped examples, and proto source.
- `SimpleDecisionSet` components for compact numbered lists of briefly explained options, with recommendations marked inline.

## Reviewing

- Comment on any block: a heading, paragraph, list, table, code figure, or component.
- Comment on any span of text you highlight, or on a line range inside a code figure.
- A Feedback tray that collects drafts, opens with your first comment, and hides whenever you want the column back.
- Edit and delete anything before it reaches the agent.
- One action sends every pending comment as a single feedback package, plus a Markdown brief the agent can read directly.
- An always-present agent panel: one compose field for whole-plan notes, and progress after you send.
- Keyboard navigation over blocks, and drafts that survive closing the tab.
- Everything runs locally through `npx big-plan review`; nothing leaves the machine.

See [Reviewing a plan](/reference/reviewing/) for the whole loop and its trust boundaries.

## Output

- One self-contained HTML file with styling and branding embedded.
- No plan-authored script ever executes; the only scripts are the shell's own viewer and commenting code, and content stays fully readable with scripts disabled.
- No external requests, ever.
- Renders anywhere Node.js 22+ runs, straight from `npx big-plan render`.

See the [CLI reference](/reference/cli/) for command details.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
