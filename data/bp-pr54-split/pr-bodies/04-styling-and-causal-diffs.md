## Stack position

**4 of 5** in the reviewable replacement stack for #54. This PR targets `main` and depends on **#58**.

Merge the stack in numeric order. Once PRs 1–3 land, this draft's visible diff reduces to the UI-contract and causal-diff slice.

## Scope

This slice makes the review UI and revision story mechanically truthful:

- a CSS ownership contract and complete Tailwind utility conversion;
- generated embedded assets and style-history guards;
- a capture-harness bridge that bootstraps promoted sent threads through the server-owned review state and makes exact raster capture deterministic;
- a separate Playwright bridge that makes live-toolbar focus and geometry observation atomic;
- commit-scoped capture configuration so later capture additions cannot reinterpret earlier approved evidence;
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
- GitHub CI run: `31000606152`

## Split bridges

This slice removes the temporary stylesheet exemption introduced in PR 1 and refreshes generated CSS. Its small browser-test bridge adapts duplicate responsive controls and the milestone's single activity spinner; the final slice advances that expectation with the completed activity model.

It also contains the authorized, clearly labeled `fix(style-history): make review captures deterministic and complete [visual:empty]` bridge. That commit changes only the three style-history files. PR 54's source harness moved a draft to browser-local `sent` state and reloaded, while the production runtime correctly accepts sent comments only from server bootstrap state. The bridge installs that validated bootstrap before reload, so the light and dark `expanded-thread-reply` captures are both produced.

The bridge also fixes the pre-existing screenshot flake at its source. The alternating hashes differed at eight ±1 RGB pixels on two rounded-card corners; geometry, text, and motion were unchanged, isolating CPU-specific Skia antialias rounding. The harness disables Skia runtime CPU optimizations, pins sRGB/device scale, disables motion, and accepts a capture only after two consecutive settled frames are byte-identical. The exact zero-pixel contract remains unchanged—there is no tolerance or ignored region. Three complete local matrices and two independent hosted ledgers were byte-identical. No production runtime behavior changes.

PR 4 also adds five capture keys. The bridge makes each historical pair use its child commit's declared capture config, so those later keys do not retroactively change PRs 1–3's approved manifests; a focused regression test locks that boundary.

The Tailwind slice itself has an intentional visual delta, so its main commit is `[visual:approved]` with exact hosted evidence for 28 captures and 1,035,563 changed pixels.

A separate `fix(test): make live toolbar focus assertion atomic` bridge root-fixes a pre-existing Playwright flake. The old journey waited for focus and then queried `boundingBox()` in a second operation; the live locator could resolve across a runtime toolbar-node replacement between those observations. A parallel repeat reproduced the exact “The thread action has no target” failure. The fixed poll captures and returns the non-null box in the same successful iteration, and the focused journey passed three consecutive serial repeats.
