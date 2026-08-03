# Round 7 stage-1 report

## Preview

The clean live review is running at <http://127.0.0.1:50491/>.

Start or restart it with:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/captain-real-review-round7/state" node bin/big-plan.mjs review .agent-runs/captain-real-review-round7-preview/plan.mdx
```

Start the real coding-agent side in a second terminal:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
node bin/big-plan.mjs agent .agent-runs/captain-real-review-round7-preview/plan.mdx
```

The second command prints ready-to-paste `codex` and `claude` commands. Keep that
session running: comments, replies, and Chat turns all return through the same
local exchange.

Offline visual artifact:
[plan-review-v8.html](./plan-review-v8.html).

## Round 7 result

- The in-place lens no longer introduces a blank lead-in above changed text.
- You and Agent turns have distinct treatments in anchored threads and Chat.
- `See the change` / `See changes (N)` flips to `Hide changes` on both surfaces.
- Revert, Resolve/Unresolve, and Minimize live in the thread's icon toolbar.
- Comment presence is explicit at the anchor. Below 1280 px the marker reads
  `1 comment`; its measured right edge stays 8 px clear of the content column.
- Send is now `Send all comments to agent`, keeps Feedback open, and shows all
  waiting sessions without moving the reading position.
- Resolved rows remain clickable and Unresolve restores the anchor and active
  lifecycle group.
- Agent activity is collapsible per waiting turn and globally in Chat. The final
  response replaces progress rather than accumulating an event ledger.
- The rail is named Feedback, Chat uses the `messages-square` icon, Comments uses
  the comment icon, and the Comments status is a compact numeric badge.

## C1 grouped change digest

The adopted multi-diff design is implemented without changing the agent
contract:

- Any answered Chat request whose source revision advanced receives a computed
  digest from the existing server-side revision-diff route.
- The headline reports `Changed N places across M slides`; the list is grouped
  by slide, expands by default through three places, and collapses above three.
- A place is one contiguous changed run in a slide. The same grouping now drives
  per-comment change lists.
- Clicking the headline, a row, or `See changes (N)` guides the reader through
  the existing in-place lens. The stepper includes the slide title, the active
  digest row tracks the lens, Feedback stays open, and no place count is capped.
- Runs below 0.2 similarity use honest stacked Was/Now bands. Added content moves
  into the green band as the real DOM and is restored before the lens is removed.
- Older revisions carry `since revised again`. Unchanged and normalized
  formatting-only turns do not grow empty change chrome.
- C2's all-at-once revision overlay remains deferred.

## Chrome verification

The integrated Chromium journey exercised the real local exchange through
`agent next` and `agent respond`, including source revision, live rerender,
anchored replies, lifecycle changes, plan-wide Chat, and multi-place diffs.

- Real gestures: block hover, text selection, whole-paragraph selection,
  Comment affordance dismissal, staged edit, Ctrl+Enter validation, Send without
  scroll jump, tray click-scroll, Reply, Resolve, Unresolve, Revert confirmation,
  activity collapse, digest disclosure, row jump, stepper navigation, and every
  lens exit.
- Both themes: hover, keyboard focus-visible, and pressed/active state checks
  cover the Feedback toggle, responsive anchor marker, composer and reply
  textareas, thread toolbar controls, digest disclosure, and change-tour button.
- Responsive: the explicit marker was measured at 1024 × 900 and pointer-driven
  with the rail closed; the sidebar paths were then repeated with the rail open.
- Diff edge cases: one place, more than three places, thirty-place behavior
  without truncation, mixed/wholesale runs, added-block restore order, removed
  slots, a superseded revision, unchanged revision, and normalized
  formatting-only revision.

Evidence was captured under `/tmp/fm-bp-commenting-round3/shots/`, existence
checked after each capture, and copied individually to
[`evidence-20260803T063906`](./evidence-20260803T063906/).

Verification commands:

```text
npm run build
npm run lint
npx vitest run src/review/revision-diff.test.ts src/review/server.test.ts
npx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts --project=chromium --reporter=line
```

Final focused results: 27/27 unit/server tests and the full 16.9–17.7 second
runtime journey pass. The complete two-spec Chromium run is repeated after the
final source generation before commit.

## Picky-review sweep

### Plan surface

The three likely flags were an invisible anchor, a marker drawing through text,
and narrow-screen ambiguity. The explicit count marker, external outline/highlight
treatment, and measured 8 px gutter address all three.

### Feedback and thread surface

The three likely flags were weak speaker identity, bottom-action competition
with Reply, and noisy progress accumulation. Distinct turn surfaces, the icon
toolbar, and collapsible activity that disappears behind the final response
address all three.

### Change surface

The three likely flags were a dozen-block “change” count, word soup for wholesale
rewrites, and losing real added content on exit. Contiguous-run grouping,
the similarity-gated Was/Now view, and the explicit restore-before-remove helper
address all three.

## Alignment regression record

The original blocking alignment diagnosis and prevention remain recorded in
[`root-cause.md`](./root-cause.md). This round preserves that shared shell
geometry; it does not introduce a second content-column width or title wrapper.
