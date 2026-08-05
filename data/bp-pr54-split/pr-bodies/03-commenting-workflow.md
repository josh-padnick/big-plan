## Stack position

**3 of 5** in the reviewable replacement stack for #54. This PR targets `main` and depends on **#57**.

Merge the stack in numeric order. Once PRs 1–2 land, this draft's visible diff reduces to the commenting-workflow slice.

## Scope

This slice turns the foundation into the full commenting experience:

- floating selection composers and anchored comment cards;
- batch send, per-thread send, revise, undo, resolve, and reopen;
- feedback navigation, grouping, activity, and connection health;
- agent-authored status and response truth;
- diff representations for prose, code, tables, and structural moves;
- responsive and keyboard-accessible review journeys.

Deliberately out of scope: formal CSS ownership/Tailwind conversion, the causal revision-chain hardening, atomic repository recovery, and component-owned revision lenses.

## Review plan

- [Rendered self-contained plan](https://raw.githubusercontent.com/josh-padnick/big-plan/refs/heads/fm/bp-pr54-split/.big-plan/pr54-split/03-commenting-workflow.html)
- [MDX plan source](https://github.com/josh-padnick/big-plan/blob/fm/bp-pr54-split/.big-plan/pr54-split/03-commenting-workflow.mdx)
- Local rendered path: `/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split/03-commenting-workflow.html`

The plan gives a complete manual review tour across desktop, narrow viewport, reload, and agent-response states.

## Green evidence

- `bun run build`
- `bun run lint`
- `bun run test` — 1,019 unit tests passed
- `bun run test:e2e` — 66 browser tests passed

## Split bridges

A narrow selector-geometry bridge keeps the slide comment affordance inside its gutter, expands collapsed targets before anchoring, resets viewport state between browser journeys, and makes the intermediate geometry assertions truthful. Later #54 commits own the final form.
