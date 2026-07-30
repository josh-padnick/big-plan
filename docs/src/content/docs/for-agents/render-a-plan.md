---
title: Render a plan for human review
description: Follow the exact operational workflow an agent uses to hand a rendered plan to a person.
---

Use this workflow after writing an MDX plan file containing Markdown and built-in components and before acting on it.

## Prerequisite

Confirm that Node.js 22 or newer is available.

```sh
node --version
```

## Read the guidance

Before writing the plan, run:

```sh
npx big-plan guidance
```

It prints the plan-writing principles and unlocks `validate` and `render` for the working directory for 24 hours.
Both commands fail with `GUIDANCE_REQUIRED` until it has been run.

## Validate while authoring

Use `npx big-plan validate <plan.mdx>` as the correction loop while writing.
Rendering enforces the same linting rules, so validate until clean before handing anything to a human.

## Render the review document

From the working directory that contains the plan path, run:

```sh
npx big-plan render <plan.mdx>
```

Replace `<plan.mdx>` with the actual path to the plan.
For example:

```sh
npx big-plan render plans/implementation.mdx
```

The command creates `plans/implementation.html` next to the source plan.
Give the human reviewer that HTML path as a full absolute path or `file://` URL and wait for agreement before acting on the plan.

To choose a different location, pass it as the second argument:

```sh
npx big-plan render plans/implementation.mdx reviews/implementation.html
```

The command creates missing parent directories for that output path.
