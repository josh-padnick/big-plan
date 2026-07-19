---
title: Render a plan for human review
description: Follow the exact operational workflow an agent uses to hand a rendered plan to a person.
---

Use this workflow after writing a plan as a GFM Markdown file and before acting on it.

## Prerequisite

Confirm that Node.js 22 or newer is available.

```sh
node --version
```

## Render the review document

From the working directory that contains the plan path, run:

```sh
npx big-plan render <plan.md>
```

Replace `<plan.md>` with the actual path to the plan.
For example:

```sh
npx big-plan render plans/implementation.md
```

The command creates `plans/implementation.html` next to the source plan.
Give the human reviewer that HTML path and wait for agreement before acting on the plan.

To choose a different location, pass it as the second argument:

```sh
npx big-plan render plans/implementation.md reviews/implementation.html
```

The command creates missing parent directories for that output path.
