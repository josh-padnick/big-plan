---
title: Features
description: Everything the Big Plan viewer ships today, at a glance.
---

Everything on this page is shipped and works today.
For what comes next, see the [roadmap](/intro/roadmap/).

## Reading experience

- One reading column with warm, paper-like light and dark palettes.
- A theme control that follows your OS preference until you override it, then remembers your choice locally.
- A sticky branding bar whose logo follows the active theme.

## Navigation

- A table of contents built from the plan's level-two headings.
- A sticky sidebar on wide screens; a compact sticky `Sections` menu on narrow ones.
- Both track the section you're reading as you scroll.
- Section links scroll smoothly, unless you've asked your OS for reduced motion.

## Code

- Syntax highlighting for fenced code blocks with a declared language.
- Unknown and undeclared languages stay plain and readable.
- A copy control on every block code sample.

## Plan authoring

- A static subset of MDX: standard Markdown and GFM plus a closed component registry, without executable imports, exports, or expressions.
- Positional diagnostics that aggregate recoverable unsupported syntax, unknown components, invalid attributes, and malformed component content after MDX parses.
- `Callout` components for notes, tips, warnings, and dangers.
- `CodeDiff` components with optional line numbers and change counts, unified and side-by-side views, scoped line annotations, copy actions, and full-screen viewing.
- `CodeSnippet` components for excerpts with optional file identity, file-absolute line numbers, scoped annotations, and copy actions.
- `DatabaseTableSchema` components for one table's schema: a psql-style columns grid with key badges, foreign keys, indexes, checks, titled verbatim-DDL bands behind tabs, copy actions, and full-screen viewing.
- `FileTree` components for foldable plain hierarchies with optional per-entry notes.
- `FileTreeDiff` components with entry-level change status, summaries, persisted combined or side-by-side views, a Planned-pane final-state switch, fold controls, note hints, and full-screen viewing.
- `HttpEndpoint` components for HTTP contracts with location-grouped parameters, request examples, status-coded responses, and tabbed section navigation.
- `GraphqlOperation` components for queries, mutations, and subscriptions with literal argument types, one-level input and payload fields, and grouped executable examples with repeatable labeled responses.
- `GrpcMethod` components for streaming-aware proto signatures, message-typed request and response fields, gRPC status codes, grouped examples, and proto source.

## Output

- One self-contained HTML file: styling, behavior, and branding embedded.
- No external requests, ever.
- Readable with JavaScript disabled; scripts only enhance navigation, theming, code-copy controls, `CodeDiff`, `CodeSnippet`, `DatabaseTableSchema`, `FileTree`, and `FileTreeDiff` interactions, and `HttpEndpoint`'s tabbed section navigation.
- Renders anywhere Node.js 22+ runs, straight from `npx big-plan render`.

See the [CLI reference](/reference/cli/) for command details.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
