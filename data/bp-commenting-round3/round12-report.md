# Round 12 report — honest queue states and whole-slide comments

Branch `fm/bp-commenting-round3`, built on round-eleven commit `0b39cf3c`.

Stage 1 only: committed locally, no push, no PR, and no validation pipeline.
Round 12 item 5 was deliberately left unchanged for its dedicated design pass.

## Preview

- Live, fresh review: http://127.0.0.1:61399/
- Static preview: `data/bp-commenting-round3/plan-review-v12.html`
- Live plan: `.agent-runs/captain-round12/final-relaunch-3RF11n/plan.mdx`
- Fresh guidance state: `.agent-runs/captain-round12/final-state-Br5PK5`
- Chrome evidence: `.agent-runs/round12-verify/shots-20260803-211506/`

The final live session responds with HTTP 200 and starts with zero comments and
zero drafts. The verification comments live only in the earlier disposable
`relaunch-Eodi1Q` run and are not present in the captain's session.

## 1. Waiting and Blocked

The old `Sent` chip is retired for unresolved requests:

- **Waiting** means a fresh coding-agent lease exists but the request has not
  been claimed. Expanded surfaces say Waiting; minimized floating cards show
  only the hourglass icon with an accessible label.
- **Blocked** means no coding agent is connected. It uses the recoverable
  hazard triangle in the card and toolbar, not an X. Setup instructions are
  available but collapsed.

`big-plan agent next --wait` now renews a short waiting lease while polling.
Claimed work receives a longer working lease, and `agent respond` shortens it
again until the agent follows the printed `next --wait` command. The runtime
publishes this observed connection state to the document.

The request itself remains a durable file in the plan's agent queue. Chrome
submitted request `cfc452e535e31d55` while the UI showed Blocked; a later real
`big-plan agent next` command returned that same request automatically, with no
retry click or resubmit. Store, server, command, lifecycle, and browser tests
cover the lease and reconnect path.

## 2. Whole-slide comments

The selector no longer manufactures a native range from the slide's first
through last blocks. That range was truncated to the quote limit and later
rehydrated against the first heading, which made a whole-slide comment look
like a heading comment.

A whole-slide selection is now a first-class `type: "slide"` target in browser
state, validation, agent exchange, and feedback briefs. The numbered kicker
(`1 / Background`) carries the pending and saved highlight, while the heading
does not. The real reconnect request arrived at the agent with:

```text
type: slide
blockId: section/background/heading-1
label: Background
section: Background
```

Reader-facing copy says `Background · Whole slide` without repeating the
heading.

## 3. Feedback-header border root cause

This recurrence was structural, not a conditional-render or specificity bug.
The rail had no header element. Its separator had two unstable would-be owners:

- a legacy `[data-review-rail-head]` rule whose element was no longer rendered;
- the live `[data-review-tabs]` child, which also owns tab spacing and each
  selected tab's two-pixel accent.

Earlier shell revisions moved or restored the line on those implementation
details, so a tab-shell rewrite could remove the visible boundary while the
dead header rule still suggested the header was covered.

The rail now renders a real `[data-review-rail-header]` wrapper. That stable
boundary alone owns the one-pixel bottom border; the dead selector was removed.
The browser regression test opens the rail and asserts the rendered header has
a solid, non-transparent one-pixel bottom border and sits at a zero-gap seam
with the active panel. It fails if the wrapper or its border is removed.

Chrome measured:

```text
border: 1px solid rgb(53, 49, 42)
header-to-panel seam: 0px
```

## 4. Setup instructions

Status strips no longer accept an `openSetup` escape hatch. Every
`Show setup instructions` details element is closed on render, including entry
through the toolbar connection alert. The runtime browser journey asserts the
Blocked setup control has no `open` attribute.

## Real-gesture verification

- **Whole slide:** clicked the real top-left selector, asserted only the kicker
  highlighted, opened the editor, typed a comment, saved it, and submitted it.
- **Blocked:** with no agent running, asserted the hazard icon, Blocked label,
  no spinner, collapsed setup instructions, and highlighted slide kicker.
- **Reconnect:** ran the real `agent next` command and verified it claimed the
  already-queued Blocked request automatically as a semantic slide target.
- **Waiting:** while an agent lease was valid, submitted another whole-slide
  comment and asserted the unclaimed request showed Waiting; its minimized card
  displayed the hourglass alone.
- **Header:** opened Feedback from a realistic pointer flow and measured the
  actual computed border and panel seam.
- **Themes:** inspected light and dark captures for Blocked, Waiting, the slide
  kicker highlight, collapsed setup, and the rail header separator.

The existing browser journey also exercises real hover, keyboard focus, and
pointer-active states for the slide selector and Feedback control in both
themes.

## Picky-reviewer pass

Three likely flags were checked and fixed on each changed surface:

1. **Status:** removed the lingering Sent label, replaced the X with a hazard,
   and prevented completed one-shot commands from looking connected forever.
2. **Whole slide:** removed heading-only rehydration, made the kicker the visual
   anchor, and removed duplicated `Background / Background` copy.
3. **Header/setup:** moved the border off the tab implementation, deleted the
   misleading dead selector, and removed every auto-open setup path.

## Verification

- `bun run build` — passed.
- `bun run test` — 63 files, 769 tests passed.
- `bun run lint` — passed.
- `bunx playwright test test/commenting.spec.ts test/commenting-runtime.spec.ts --project=chromium` — both critical journeys passed.
- `git diff --check` — clean.
- Final live server — HTTP 200, zero drafts/comments, no console messages.

## Relaunch commands

These from-scratch commands always build the current checkout, copy the plan to
a clean run directory, and create fresh guidance state:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
bun run build
mkdir -p .agent-runs/captain-round12
ROUND12_RUN_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round12/relaunch-XXXXXX")"
cp .agent-runs/captain-round11/plan.mdx "$ROUND12_RUN_DIR/plan.mdx"
ROUND12_STATE_DIR="$(mktemp -d "$PWD/.agent-runs/captain-round12/state-XXXXXX")"
BIG_PLAN_STATE_DIR="$ROUND12_STATE_DIR" node bin/big-plan.mjs guidance
BIG_PLAN_STATE_DIR="$ROUND12_STATE_DIR" node bin/big-plan.mjs review "$ROUND12_RUN_DIR/plan.mdx"
```

The final command prints the new exact URL and must remain running.
