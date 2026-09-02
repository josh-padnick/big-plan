---
title: A workflow builder surface
description: A UI-heavy plan whose wireframes you can click through as a short prototype.
---

A plan about an interface, so it shows the interface. Its `Wireframe` components draw
true-size screens you can navigate between.

**Look for:** the screen switcher above each wireframe, the maximize control, and how the plan
argues about a design without a single screenshot of something that does not exist yet.

## Read it

<div class="sample-actions">

[**Open the rendered plan**](/plans/workflow-builder/) · [Read the Markdown source](/plans/workflow-builder/plan.md)

</div>

The rendered document opens in this tab. It is one self-contained HTML file — the same artifact
`big-plan render` writes next to your own plan.

## The source

This sample is rendered from `examples/workflow-engine-builder.mdx` in the Big Plan repository, by
`docs/scripts/gen-samples.mjs`, every time the docs site is built. It cannot drift from what the
current CLI produces.

```sh
npx -y big-plan@latest render workflow-engine-builder.mdx
```

## Next

[Components](/components/) — what each of the pieces in that document is for.
