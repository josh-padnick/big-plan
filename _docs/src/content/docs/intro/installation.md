---
title: Install Big Plan
description: Get the Big Plan CLI running, either by asking your agent or by running it yourself.
---

## Before you start

Node.js 22 or newer. No account, no service, no global install.

## Install it with your agent

Copy this prompt into your coding agent:

```text
Set up Big Plan for me: read https://bigplan.dev/setup.md and follow it.
```

The agent reads the server-controlled setup guide at
[https://bigplan.dev/setup.md](https://bigplan.dev/setup.md), uses the current CLI without
installing it, can install the thin skill shell, adopts the plan-review workflow, and adds the
rule to your project's agent instructions so every future session keeps it.
Authoring principles stay in `big-plan guidance`, so package upgrades refresh them without
hand-editing skill files.

## Install it manually

Run it with no install at all:

```sh
# Read how to write a plan humans love to review.
npx -y big-plan@latest guidance
# Turn plan.mdx into a self-contained plan.html review document.
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

Reading `guidance` first is required; it unlocks `validate`, `render`, and `review` for the
working directory.

## Verify

```sh
npx -y big-plan@latest --version
```

It prints a version. Then verify that Big Plan can render a plan:

```sh
curl -o plan.mdx https://bigplan.dev/demo/example-plan.md
npx -y big-plan@latest guidance
npx -y big-plan@latest render plan.mdx
```

Open `plan.html` in your browser. You get one self-contained HTML file with embedded assets, no
external requests, and a complete reading experience even with scripts disabled.

## Next

[Your first review](/intro/first-review/) — take one plan from download to approval.
