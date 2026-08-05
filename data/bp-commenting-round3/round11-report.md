# Round 11 report — stable slide selector

Branch `fm/bp-commenting-round3`, built on round ten commit `5c732666`.

Stage 1 only: committed locally, no push, no PR, and no validation pipeline.

## Preview

- Live, fresh review: http://127.0.0.1:58414/
- Static preview: `data/bp-commenting-round3/plan-review-v11.html`
- Live plan: `.agent-runs/captain-round11/plan.mdx`
- Fresh Big Plan state: `.agent-runs/captain-round11/state-final-4ZEeyE`
- Chrome evidence: `.agent-runs/round11-verify/shots-20260803-203243/`

The final live session started with zero comments and zero drafts. The verification comment used before the final restart was preserved recoverably under `.agent-runs/round11-verify/live-state-20260803-203243/`, not carried into the captain's session.

## Root cause

The selector was visually overlaid on the slide, but structurally it was a fixed-position child of a separate review-root layer. `positionSlideSelectors()` sampled each slide's viewport rectangle and wrote fixed `top`/`left` pixels at initial render, resize, and scroll.

Adding or loading a comment calls the floating-card layout, which changes desktop body padding from `0px` to `288px` and re-centres the document. That transition did not reposition the selector after the resulting layout pass:

- Before a comment: slide left `495.109375px`; selector left `465.109375px`.
- After a comment: slide left `351.109375px`; selector remained at `465.109375px`.

The static file exposed the stale coordinates after the reviewer added a comment. The live runtime could expose them during asynchronous boot when persisted comments were loaded. This timing difference made the two delivery paths look inconsistent even though both ran the same faulty coordinate model.

## Fix and durable prevention

Each selector is now a real child of its slide. The runtime opts the slide into `position: relative`; the selector is `position: absolute` at:

- `top`: 12px from the slide's top border
- `right`: 8px outside the slide's left border

There is no position map, fixed overlay, resize handler, scroll handler, or render-timing dependency left for this control. The browser lays out the selector and border from the same containing block.

The regression journey measures the selector-to-border geometry before and after saving a comment causes the document to re-centre. Both states must keep the same 8px horizontal gap and 12px top offset. The test would fail with the round-ten implementation.

Moving the control outside the review-root subtree also exposed two secondary issues during verification: it no longer inherited the shared hover/active custom properties or the root's focus outline. The selectable slide now inherits the same review-control tokens, and the selector owns an explicit focus-visible outline.

## Chrome verification

At 1440×900:

| Surface            | State           |   Slide left | Selector right | Gap | Top offset |
| ------------------ | --------------- | -----------: | -------------: | --: | ---------: |
| Static v11         | no comment      | 495.109375px |   487.109375px | 8px |       12px |
| Static v11         | comment present | 351.109375px |   343.109375px | 8px |       12px |
| Live v11           | fresh           | 495.109375px |   487.109375px | 8px |       12px |
| Live v11           | comment present | 351.109375px |   343.109375px | 8px |       12px |
| Final live restart | fresh           |            — |              — | 8px |       12px |

The select-slide gesture was performed from a real pointer start in static and live: click selector, assert a native slide-wide selection, assert the existing Comment pill appeared, open the editor, save, and assert the document re-centred while the selector stayed attached to the border.

Light and dark hover and focus captures were inspected. The existing runtime journey exercised and asserted the actual hover, keyboard-focus, and pointer-active colors in both themes. The final fresh live page has no console messages.

## Picky-reviewer pass

Three likely review flags were fixed before presenting:

1. **The icon could still drift after a layout transition.** Removed the coordinate snapshot entirely; slide and selector now share a containing block.
2. **Hover/active became transparent after the structural move.** The selectable slide now inherits the review-control state tokens.
3. **Keyboard focus lost its outline outside the review root.** The selector now owns a visible focus outline in both themes.

## Verification

- `bun run build` — passed.
- `bun run test` — 63 files, 764 tests passed.
- `bun run lint` — passed.
- `bunx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts` — both critical journeys passed.
- Static and live browser geometry matched with and without a comment.
- Final live server: HTTP 200, zero drafts/comments, no console messages.
- `git diff --check` — clean.

## Relaunch commands

These commands rebuild the current checkout and create a fresh Big Plan state directory every time:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
bun run build
mkdir -p .agent-runs/captain-round11
ROUND11_STATE_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round11/state-XXXXXX")"
BIG_PLAN_STATE_DIR="$ROUND11_STATE_DIR" node bin/big-plan.mjs guidance
BIG_PLAN_STATE_DIR="$ROUND11_STATE_DIR" node bin/big-plan.mjs review .agent-runs/captain-round11/plan.mdx
```

The review command prints the new exact URL. Keep that terminal running.

To guarantee a completely blank comment store as well as a fresh state directory, make a clean plan run first:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
ROUND11_RUN_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round11/relaunch-XXXXXX")"
cp .agent-runs/captain-round11/plan.mdx "$ROUND11_RUN_DIR/plan.mdx"
ROUND11_STATE_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round11/state-XXXXXX")"
BIG_PLAN_STATE_DIR="$ROUND11_STATE_DIR" node bin/big-plan.mjs guidance
BIG_PLAN_STATE_DIR="$ROUND11_STATE_DIR" node bin/big-plan.mjs review "$ROUND11_RUN_DIR/plan.mdx"
```
