---
title: Installation
description: Install Big Plan and render your first plan in under a minute.
---

Big Plan is one command with no setup; install it globally or run it straight through `npx`.

## Prerequisite

Install Node.js 22 or newer.
The published package runs under plain Node.js, so Bun is not required.

```sh
node --version
```

## Run it without installing

`npx` fetches and runs the CLI in one step:

```sh
npx big-plan render plan.md
```

## Or install it globally

```sh
npm install -g big-plan
big-plan render plan.md
```

Either way, `render` writes `plan.html` next to the input.
Pass a second argument to choose the output path: `big-plan render plan.md reviews/plan.html`.

## Render your first plan

Download the example plan, or use any plan your agent has written:

```sh
curl -o plan.md https://big-plan.ai/demo/example-plan.md
npx big-plan render plan.md
```

Open `plan.html` in your browser, and you should see this:

![The example plan rendered in the Big Plan viewer, with section navigation, a comparison table, and themed reading column.](../../../assets/viewer-light.png)

The output is one self-contained HTML file: styling, behavior, and branding embedded, no external requests, readable even with JavaScript disabled.

## Use it with your agent

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

- [Walk through every feature.](/guides/walkthrough/)
- [Learn the plan document format.](/guides/authoring-plans/)
