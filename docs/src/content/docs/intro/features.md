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

- A static subset of MDX: standard Markdown and GFM plus a closed registry of typed blocks, without executable imports, exports, or expressions.
- All-at-once positional diagnostics for unsupported syntax, unknown blocks, invalid attributes, and malformed block content.
- `Callout` blocks for notes, tips, warnings, and dangers.
- `CodeDiff` blocks with optional line numbers and change counts, unified and side-by-side views, scoped line annotations, copy actions, and full-screen viewing.

## Output

- One self-contained HTML file: styling, behavior, and branding embedded.
- No external requests, ever.
- Readable with JavaScript disabled; scripts only enhance navigation, theming, code-copy controls, and `CodeDiff` interactions.
- Renders anywhere Node.js 22+ runs, straight from `npx big-plan render`.

See the [CLI reference](/reference/cli/) for command details.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
