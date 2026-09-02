---
title: Rate limiting for a public API
description: "A short, ordinary plan: a decision, a code diff, a schema, and a verification contract."
---

This is the plan to read first. It is the size a real plan usually is — ten sections, no
ceremony — and it uses the components you will meet most often.

**Look for:** the quick summary card that opens it, the comparison table under _Options
considered_, the code diff with its line-anchored annotation, and the warning callout under
_Risks and mitigations_.

## Read it

<div class="sample-actions">

[**Open the rendered plan**](/plans/rate-limiting/) · [Read the Markdown source](/plans/rate-limiting/plan.md)

</div>

The rendered document opens in this tab. It is one self-contained HTML file — the same artifact
`big-plan render` writes next to your own plan.

## The source

This sample is rendered from `docs/src/demo/example-plan.md` in the Big Plan repository, by
`docs/scripts/gen-samples.mjs`, every time the docs site is built. It cannot drift from what the
current CLI produces.

```sh
npx -y big-plan@latest render example-plan.md
```

## Next

[Components](/components/) — what each of the pieces in that document is for.
