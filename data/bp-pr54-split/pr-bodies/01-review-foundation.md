## Stack position

**1 of 5** in the reviewable replacement stack for #54. This PR targets `main` and has no predecessor.

Merge the stack in numeric order. The later draft PRs also target `main`; after each predecessor lands, GitHub will reduce their visible diff to the remaining slice.

## Scope

This slice establishes the local review foundation:

- stable plan, section, slide, block, passage, and code-range anchors;
- a loopback review server with session-scoped state;
- draft comments and selections that survive reloads;
- the first end-to-end commenting journey over a rendered plan.

Deliberately out of scope: the live coding-agent exchange, mature thread lifecycle, the Tailwind styling contract, transactional recovery, and component-owned revision lenses.

## Review plan

- [Rendered self-contained plan](https://raw.githubusercontent.com/josh-padnick/big-plan/refs/heads/fm/bp-pr54-split/.big-plan/pr54-split/01-review-foundation.html)
- [MDX plan source](https://github.com/josh-padnick/big-plan/blob/fm/bp-pr54-split/.big-plan/pr54-split/01-review-foundation.mdx)
- Local rendered path: `/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split/01-review-foundation.html`

The plan contains exact commands, the behaviors to exercise, and the boundaries of this slice.

## Green evidence

- `bun run build`
- `bun run lint`
- `bun run test` — 944 unit tests passed
- `bun run test:e2e` — 52 browser tests passed

## Split bridges

To keep this early branch independently usable, it pulls stable identity reconciliation and nested sub-slide block identity forward from later #54 commits. It also aligns the browser-test persistence key and selector with the new foundation.

The separate `test(style-history): pin deterministic raster frames [visual:empty]` commit is temporary split scaffolding: it makes the earlier visual manifests reproducible while the stack is replayed. #59 retires it and replaces it with the single final capture bridge owned by the styling slice. The final stack branch reconciles every other ordering bridge back to #54's completed tree.
