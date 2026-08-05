# Round 13 report — transforming comment rows

Branch `fm/bp-commenting-round3`, built on the committed Round 12 state
`9470436b`.

Stage 1 only: committed locally, no push, no PR, and no validation pipeline.

## Preview

- Live, fresh review: http://127.0.0.1:55638/
- Static preview: `data/bp-commenting-round3/plan-review-v13.html`
- Live plan:
  `.agent-runs/captain-cardreview/final-relaunch-naniqm/plan.mdx`
- Fresh guidance state:
  `.agent-runs/captain-cardreview/final-state-RCMoZM`
- Chrome evidence:
  `.agent-runs/cardreview-verify/shots-20260803-213748/`

The final live session responds with HTTP 200 and starts with zero drafts and
zero sent comments. Chrome reported no console messages.

## Option A implementation

The sidebar row is now the thread card in both states:

- Collapsed: one persistent place header plus one-line comment echo.
- Expanded: the same place header gains the action icons, the echo disappears,
  and the chronological conversation renders directly below it.
- Clicking the header opens or closes the row. Opening jumps to the source;
  closing preserves the reader's scroll position. The minimize icon is an
  explicit synonym for closing.
- The comment text appears once in the expanded `You` turn and once in the
  collapsed echo, never both at the same time.
- The nested tray toolbar and tray-thread wrapper were removed. The floating
  expanded toolbar now identifies the slide instead of repeating the comment.

Group headers now own the taxonomy label and count: `Needs your answer`,
`Changed`, `Outside this plan`, and the mutually exclusive pending group
`Waiting` or `Blocked`. Sidebar rows contain no duplicate outcome chip. A row
can show only a genuinely additional substate: a working spinner or stalled
hazard.

The Round 12 semantics remain intact:

- **Waiting** is a valid agent connection with queued work and uses the
  hourglass.
- **Blocked** is no connected agent and uses the recoverable hazard. Its strip
  promises automatic delivery on reconnect and keeps setup instructions
  collapsed.
- Minimized floating pending cards use the state icon without label text.
- `Sent · Xm` remains only as the receipt in the `You` turn.

The stale-anchor sentence now requires both a real `Changed` outcome and an
unresolved selection quote. A quote mismatch on a Question or whole-slide
target can no longer claim the agent revised the text.

## Full-cycle verification

Chrome used a real whole-slide pointer flow to create and submit
`Make this whole slide easier to scan.` with no agent connected.

For both light and dark themes:

- **Collapsed row:** `Blocked 1` appeared once in the group header, the row had
  no state chip, and the comment appeared once as the echo.
- **Header expansion:** the same row gained `aria-expanded="true"`, the echo
  disappeared, and the exact comment appeared once in the `You` turn.
- **Header collapse:** the row returned to `aria-expanded="false"`, restored
  the echo, and preserved `scrollY`.
- **Minimize collapse:** reopening and clicking the minimize icon returned the
  same collapsed row and echo.
- **Status:** the expanded row showed the hazard, `Blocked - no agent
connected`, the automatic-reconnect promise, and closed setup instructions.

The integrated browser journey additionally exercised hover, keyboard-focus,
and held-pointer active states for the transforming header and all expanded
thread actions in both themes. It also covered Waiting/Blocked, working,
stalled, changed, question, outside-plan, reply, revert, resolve, unresolve,
reload, and minimized floating-card states.

## Picky-reviewer pass

Three likely flags were checked on each state before presenting:

1. **Collapsed:** removed the redundant chip, kept the echo to one line, and
   verified the group count and row place remain scannable in both themes.
2. **Expanded:** removed the second header, removed the duplicate echo, and
   made the full header surface visibly clickable while preserving independent
   icon buttons.
3. **Lifecycle:** kept the pending strip below the conversation, prevented the
   stale-anchor false claim, and retained the Round 12 hazard/hourglass and
   collapsed-setup rules.

## Verification

- `bun run build` — passed.
- `bun run lint` — passed.
- `bun run test` — 64 files, 771 tests passed.
- `bunx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts --reporter=line --timeout=150000`
  — both critical journeys passed.
- `git diff --check` — clean.
- Chrome — full transform cycle passed in both themes; final fresh server is
  HTTP 200 with zero drafts/comments and no console messages.

## Relaunch commands

These commands rebuild the current checkout and start the newest review with
fresh plan and guidance state:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
bun run build
mkdir -p .agent-runs/captain-cardreview
CARD_RUN_DIR="$(mktemp -d "$PWD/.agent-runs/captain-cardreview/relaunch-XXXXXX")"
cp .agent-runs/captain-round12/final-relaunch-3RF11n/plan.mdx "$CARD_RUN_DIR/plan.mdx"
CARD_STATE_DIR="$(mktemp -d "$PWD/.agent-runs/captain-cardreview/state-XXXXXX")"
BIG_PLAN_STATE_DIR="$CARD_STATE_DIR" node bin/big-plan.mjs guidance
BIG_PLAN_STATE_DIR="$CARD_STATE_DIR" node bin/big-plan.mjs review "$CARD_RUN_DIR/plan.mdx"
```

The final command prints the new exact URL and must remain running.
