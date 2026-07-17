---
title: Quickstart
description: Render your first plan into a reviewable document in under a minute.
---

Render a plan, open it, and see what your agent is really proposing.

## 1. Check the prerequisite

Install Node.js 22 or newer.
The published package runs under plain Node.js, so Bun is not required.

```sh
node --version
```

## 2. Get a plan

Download the example plan, or use any markdown plan your agent has written:

```sh
curl -o plan.md https://big-plan.ai/demo/example-plan.md
```

## 3. Render it

```sh
npx big-plan render plan.md
```

This writes `plan.html` next to the input.
Open it in your browser, and you should see this:

![The example plan rendered in the Big Plan viewer, with section navigation, a comparison table, and themed reading column.](../../../assets/viewer-light.png)

The output is one self-contained HTML file: styling, behavior, and branding embedded, no external requests, readable even with JavaScript disabled.
Pass a second argument to choose the output path: `npx big-plan render plan.md reviews/plan.html`.

## 4. Use it with your agent

The real workflow starts with your agent writing the plan.
Give your agent an instruction like:

```text
Before writing any code, write your implementation plan to plan.md,
run `npx big-plan render plan.md`, and ask me to review the rendered
plan. Do not start implementing until I agree.
```

When you want changes, tell the agent; it revises the file, renders again, and you review again.
See [For Agents](/for-agents/) for the operational version of this workflow.

## Next steps

- [Explore the viewer's reading experience.](/guides/the-viewer/)
- [See what's planned next.](/intro/roadmap/)
