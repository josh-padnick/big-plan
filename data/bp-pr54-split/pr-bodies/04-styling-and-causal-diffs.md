## Stack position

**4 of 5** in the reviewable replacement stack for #54. This PR targets `main` and depends on **#58**.

Merge the stack in numeric order. Once PRs 1–3 land, this draft's visible diff reduces to the UI-contract and causal-diff slice.

## Scope

This slice makes the review UI and revision story mechanically truthful:

- a CSS ownership contract and complete Tailwind utility conversion;
- generated embedded assets and style-history guards;
- a capture-harness bridge that bootstraps promoted sent threads through the server-owned review state;
- responsive review chrome, navigator, composers, and anchored cards;
- one immutable causal revision per agent turn;
- correct removal anchors, structural-move filtering, and honest historical mappings;
- renderer-owned scroll refresh and stable selector geometry.

Deliberately out of scope: atomic mutable-state transactions, interrupted-submission recovery, stale-tab rejection, browser workflow reducers, and the eighteen component revision lenses.

## Review plan

- [Rendered self-contained plan](https://raw.githubusercontent.com/josh-padnick/big-plan/refs/heads/fm/bp-pr54-split/.big-plan/pr54-split/04-styling-and-causal-diffs.html)
- [MDX plan source](https://github.com/josh-padnick/big-plan/blob/fm/bp-pr54-split/.big-plan/pr54-split/04-styling-and-causal-diffs.mdx)
- Local rendered path: `/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split/04-styling-and-causal-diffs.html`

The plan focuses review on light/dark and wide/narrow visual contracts plus multi-turn causal diff behavior.

## Green evidence

- `bun run build`
- `bun run lint`
- `bun run test` — 1,030 unit tests passed
- `bun run test:e2e` — 66 browser tests passed

## Split bridges

This slice removes the temporary stylesheet exemption introduced in PR 1 and refreshes generated CSS. Its small browser-test bridge adapts duplicate responsive controls and the milestone's single activity spinner; the final slice advances that expectation with the completed activity model.

It also contains the authorized, clearly labeled `fix(style-history): bootstrap promoted review threads [visual:empty]` bridge. PR 54's source harness moved a draft to browser-local `sent` state and reloaded, while the production runtime correctly accepts sent comments only from server bootstrap state. The bridge installs that validated bootstrap before reload, so the light and dark `expanded-thread-reply` captures are both produced. No production runtime behavior changes.
