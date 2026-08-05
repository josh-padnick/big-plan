# Round 5 preview report

## Try the working review

From this worktree:

```sh
mkdir -p .agent-runs/bp-commenting-round5/captain-try-state
cp examples/sample.mdx .agent-runs/bp-commenting-round5/captain-try-plan.mdx
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round5/captain-try-state" node bin/big-plan.mjs guidance >/dev/null
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/bp-commenting-round5/captain-try-state" node bin/big-plan.mjs review .agent-runs/bp-commenting-round5/captain-try-plan.mdx
```

The static fallback is
[`plan-review-v5.html`](./plan-review-v5.html). The CLI review command is the
actual working version: its Send action writes a feedback package below the
reviewed plan's `.big-plan/feedback/` directory.

## Adopted thread model

- A sent comment becomes one compact anchored chip: `Changed`,
  `Needs your answer`, or `Outside this plan`, followed by a one-line echo of
  the reviewer's comment.
- Clicking the chip expands the complete thread at the same anchor. The thread
  includes the reviewer's original comment, the simulated agent outcome, and a
  reply box that acts as the per-comment chat.
- At widths below 1280px, an expanded thread moves directly below its source
  block. This is the sanctioned inline fallback; a fixed right-hand card would
  cover the reading column at those widths.
- The Comments tab is the index and lifecycle view. It groups threads by
  outcome, uses concrete source labels, and scrolls to and expands the selected
  anchored thread.
- The Chat tab is plan-wide chat. It is separate from comment threads and
  explicitly labels its generated turns as simulated.
- `Needs your answer` is the only persistent toolbar signal. Drafts, changed
  comments, outside-scope comments, and simulated agent activity do not create
  persistent badge noise.

The feedback package transport is real. Agent outcomes, per-thread agent
replies, and plan-wide agent replies remain simulated because a live agent
round-trip is not connected yet; each simulated surface says so in the UI.

## Sloppiness repaired

- Comment presence is visible at the source through an outcome-toned marker,
  a source highlight, and its anchored chip.
- Sent comments no longer accumulate as tall cards. In the three-comment
  browser scenario, every collapsed card measured 26.06px high; all three
  together stay below 144px. Only the selected thread expands.
- Source emphasis uses a 2px outline with a 3px positive offset. It has no
  inset border or box shadow, so the indicator cannot cross text glyphs.
- Expanding or collapsing replaces the card DOM, then restores focus to the
  replacement summary button. The browser regression asserts this behavior.

## Real gesture verification

All gestures started from a realistic pointer or keyboard position and asserted
the resulting state.

- Created three comments through actual hover/Comment/textarea/Save gestures,
  including a paragraph, a whole heading, and a second heading.
- Sent the three-comment package with the real tray Send control. Package
  `a98ddfab178fbf63` was written, the sent count became three, and scroll
  position remained at 810 before and after submission.
- Verified the initial sent state contained three collapsed outcome chips and
  zero expanded threads.
- Clicked the `Needs your answer` chip and verified the anchored thread
  expanded, then used keyboard navigation to verify the replacement summary
  retained focus and matched `:focus-visible`.
- Submitted `Make launch scope explicit in the goals list.` in the per-comment
  reply box and verified the thread grew to two user turns and two simulated
  agent turns without creating another anchored card.
- Sent `What is the biggest risk across this plan?` in the Chat tab and verified
  the separate simulated response appeared while the anchored-thread count
  remained three.
- Clicked the grouped sidebar row and verified it scrolled to and expanded the
  matching source thread.
- Reloaded under the same plan identity and verified sent feedback, local
  thread replies, and plan-wide chat were restored.
- Resized to 1024x800 and verified the expanded card had
  `data-review-thread-inline`, was inserted immediately after the annotated
  heading, and preserved the surrounding reading position.
- Exercised hover, focus, and pointer-down active states for the outcome chip in
  explicit light and dark themes. Automated browser checks compare the computed
  state colors; real Chrome captures cover the final light focused state and
  dark responsive state.

Evidence was captured first to
`/tmp/fm-bp-commenting-round3/shots/`, checked for a non-empty file after every
capture, then copied without deleting older shots to:

```text
.agent-runs/bp-commenting-round3/evidence-shots-round5-20260802-043600/
```

The superseding final captures are:

- `round5-question-expanded-focused-light-fixed.png`
- `round5-inline-expanded-dark-fixed.png`
- `round5-inline-thread-hover-dark.png`
- `round5-plan-chat-light.png`
- `round5-plan-chat-dark.png`
- `round5-sidebar-lifecycle-light.png`

## Picky-reviewer pass

Before presenting, three likely flags were identified and repaired on each
surface.

### Anchored threads

1. **Too much right-side accumulation:** sent cards now collapse to one 26px
   line and only one selected thread expands.
2. **The echo becomes unreadable in a narrow gutter:** the echo uses a bounded
   one-line ellipsis while the full comment remains in the accessible label and
   expanded thread.
3. **Focus disappears when expansion re-renders the card:** focus is restored
   to the replacement summary and covered by a browser assertion.

### Comments and Chat tray

1. **Every state competes for attention:** only `Needs your answer` persists in
   the toolbar; the tray carries the full grouped lifecycle.
2. **Whole-plan and per-comment conversation scopes blur together:** the reply
   box stays inside its anchored thread while plan-wide conversation lives only
   in Chat.
3. **A simulated answer can look real:** the tab, note, agent labels, and turns
   all say `Simulated`; the note separately confirms feedback delivery is real.

### Responsive anchors

1. **A highlight line crosses glyphs:** the inset treatment was removed in
   favor of an outward outline with positive offset.
2. **A floating expanded card covers content on narrower screens:** it becomes
   an inline card immediately below the source below 1280px.
3. **Sidebar navigation changes reading position unpredictably:** row clicks
   use the same anchored open-and-scroll path and are covered at wide and narrow
   viewports.

## Regression coverage

- `npm run build` — passed.
- `npm test` — 58 files, 728 tests passed.
- `npm run lint` — ESLint and Prettier passed.
- `npx playwright test --reporter=dot` — 16 browser tests passed.
- The integrated commenting journey covers outcome colors, compact chip
  density, hover/focus/active states in both themes, focus restoration,
  expansion and replies, empty Ctrl+Enter validation, separate plan chat,
  grouped sidebar scroll targeting, plan-identity reload persistence, safe
  source outlines, and the narrow inline fallback.

No pipeline, push, or PR was run. This preview is intentionally stopped for the
separate adversarial UX review.
