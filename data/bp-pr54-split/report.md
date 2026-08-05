# PR 54 split report

Status: implementation complete; final GitHub-green decision blocked by an incompatibility already present in PR 54's completed source tree.

## Chosen stack

All five drafts target `main` and must be reviewed and merged in numeric order. Each later branch is a descendant of the prior branch, so its visible diff contracts to its own slice as predecessors land.

| Order | Draft | Branch | Review surface | Rendered plan |
| --- | --- | --- | --- | --- |
| 1 | [#56](https://github.com/josh-padnick/big-plan/pull/56) | `fm/bp-pr54-1-review-foundation` | Stable plan/block/passage anchors, loopback review server, durable drafts, first integrated commenting journey | `.big-plan/pr54-split/01-review-foundation.html` |
| 2 | [#57](https://github.com/josh-padnick/big-plan/pull/57) | `fm/bp-pr54-2-agent-loop-diffs` | Immutable agent exchange, CLI launchers, anchored responses, revision snapshots/reverts/diffs | `.big-plan/pr54-split/02-agent-loop-and-diffs.html` |
| 3 | [#58](https://github.com/josh-padnick/big-plan/pull/58) | `fm/bp-pr54-3-commenting-workflow` | Complete comment lifecycle, navigator, activity/connection truth, responsive and keyboard journeys | `.big-plan/pr54-split/03-commenting-workflow.html` |
| 4 | [#59](https://github.com/josh-padnick/big-plan/pull/59) | `fm/bp-pr54-4-styling-and-causal-diffs` | CSS ownership, Tailwind conversion, generated assets, causal revision chain, honest diff mapping | `.big-plan/pr54-split/04-styling-and-causal-diffs.html` |
| 5 | [#60](https://github.com/josh-padnick/big-plan/pull/60) | `fm/bp-pr54-5-persistence-and-revision-lenses` | Atomic persistence, recovery/concurrency/rebase hardening, browser workflow actions, all 18 typed component lenses | `.big-plan/pr54-split/05-persistence-and-revision-lenses.html` |

Rationale: these boundaries follow the product's dependency chain. Storage and stable identity make review possible; the exchange protocol makes it agent-backed; the commenting workflow makes it complete; visual and causal contracts make it truthful; persistence and typed lenses harden the completed system. This yields five coherent review decisions without separating code from the tests that prove its behavior.

Each branch is represented by one signed-off review commit. That avoids forcing reviewers and CI to replay 121 exploratory UX commits while preserving the exact tree at every approved slice boundary.

## Rendered-plan verification

For each MDX source, the repository's CLI guidance was read first, then the plan was validated and rendered. All five self-contained HTML documents were opened in Chrome and checked for their expected title, contents navigation, section structure, and reader controls.

Absolute artifact directory:

`/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split`

The plans are also committed on branch `fm/bp-pr54-split`; every draft description links its rendered HTML and MDX source.

## Local green evidence

The following commands passed independently at each slice boundary:

- `bun run build`
- `bun run lint`
- `bun run test`
- `bun run test:e2e`

Observed totals:

| Slice | Unit tests | Style-history unit tests | Browser tests |
| --- | ---: | ---: | ---: |
| 1 | 944 | included by `bun run test` | 52 |
| 2 | 971 | included by `bun run test` | 52 |
| 3 | 1,019 | included by `bun run test` | 66 |
| 4 | 1,030 | included by `bun run test` | 66 |
| 5 | 1,061 | 20 | 91 |

The fifth slice's GitHub lint job also passed after the history was condensed; its earlier one-off browser geometry failure did not recur.

## Completeness proof

Source head:

`origin/fm/bp-commenting-round3` at `25de369a6f59370f5fe6d37675cc9d7ab5c2596e`

Final split branch:

`fm/bp-pr54-5-persistence-and-revision-lenses`

Both resolve to tree:

`576fd746ea4195d896e816ff1c008e6ebb94a464`

The direct two-ref diff is empty:

```sh
git diff --exit-code origin/fm/bp-commenting-round3 \
  fm/bp-pr54-5-persistence-and-revision-lenses
```

Therefore the union of the five stacked branches contains every completed PR 54 change and no final-tree extras.

## Split bridges

- Slice 1 pulls stable identity reconciliation and nested sub-slide identity forward, temporarily exempts legacy styles, and aligns browser persistence selectors so the foundation is independently usable.
- Slice 2 refreshes the generated embedded stylesheet after replaying the agent-loop slice.
- Slice 3 carries a narrow selector-geometry/test bridge: collapsed targets expand before anchoring, viewport state resets between journeys, and intermediate geometry assertions match the milestone.
- Slice 4 removes the temporary style exemption, regenerates CSS, preserves renderer-owned scroll refresh, and adapts responsive duplicate-control and milestone activity assertions.
- Slice 5 reconciles every bridge to PR 54's exact final implementations and expectations.

## GitHub CI blocker requiring a captain decision

The exact completed PR 54 tree contains a style-snapshot contract that declares 34 captures but deterministically produces only 32. The two missing captures are:

- `components__expanded-thread-reply__desktop__light.png`
- `components__expanded-thread-reply__desktop__dark.png`

The `promote-review-drafts` capture action moves a local draft into `sent` without creating the agent request needed for the non-runtime document to render that sent thread. The following action therefore finds no `[data-review-thread-summary-toggle]`, so both theme captures are skipped.

Evidence:

- GitHub runs `30994978263` (slice 4) and `30994978097` (slice 5) both fail with `Final style fixture produced 32 of 34 configured captures`.
- Running the exact capture command against both local slice trees also produced 32 PNGs and identified the same missing pair.
- Slice 5 is byte-for-byte/tree-for-tree the completed PR 54 source head, so fixing this check necessarily changes the final tree and violates the explicit empty-diff requirement.

Decision needed:

1. Preserve exact source completeness and accept the known `style-history` failure on drafts #59 and #60; or
2. Authorize a small capture-harness/config correction in the split stack, making the drafts green but making the final split tree differ from PR 54 until the same fix is first added to `fm/bp-commenting-round3`.

PR 54 remains open and is prominently marked superseded by #56, #57, #58, #59, and #60 in order.
