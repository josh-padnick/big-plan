# Round 14 report — selection escape, complete toolbar, and linked comments

Branch `fm/bp-commenting-round3`, built on the committed Round 13 state
`444cacc3`.

Stage 1 only: committed locally, no push, no PR, and no validation pipeline.

## Preview

- Live, fresh review: http://127.0.0.1:54262/
- Matching agent command:
  `node bin/big-plan.mjs agent '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/.agent-runs/captain-round14/final-preview-DZdeIu/plan.mdx'`
- Static preview: `data/bp-commenting-round3/plan-review-v14.html`
- Live plan:
  `.agent-runs/captain-round14/final-preview-DZdeIu/plan.mdx`
- Fresh guidance state:
  `.agent-runs/captain-round14/final-preview-state-mVBZbV`
- Chrome evidence:
  `.agent-runs/round14-verify/shots-20260803-PbBI1s/`

The final server responds with HTTP 200 and starts with zero drafts and zero
sent comments. Chrome reported no console errors.

## Round 14 implementation

### Escape clears either kind of selection

One `clearReviewSelection` path now cancels the pending comment target, hides
the floating comment affordance, clears the native browser range, removes the
whole-slide kicker highlight, and repaints persisted comment highlights.

The global Escape handler invokes it for both a whole-slide selector result and
a manual text selection. Escape in the open composer cancels both the composer
and its selection.

### The toolbar edge is one viewport-wide invariant

The repeated defect had two different border owners:

- The shell header owned the page-top bottom border, but opening the tray adds
  body right padding. That shrank the header and stopped its border at the
  document/tray boundary.
- The review rail supplied a separate top border for the right segment, one
  pixel below the shell line.
- The Round 12 regression test checked the rail's internal header bottom border,
  not the page-top line or its viewport geometry. It therefore passed while the
  right segment remained missing.

The fixed full-viewport review toolbar now owns the single bottom border. It is
anchored at `left: 0; right: 0`, while its children alone receive pointer
events. The rail no longer draws a competing top edge.

The browser regression test opens the tray in light and dark themes, measures
the toolbar's left and right edges against `0` and `window.innerWidth`, and
asserts a solid, non-transparent 1px bottom border. It retains the separate
check for the rail header's own lower divider.

### Staged count beside Feedback

The Feedback control shows the number of staged comments in a compact circular
badge. Its accessible label says how many comments are waiting submission.
Staged comments take precedence in this control; when none are staged, the
existing needs-answer count remains available.

### Document-to-tray navigation

Clicking a persisted document highlight while Feedback is open selects the
matching stable comment row, scrolls only the tray scroller to center it, and
adds a short-lived outline. The document viewport is restored across tray
rendering so browser scroll anchoring cannot move the reader.

This is the inverse of the existing tray-to-document journey. The browser test
performs both directions with real pointer input, waits for the first smooth
document jump to settle, and then verifies that the return interaction reveals
the correct row without changing `window.scrollY`.

## Two-theme gesture verification

Chrome exercised these interactions in explicit light and dark themes:

- Clicked a whole-slide selector, observed the whole-slide comment offer, then
  pressed Escape and verified no active kicker, no offer, and a collapsed
  native selection.
- Dragged across real document text, observed the text-selection comment offer,
  then pressed Escape and verified the native range and offer were cleared.
- Added comments on two distinct slides and verified the Feedback badge changed
  to `2` with the label `2 staged comments waiting submission`.
- Opened Feedback and measured the toolbar from `0` to `1440` at a 1440px
  viewport, with a solid 1px edge in each theme.
- Clicked a highlighted document anchor with the tray open and verified the row
  with the same stable comment id became the visible tray target.

The integrated Playwright journey additionally holds pointer-active states and
exercises hover and keyboard-focus states for the slide selector, selection
comment control, Feedback control, and affected tray controls in both themes.

## Picky-reviewer pass

Three likely flags were checked on each affected surface before presenting:

1. **Selection:** Escape could hide the button but leave either the browser
   range or kicker tint. The shared clear path and assertions cover all three
   pieces of state.
2. **Toolbar:** a visually similar rail divider could mask another incomplete
   shell line. One fixed owner plus viewport-edge assertions removes the split
   seam and checks the actual page-top edge.
3. **Navigation and badge:** a tray jump could move the document, a transient
   target could be ambiguous, or the count could describe the wrong queue. The
   document position is preserved, the exact stable row receives an outline,
   and the badge carries staged-specific text and accessibility semantics.

## Verification

- `bun run build` — passed.
- `bun run lint` — passed.
- `bun run test` — 64 files, 771 tests passed.
- `bunx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts --reporter=line --timeout=150000`
  — both critical journeys passed.
- Chrome — all four Round 14 behaviors passed in explicit light and dark
  themes; the final fresh server has zero comments and no console errors.

## Relaunch from scratch

These commands rebuild the current checkout and start the newest review with a
fresh plan directory and fresh guidance state:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
bun run build
mkdir -p .agent-runs/captain-round14
ROUND14_RUN_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round14/relaunch-XXXXXX")"
cp .agent-runs/captain-cardreview/final-relaunch-naniqm/plan.mdx "$ROUND14_RUN_DIR/plan.mdx"
ROUND14_STATE_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round14/state-XXXXXX")"
BIG_PLAN_STATE_DIR="$ROUND14_STATE_DIR" node bin/big-plan.mjs guidance
BIG_PLAN_STATE_DIR="$ROUND14_STATE_DIR" node bin/big-plan.mjs review "$ROUND14_RUN_DIR/plan.mdx"
```

The final command prints the new exact URL and must remain running. In a second
terminal, run the matching command it prints:

```sh
node bin/big-plan.mjs agent "$ROUND14_RUN_DIR/plan.mdx"
```
