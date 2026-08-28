---
title: Installation
description: Give your agent one stable prompt and it sets up the current Big Plan workflow.
---

The fastest install is the one you don't do yourself.

## Give this to your coding agent

Copy this prompt into your agent:

```text
Set up Big Plan for me: read https://big-plan.ai/setup.md and follow it.
```

The agent reads the server-controlled [setup guide](/setup.md), uses the current CLI without installing it, can install the thin skill shell, adopts the plan-review workflow, and adds the rule to your project's agent instructions so every future session keeps it.
Authoring principles stay in `big-plan guidance`, so package upgrades refresh them without hand-editing skill files.

## Or install it yourself

Big Plan needs Node.js 22 or newer; the published package runs under plain Node.js, so Bun is not required.

Run it with no install at all:

```sh
npx -y big-plan@latest guidance
npx -y big-plan@latest render plan.mdx
```

Or install it globally:

```sh
npm install -g big-plan@latest
big-plan guidance
big-plan render plan.mdx
```

Either way, `render` writes `plan.html` next to the input.
Pass a second argument to choose the output path: `big-plan render plan.mdx reviews/plan.html`.
Reading `guidance` first is required; it unlocks `render` for the working directory.

## Render your first plan

Download the example plan, or use any plan your agent has written:

```sh
curl -o plan.mdx https://big-plan.ai/demo/example-plan.md
npx -y big-plan@latest guidance
npx -y big-plan@latest render plan.mdx
```

Open `plan.html` in your browser, and you should see this:

![The example plan rendered in the Big Plan viewer, with section navigation, a comparison table, and themed reading column.](../../../assets/viewer-light.png)

The output is one self-contained HTML file with embedded assets, no external requests, and a complete reading experience when scripts are disabled.

## Next steps

- [See how Big Plan works under the hood.](/architecture/)
- [Learn the plan document format.](/for-agents/authoring-plans/)
