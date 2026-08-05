# Commenting UX round 4 — working preview

Preview: [plan-review-v4.html](plan-review-v4.html)

## Try the real review runtime

From this worktree, start a clean local review session with:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round4/captain-try-state" node bin/big-plan.mjs guidance >/dev/null
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round4/captain-try-state" node bin/big-plan.mjs review examples/sample.mdx
```

Open the loopback URL printed by the second command. Comments, reload
persistence, and **Send feedback to agent** are real. Sending writes the JSON
package and Markdown brief under `examples/.big-plan/feedback/` (or the
isolated state directory selected above). The agent-response outcome examples
do not have a real round-trip yet and are labelled **Chat · Simulated**. Item
6.4 agent-response threading remains with the separate design scout.

## Round-4 result

- Selecting any text, including a whole paragraph, presents only the compact
  icon-plus-**Comment** control. The highlight remains the target.
- At 1280px and wider, the composer and saved cards float in a dedicated
  right gutter, aligned to the highlighted source without repeating its text.
  Cards show author, relative time, lifecycle state, compact long-copy
  disclosure, edit, and confirmed removal.
- Below 1280px, the sanctioned inline fallback places the composer in document
  flow immediately after its target. Floating was rejected at this width
  because a readable 17rem card plus the plan column no longer fits without
  covering or over-compressing the plan.
- The right-edge hover control enters the same target/highlight/composer flow
  and disappears after the pointer leaves its trigger.
- The header entry now reads as a borderless Comments toggle instead of a
  pill-shaped button.
- The tray has a top edge, staged and sent lifecycles, clickable target rows,
  and slide-title-only labels. On narrow screens it is a reachable overlay
  drawer that preserves the reading position.

## Real-gesture verification

- **Hover Comment:** a pointer started on the Background paragraph, revealed
  the right-edge control, then moved to the toolbar; the control became hidden
  after the leave delay.
- **Block compose:** clicking that hover control highlighted the paragraph and
  focused a floating textarea. The composer and source measured the same top
  edge (`496.734px`), the card began to the right of the article, and no target
  quote appeared in the editor.
- **Whole-paragraph selection:** a real triple-click in the Playwright browser
  journey selected the entire paragraph, exposed the same Comment control,
  and produced the same floating composer and persistent source highlight.
- **Long comment:** saving a 218-character note produced one author/time card
  with a single inline **… more** disclosure. Expanding revealed the complete
  original body.
- **Edit/remove:** Edit focused the in-card textarea with a visible keyboard
  ring. Ctrl+Enter saved the revision through the validated save handler.
  Remove opened a modal alert dialog; Cancel preserved the draft, and the
  integrated browser journey also confirmed Delete removes it.
- **Tray lifecycle:** the toolbar opened the tray without changing `scrollY`.
  Staged rows were labelled only `BACKGROUND`; clicking a lower staged target
  changed scroll position and brought the exact block into the viewport.
- **Responsive fallback:** at 1120×800 the drawer occupied `top: 44px` through
  `bottom: 800px`, displayed a backdrop, and left `scrollY` unchanged. The
  inline composer measured `676.594px` wide with equal textarea
  `scrollHeight` and `clientHeight` (`91px`), so its text was not clipped.
- **Real send:** Send left `scrollY` at `0`, wrote a 917-byte JSON package and
  a 1313-byte Markdown brief, moved the comment to Sent, and reported the
  package id. Reload restoration is asserted before the first observable tray
  paint.
- **Themes and states:** light and dark Chrome captures cover the hover control,
  focused composer/edit textarea, staged card, tray, drawer, and delete alert.
  A real pointer-down capture and automated check compare the Comments
  toggle's hover, keyboard-focus, and active colors in both themes.
- **Alignment:** at 1440×1000, the title, subtitle, first content paragraph,
  and article left edge all measured `351.109375px` while the comment gutter
  was active (`0px` delta). Separate red and blue overlay guides coincide in
  the captured comparison.

Every Chrome capture was written first under
`/tmp/fm-bp-commenting-round3/shots/`, verified as a non-empty file, and then
copied into the fresh worktree directory
`.agent-runs/bp-commenting-round3/evidence-shots-round4-20260801-233300/`.

## Picky design-review pass

### Selection, composer, and floating cards

1. **Flag:** persistent block comments looked like debug focus rectangles.
   **Fixed:** highlights now use a quiet annotation wash with one inset source
   edge.
2. **Flag:** desktop conversation markers duplicated the already-visible
   floating card. **Fixed:** cards are the desktop entry point; markers remain
   only where the narrow layout needs them.
3. **Flag:** a clamped body added its own ellipsis before the **… more**
   control. **Fixed:** truncation now renders one deliberate inline disclosure.

### Header and tray

1. **Flag:** the Comments entry still read like a second pill button.
   **Fixed:** it is a borderless rectangular toggle with an active underline
   and plain count.
2. **Flag:** “Preview” did not say whether the Chat behavior was real.
   **Fixed:** the tab and outcome region explicitly say **Simulated** while
   real delivery status remains separate.
3. **Flag:** verbose row targets competed with the comment body.
   **Fixed:** the tray exposes only the slide title while retaining the exact
   target as the row's jump destination.

### Responsive and destructive flows

1. **Flag:** keeping the floating gutter below 1280px would cover the plan.
   **Fixed:** the composer changes to an inline flow slot and cards live in the
   reachable drawer/marker lifecycle.
2. **Flag:** removing a draft was too easy to do accidentally.
   **Fixed:** a modal, focus-managed alert dialog explains permanence and
   requires an explicit Delete.
3. **Flag:** the overlay could make it unclear whether reading position moved.
   **Fixed:** opening, closing, resizing, and submitting all have measured
   scroll-preservation assertions.

## Regression coverage

`test/commenting-runtime.spec.ts` is the integrated story for the actual
loopback runtime: real pointer selection and hover, floating geometry,
collapse/expand, edit/delete, right-edge entry, tray target scrolling,
first-paint reload persistence, focus-visible, narrow drawer and inline
fallback, Ctrl+Enter validation, both-theme outcome states, package writes,
sent lifecycle, and reload. `test/commenting.spec.ts` retains the
self-contained rendered-document interaction path.

No validation pipeline, push, or pull request action was run in Stage 1.
