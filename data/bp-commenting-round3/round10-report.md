# Round 10 report — commenting UX

Branch `fm/bp-commenting-round3`, rebuilt from the accepted round-eight line (`4d1ee3f3`) plus the narrow pre-round-ten baseline at `a6c63f04`.

Stage 1 only: committed locally, no push, no PR, and no validation pipeline.

## Result

Round ten restores all thirteen binding round-eight corrections, removes the block-hover comment affordance, adds the slide-level select-all teaching affordance, and implements the adopted Option A status model without changing the captain-approved anchored card layouts.

- Live preview: http://127.0.0.1:54258/
- Static preview: `data/bp-commenting-round3/plan-review-v10.html`
- Chrome evidence: `.agent-runs/round10-verify/shots-20260803-185450/` (67 existence-checked captures, copied from `/tmp/fm-bp-commenting-round3/shots/`)

## Round-eight audit — all 13 items

1. **Designed failure states:** the single status resolver covers staged, sending, sent, working, stalled, errored, offline, outcome, and resolved. Slow work becomes amber after 90 seconds; errors and an unreachable review server are red; queued feedback is honestly neutral.
2. **Submit-now paints submitted state immediately:** the optimistic sending state replaces the staged card during the request and settles to Sent, never back to a stale Submit Now presentation.
3. **Staged-card toolbar:** minimize, edit, and remove remain Lucide toolbar actions; Submit Now is the sole body action and only exists before submission.
4. **Compact activity stream:** activity remains title-above-content, tightly spaced, and scroll-contained, now disclosed inside the working status strip instead of competing with it.
5. **One icon system:** the new queued and select-all glyphs are catalog-named Lucide sources; touched actions use the same set.
6. **Wide-response containment:** rail threads and chat continue to wrap or contain long content without horizontal overflow.
7. **Chat activity layout:** the same title-above, compact activity presentation is used in Chat.
8. **Resolved-card toolbar:** resolved comments retain the distinct captain-approved top bar.
9. **Added-run whitespace:** added list content keeps collapsed markup whitespace and compact list spacing.
10. **Table diff containment:** Was/Now table content stays flow-based and horizontally contained rather than exploding into tall cell stacks.
11. **Stepper typography:** Show current text keeps the inherited document type and centered pill alignment.
12. **Shortcut discoverability:** every applicable submit action retains the Linear-style hover/focus shortcut tooltip and `aria-keyshortcuts`; touched toolbar icons also expose concise tooltips.
13. **Grouped change navigator:** compact rows, slide groups and counts, restrained change metadata, selected-row accent, and de-duplicated table changes all remain intact.

## Round-ten changes

### Comment discoverability without block-hover chrome

The right-side block hover affordance and its cursor/keyboard machinery are removed completely. Each slide instead has a subtle ScanText control at its top-left, eight pixels outside the border. Clicking it creates a real range spanning the slide's first through last review block and surfaces the existing selection Comment pill. The durable comment target now carries an optional ending block ID so multi-block slide selections survive serialization, server exchange, reload, and anchor recovery.

Chrome assertions found seven slide selectors and zero block-hover affordances. The select-all gesture changed the browser selection, surfaced the Comment pill, and the resulting comment remained anchored after submission.

### Adopted Option A status strip

One derived status is rendered once, below the final turn:

- **Staged:** local draft; no workflow strip.
- **Sending:** immediate sending card and spinner.
- **Sent:** `Sent` badge plus `Sent · <relative time>` receipt; neutral queued strip, no spinner, setup behind a disclosure.
- **Working:** `Working` badge; one spinner in the expanded strip; intermediate activity is its detail.
- **Stalled:** amber strip after a previously active agent goes quiet for 90 seconds.
- **Errored / offline:** red actionable strip; the toolbar red X is the sole global signal and opens Chat with setup expanded.
- **Outcome / resolved:** the transient strip disappears and the chronological conversation owns the result.

Agent pickup is driven only by live/waiting agent progress, never submission receipts. Protocol text such as “Feedback package received” is filtered from visible activity. Inline command names render as code in status guidance. Chat uses the identical strip and does not synthesize an “Agent status” turn.

## Real-gesture and state verification

The final Chrome run exercised both light and dark themes for every lifecycle state: staged, sending, sent, working, stalled, errored, offline, outcome, and resolved. Each final state capture first landed under `/tmp/fm-bp-commenting-round3/shots/`, was checked with `test -f`, and was then copied into the fresh timestamped evidence directory.

Per-affordance checks:

- **Slide selector:** realistic pointer entry, hover, keyboard focus, pointer active, click, changed native selection, then visible Comment pill — both themes.
- **Selection Comment pill:** hover, focus, active, click, editor opened, submitted, and no scroll jump — both themes.
- **Status activity disclosure:** hover, focus, active, open/close, and visible compact progress stream — both themes.
- **Setup disclosure:** hover, focus, active, open/close; toolbar-X navigation opened Chat and pre-opened setup — both themes.
- **Touched toolbar icons:** hover, focus, active, tooltip visibility, and click-through — both themes.
- **Full journeys:** tray comment click scrolled to its target; staged comment edit saved; submission asserted its state transition and preserved scroll; inline editor content remained unclipped; reply, resolve/unresolve, change navigator, and stepper gestures passed.

The declared 1440×900 alignment check measured the document title and slide column at the same `351.109375px` left edge (delta `0px`).

## Picky-reviewer pass

Three presentation defects were found and fixed before this handoff:

1. **Chat setup copy fragmented vertically** in the narrow rail because an obsolete waiting-message flex rule still targeted its paragraph. The stale selector was removed and the copy now wraps normally.
2. **A reloaded pending conversation reported “Waiting for you”** until a later exchange mutation. Initial presentation now always derives the header from current exchange state.
3. **Repeated same-value header updates caused needless DOM replacement** and destabilized references during interaction verification. State updates now no-op when their text and tone are already correct.

## Automated verification

- `bun run test` — 63 files, 764 tests passed.
- `bun run lint` — passed.
- `bun run build` — passed.
- `bunx vitest run src/review/thread-status.test.ts src/review/comment.test.ts` — 21 tests passed after the final presentation fixes.
- `bunx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts` — both critical commenting journeys passed after the final presentation fixes.
- `git diff --check` — clean.
