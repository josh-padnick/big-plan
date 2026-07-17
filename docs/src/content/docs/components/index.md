---
title: Components
description: Typed blocks that turn plan sections into structured, reviewable content.
---

Plans are more than prose.
They contain decisions, code changes, schemas, and risks, and each of those deserves purpose-built review UI instead of another wall of text.
Components are Big Plan's typed blocks: an agent marks a section of the plan as a specific kind of content, and the viewer renders it with controls made for reviewing that kind of content.

:::caution[Planned]
Components ship with the structured MDX plan format on the [roadmap](/intro/roadmap/).
The current static viewer renders plain GFM markdown.
:::

## The component library

| Component | What it is for |
| --- | --- |
| [Callout](/components/callout/) | Surface a decision, risk, or open question so reviewers cannot miss it. |
| [CodeDiff](/components/code-diff/) | Show a proposed code change as a reviewable before-and-after diff. |
| [CodeSnippet](/components/code-snippet/) | Present a code sample with language, filename, and copy control. |

Each component page documents its purpose, props, and authoring example as the component ships.
