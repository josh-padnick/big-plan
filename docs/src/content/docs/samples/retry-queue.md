---
title: A payments retry queue
description: "A plan structured as a deck: numbered acts, typed slides, and a decision the reviewer answers."
---

The same shape as the first sample, but organised as a **deck**: `Part` markers divide it into
acts, and each section is one slide carrying one thought.

**Look for:** the numbered act bands, the kicker above each slide title, and how the table of
contents groups its rows under the acts automatically.

## Read it

<div class="sample-actions">

[**Open the rendered plan**](/plans/retry-queue/) · [Read the Markdown source](/plans/retry-queue/plan.md)

</div>

The rendered document opens in this tab. It is one self-contained HTML file — the same artifact
`big-plan render` writes next to your own plan.

## The source

This sample is rendered from `examples/deck.mdx` in the Big Plan repository, by
`docs/scripts/gen-samples.mjs`, every time the docs site is built. It cannot drift from what the
current CLI produces.

```sh
npx -y big-plan@latest render deck.mdx
```

## Next

[Components](/components/) — what each of the pieces in that document is for.
