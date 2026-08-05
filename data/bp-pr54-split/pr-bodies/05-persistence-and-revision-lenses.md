## Stack position

**5 of 5** in the reviewable replacement stack for #54. This PR targets `main` and depends on **#59**.

Merge the stack in numeric order. Once PRs 1–4 land, this draft's visible diff reduces to the final hardening slice.

## Scope

This slice completes review durability and typed revision truth:

- atomic replacement and directory flushing for mutable state;
- interrupted feedback-commit recovery;
- optimistic reviewer revisions and stale-tab rejection;
- identity reconciliation after rebases;
- explicit browser workflow actions for composition, submission, navigation, cancellation, reconnect, and recovery;
- component-owned typed revision lenses for all eighteen registered components.

This is the final product slice; it deliberately adds no compatibility shim. It contains every change from #54's completed source tree plus the authorized capture-harness bridge inherited from #59.

## Review plan

- [Rendered self-contained plan](https://raw.githubusercontent.com/josh-padnick/big-plan/refs/heads/fm/bp-pr54-split/.big-plan/pr54-split/05-persistence-and-revision-lenses.html)
- [MDX plan source](https://github.com/josh-padnick/big-plan/blob/fm/bp-pr54-split/.big-plan/pr54-split/05-persistence-and-revision-lenses.mdx)
- Local rendered path: `/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split/05-persistence-and-revision-lenses.html`

The plan provides restart, concurrency, rebase, cancellation, and all-component revision review passes.

## Green evidence

- `bun run build`
- `bun run lint`
- `bun run test` — 1,061 unit tests and 20 style-history tests passed
- `bun run test:e2e` — 91 browser tests passed

## Completeness

The direct diff from `origin/fm/bp-commenting-round3` changes exactly the three style-snapshot files owned by the authorized bridge:

- `scripts/style-snapshots/capture.mjs`
- `scripts/style-snapshots/verify-history.mjs`
- `scripts/style-snapshots/verify-history.test.mjs`

That combined diff's stable patch-id exactly matches the clearly labeled capture bridge in #59. Reverse-applying the bridge to this branch yields #54's tree `576fd746ea4195d896e816ff1c008e6ebb94a464`. Therefore the stack union minus the listed bridge equals #54 exactly.

## Split bridges

This slice reconciles the early identity, selector, generated-asset, visual-evidence, and milestone-test bridges to #54's final implementations and expectations. The capture bridge deliberately remains because it is required for an independently green stack.
