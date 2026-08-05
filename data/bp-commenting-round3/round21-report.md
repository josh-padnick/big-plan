# Round 21 implementation report

Preview: http://127.0.0.1:55144/

Plan: `/tmp/fm-bp-commenting-round21-final.ugproM/plan.mdx`

Agent command:

```sh
node '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs' agent '/tmp/fm-bp-commenting-round21-final.ugproM/plan.mdx'
```

Draft PR: https://github.com/josh-padnick/big-plan/pull/54

The preview uses a fresh state directory and the branch is pushed through
`1da6a0c0`.

## Delivered

- Restored the live spinners, green immediate-submit switch, compact toolbar
  batch control, card padding, shortcut tooltips, and logo behavior lost during
  the CSS conversion.
- Adopted the approved Working/Queued handoff and in-thread agent-activity
  treatment while preserving the existing queue model.
- Restored the prominent red **Agent connection lost** control. The distinct
  runtime failure remains truthfully labeled **Review server offline**.
- Made the full-width toolbar the app's maximum stacking layer.
- Contained long unbroken content in collapsed pills, badges, cards, code,
  toasts, and thread chrome. Floating cards no longer create horizontal
  scrollbars, and their header is flush and full-width.
- Restored minimize/resolve/revert in the standing thread header while keeping
  the approved duplicate action set in the See-the-change row.
- Replaced agent-prompt revert with a local `/api/revert` operation. It applies
  the inverse of the comment's immutable revision pairs, creates no agent
  request or approval cycle, resolves the thread, and records a context event
  for the next agent pickup.
- Replaced surface-specific scroll patches with one keyed preservation
  mechanism used by comments, chat, connection history, and thread activity.
- Routed whole-slide comment composition through the same right-side anchored
  path as text selections. The whole-slide highlight remains, with first,
  last, and artificially tall-slide browser cases covered.
- Moved the selection Comment affordance to the selection's top-left: 8px
  above and left when space permits, toolbar-clamped and horizontally
  non-overlapping when the selection begins at the top of the viewport.
- Added replay captures for staged batch state, expanded thread reply, toolbar
  stacking, right-side whole-slide composition, and selection-affordance
  placement.

## Root causes closed

### Revert created a new approval cycle

The old UI literally posted “Revert all plan changes made in…” as a normal
reply request. The agent correctly treated it as new work, so its response
created another diff to approve. Revert now has a dedicated local endpoint and
never enters the request queue. A revision-pair inverse first uses exact token
matches and then immutable line context when a later revision rewrote the same
source location.

### Scroll positions reset during polling

Polling called renderers that use `replaceChildren`, remounting list content
inside chat, comments, connection history, and activity logs. The previous
activity-only patch protected one surface. The first shared implementation also
revealed duplicate activity keys: hidden tray and visible floating copies could
overwrite one another with zero. Keys now include request, surface, and comment
identity. One persistent registry restores all keyed owners after the render
boundary and the following layout passes; a mutation observer covers nested
remounts outside the top-level renderer.

### Card header clipping and horizontal overflow

Expanded cards inherited collapsed padding while their header used negative
edge offsets, clipping the header. Long code tokens also escaped descendants
whose grid/flex parents lacked containment. Expanded padding is now structural,
headers own the full card width, and every comment-chrome text owner has
`min-width: 0` plus explicit wrapping, clipping, or ellipsis semantics.

## Verification

- `bun run lint`
- `bun run build`
- 34 focused Vitest tests across review server, agent command, and revision
  reversal
- 20 stylesheet-contract and style-history tests
- 2 complete Playwright commenting journeys, both green
- Playwright lifecycle replay covers light/dark hover, focus, and active states,
  expanded reply retention, deterministic revert, no new request, full-width
  toolbar stacking, long-token containment, footnote navigation, first/last/tall
  whole-slide placement, top-of-viewport selection placement, and shared
  scroll preservation for comments, chat, connection history, and activity.
- Manual Chrome at 1440×900 confirmed:
  - whole-slide composer is 12px right of its kicker anchor;
  - toolbar spans 0–1440 and reports z-index `2147483647`;
  - selection affordance is 7.8px above and left of the selected range;
  - no document horizontal overflow in either theme.

Screenshot evidence:
`.agent-runs/round21/final-20260804-183154/`

## Picky-reviewer sweep

- Top bar: fixed the stale gray alert, incomplete stacking order, and controls
  competing above the border.
- Floating threads: fixed clipped header edges, missing standing actions, and
  long-token horizontal scrolling.
- Anchor chrome: fixed whole-slide above/below placement, detached left-gutter
  selection affordance, and top-of-viewport overlap.
- Sidebar/status: fixed duplicate/overlong state chrome, queued copy density,
  and remount-driven scroll jumps.

## Relaunch or recovery

Start this exact fresh preview:

```sh
node '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs' review '/tmp/fm-bp-commenting-round21-final.ugproM/plan.mdx'
```

To connect an agent to that already-running review, keep the review command
running, open a second terminal, and run:

```sh
node '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs' agent '/tmp/fm-bp-commenting-round21-final.ugproM/plan.mdx'
```

Paste the returned `codex` or `claude` command into the agent terminal. To start
an entirely fresh session later, copy the plan to a new directory, run the
review command against that copy, then run the matching agent command against
the same copied path.
