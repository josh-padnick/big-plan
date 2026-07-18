---
title: What is Big Plan?
description: Big Plan turns your agent's markdown plan into a document built for review.
---

Big Plan turns your agent's standard text plan into a rich, interactive HTML document specially designed for human review.

Run it in your favorite agent harness (Claude Code, Codex, etc.) as a skill like this:

```
Give me a /big-plan for implementing the following feature...
```



## Let's see an example

This is what a rendered plan looks like

<!-- TODO: Update screenshot to show the full window, including the table of contents -->
<!-- TODO: Show light mode and dark mode as optional tabs, not one after the other. -->

![The example plan rendered in the Big Plan viewer's light theme: a warm paper-like reading column with section navigation and a comparison table.](../../../assets/viewer-light.png)

<!-- TODO: Update screenshot to show actual components -->

And in dark mode:

![The example plan rendered in the Big Plan viewer's dark theme, with the same layout on a dark palette.](../../../assets/viewer-dark.png)

Some parts of this plan are plain-old markdown.

But take a look at the the **code diff** and **HTTP endpoint** sections. Those are examples of [big plan components](../components/index.md) that are specially designed to render common types of information in a first-class way. Big Plan ships today with over a dozen components, and because it's open source, it's easy to add more as we find the need.

But wait, there's more! You can also comment on specific parts of a big-plan, track plan versions, navigate the plan with vim shortcuts,and enforce plan templates. Plus, it all runs locally without the need for any third-party service. To see it in action, [install it](./installation.md), or check out our [walkthrough](./walkthrough.md).

## Why Big Plan?

Agent plans are kind of a big deal.

In a typical AI workflow, the more confident you are in the AI plan, the better your agent will perform at the execution step and the faster your final review will go.

But by default, agent plans render as a wall of text that's painful to read. We think of these plans of limited ambition as "small plans." Surely we can do better! 

If plans are so important for the human, they should present in a first-class way. We think of these plans of large abmbition as "big plans." And indeed we can do better!

<!-- TODO: Put this content elsewhere, maybe a how it works? -->

## How it works

1. Your agent writes its plan to a markdown file.
2. You run `npx big-plan render plan.md`.
3. You open the rendered document and review it.
4. If you want changes, tell the agent; it revises the file, and you render again.

Big Plan works with any agent that can write a file: Claude Code, Codex, Cursor, or your own.

## Next step

<!-- TODO: Update this to flow more naturally -->

[Render your first plan in under a minute.](/intro/quickstart/)
