---
title: Every component at once
description: A deliberately maximal plan that renders all twenty components in one document.
---

Not a plan you would write — a gallery. It exists so every component can be seen in a real
document rather than in isolation, and so a change to any of them shows up somewhere.

**Look for:** the data table you can sort and filter, the database schema, the three API contract
cards, and the decision matrix with its score calculation.

## Read it

<div class="sample-actions">

[**Open the rendered plan**](/plans/all-components/) · [Read the Markdown source](/plans/all-components/plan.md)

</div>

The rendered document opens in this tab. It is one self-contained HTML file — the same artifact
`big-plan render` writes next to your own plan.

## The source

This sample is rendered from `examples/all-components.mdx` in the Big Plan repository, by
`docs/scripts/gen-samples.mjs`, every time the docs site is built. It cannot drift from what the
current CLI produces.

```sh
npx -y big-plan@latest render all-components.mdx
```

## Next

[Components](/components/) — what each of the pieces in that document is for.
