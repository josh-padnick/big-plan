---
title: Walkthrough
description: Tour every Big Plan feature, from rendering a plan to typed blocks, annotations, and fail-loud validation.
---

This walkthrough follows one plan from markdown file to reviewed document, showing each feature along the way.

Prefer to explore first?
[Open the fully rendered example plan in your browser](/demo/), exactly as `big-plan render` produced it, then come back for the tour.
Or [install Big Plan](/intro/installation/) and render it yourself as you follow along.

## Render a plan

One command turns the plan file into the review document:

```sh
npx big-plan render plan.md
```

The output is a single self-contained HTML file: no server, no external requests, readable with JavaScript disabled.

:::note[📸 Screenshot placeholder]
Terminal showing the render command and its structured result (rendered path, title, section count).
:::

## Read without squinting

The viewer gives every plan the same calm shape: one reading column, warm paper-like palettes, and a sticky branding bar.
The theme follows your OS preference until you override it, and your choice is remembered locally.

:::note[📸 Screenshot placeholder]
The same plan section in light and dark themes, side by side, with the theme control visible.
:::

## Navigate big plans

The table of contents is built from the plan's level-two headings: a sticky sidebar on wide screens, a compact `Sections` menu on narrow ones.
Both track the section you're reading as you scroll, and section links scroll smoothly unless your OS asks for reduced motion.

:::note[📸 Screenshot placeholder]
The contents rail with the current section highlighted mid-scroll; the mobile `Sections` disclosure next to it.
:::

## Start from plain markdown

Everything GFM gives you works: tables, task lists, footnotes, and fenced code with syntax highlighting and a copy control on every sample.
A plan that never uses a typed block still renders beautifully.

## Make the important parts impossible to miss

`Callout` puts the sentences a reviewer must read, even when skimming, inside an accent-bordered panel with a typed icon: `note`, `tip`, `warning`, or `danger`.

```mdx
<Callout type="warning" title="Deploy ordering">

Enable the worker before stale reads.

</Callout>
```

:::note[📸 Screenshot placeholder]
All four callout types stacked, showing the distinct accents in one theme.
:::

## Review code changes as diffs

`CodeDiff` takes verbatim `git diff` output and renders a first-class review surface: a file header, switchable unified and side-by-side views, line-number gutters, change counts, copy actions, and a full-screen mode.

:::note[📸 Screenshot placeholder]
A CodeDiff block in side-by-side view with line numbers and the header stats visible.
:::

Nest `Annotation` blocks to anchor a note to specific lines; the card renders right beneath the lines it explains, and covered lines carry an accent spine.

:::note[📸 Screenshot placeholder]
A CodeDiff with an annotation card pinned under its line range.
:::

## Explain code line by line

`CodeSnippet` is for excerpts a reviewer must inspect closely: a file association, real line numbers starting from the file's actual line, and the same line-anchored `Annotation` cards.
Plain samples should stay plain fences; `CodeSnippet` exists for the three things a fence cannot express.

:::note[📸 Screenshot placeholder]
An annotated snippet with the file header, file-absolute gutter, one tinted anchor line, and its annotation card.
:::

## Trust what you approve

A plan document is static-subset MDX, and the renderer never evaluates code from a plan.
An invalid document never renders partially: validation collects every problem and fails with the complete list, each entry carrying a `line:column` position, so agents can fix everything in one pass.

```text
error: Cannot render document with invalid MDX
help[3]: "3:1 ESM import/export statements are not supported",
         "5:14 Text expressions are not supported",
         "7:1 Unknown block \"Unknwon\""
```

See [Authoring plans](/guides/authoring-plans/) for the full contract.

## What's next

The component library keeps growing: `Decision` and `FileTree`, then `ApiEndpoint` and `DatabaseSchema`, then `Diagram`, followed by the live review server with comments and agent chat.
The [components overview](/components/) tracks the current library, and the [roadmap](/intro/roadmap/) tracks everything else.
