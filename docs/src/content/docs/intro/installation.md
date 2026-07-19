---
title: Installation
description: Give your agent one prompt and it installs Big Plan and sets up the plan-review workflow.
---

The fastest install is the one you don't do yourself.

## Give this to your coding agent

Copy this prompt into your agent:

```text
Install Big Plan for me using `npm i -g big-plan`, then read
https://big-plan.ai/setup.md and set yourself up to use it.
```

The agent installs the CLI, reads [setup.md](/setup.md), adopts the plan-review workflow, and adds the rule to your project's agent instructions so every future session keeps it.

## Or install it yourself

Big Plan needs Node.js 22 or newer; the published package runs under plain Node.js, so Bun is not required.

Run it with no install at all:

```sh
npx big-plan render plan.md
```

Or install it globally:

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

## Next steps

- [Walk through every feature.](/guides/walkthrough/)
- [Learn the plan document format.](/guides/authoring-plans/)
