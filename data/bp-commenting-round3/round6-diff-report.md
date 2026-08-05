# Round 6 + A1/B1 preview report

## Outcome

Round 6 is implemented as one working local review loop. The captain's items
1–6 and 9–13 are combined with the adopted A1 diff lens and B1 anchor-honesty
ladder:

- Selection emphasis is highlight-only. Floating composers and thread cards
  sit 12px from the content instead of at the viewport edge.
- The composer says **Add Comment**, remembers **Submit right away**, and
  staged cards offer a secondary **Submit Now** action. The Comments control
  uses a pressed state instead of an underline.
- Waiting chips and Chat show live activity. The unhelpful event-history list
  is gone.
- Changed threads list every attributed place, use **See the change** or
  **See changes (N)**, and open a server-computed in-place diff. The floating
  stepper moves among locations and **Show current text** or Escape exits.
- Anchors now follow the honesty ladder: exact quotes stay highlighted;
  verbatim moves silently re-anchor; missing quotes degrade to a block
  indicator plus “You commented on…” context; the original selection is
  marked only on the old side of its historical diff.
- **Revert** uses a confirmation dialog and sends the undo through the same
  agent channel; **Resolve** persists in the plan store and moves the item to
  the tray's Resolved group; **Minimize/Expand** changes only card density.
- Tray navigation stays open, uses slide-title labels, and scrolls to the
  requested anchor. The plan-wide Chat tab remains separate from per-comment
  replies.

Revision sources are saved idempotently under the plan store. A Changed
outcome must provide a non-empty `changeTargets` array, and every target is
validated against the actual server-side revision diff. Unattributed edits
remain visible under **Other changes in this round**.

## Exact captain try-out

Terminal 1:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/captain-real-review-round6/state" node bin/big-plan.mjs review .agent-runs/captain-real-review-round6/plan.mdx
```

Leave it running and open the printed loopback URL. Terminal 2:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
node bin/big-plan.mjs agent .agent-runs/captain-real-review-round6/plan.mdx
```

The second command prints ready-to-paste `codex` and `claude` commands. Run
either one in a fresh session, add a comment in the browser, and send it. The
agent receives the feedback package, revises the authoritative MDX, publishes
its structured outcome, and continues waiting. The browser re-renders the
source and replaces **With agent** with the real outcome chip. Expand the chip,
open its diff, or reply in its textarea; a reply returns to the same agent with
the complete thread history. Plan-wide messages use the Chat tab.

The prepared plan is intentionally pristine. To reset after trying it, stop
both processes and copy the sample into a new ignored run directory rather
than overwriting a reviewed source.

The static fallback is [plan-review-v7.html](./plan-review-v7.html); the CLI
command above is the actual commenting and agent experience.

## Real-agent proof

A fresh live session consumed browser request `72b219b91ea78932`, changed the
Background lede, and published a validated Changed outcome for
`section/background/paragraph-1`. The browser then sent the in-thread reply:

> Good. Make the sentence explicit that no processor outage may add latency to
> checkout.

The same agent exchange received request `fc54ad2286c2f261` with the preceding
reviewer and agent history, revised the source again, and published:

> I made the no-outage-latency guarantee explicit in the Background lede.

The second outcome opened its own historical diff. Restarting the review
server under the same plan identity restored both real turns and the Changed
chip instead of regressing to a stale **With agent** badge.

## Browser verification

All captures were written first to
`/tmp/fm-bp-commenting-round3/shots/`, checked as non-empty after each capture,
and copied individually to
[`evidence-20260802T142300`](./evidence-20260802T142300/).

Real gestures verified:

- Hovered content from a realistic pointer position, opened the composer,
  added and submitted feedback, and confirmed the package and waiting state.
- Drove two real agent responses, opened both historical change controls,
  stepped the diff, exited with Escape, and confirmed the expanded card was
  restored without a scroll jump.
- Replied inside the anchored thread and confirmed the next agent request
  contained the original comment, first agent answer, and new reviewer turn.
- Restarted the server and confirmed outcomes remained keyed to the plan
  identity.
- Exercised hover, focus-visible, and pointer-down active states for every
  changed control in light and dark themes. The integrated browser journey
  asserts the computed state change; the evidence directory contains the
  corresponding light/dark hover, focus, expanded-thread, single-change diff,
  and multi-change diff captures.
- Verified floating composers and cards preserve the no-overlap constraint,
  including an expanded reply control at the bottom of the viewport.
- Verified exact re-anchor, material-changed degradation for a
  question/outside thread, old-side selection marking, staged-stale notice,
  two revisions on one block, removed-block placement, resolve persistence,
  and revert self-healing.

## Picky-reviewer pass

Three final flags were found and fixed on each surface before presentation.

### Thread and diff surface

1. A changed successor could skip the original target and land on the next
   candidate. Successor selection now prefers an attributed target, then the
   original block, then the original scope.
2. Removed content could appear at the wrong historical position. Server-side
   alignment now places the removed band between its surviving neighbors.
3. Leaving a diff after a live hydration could keep the floating card hidden.
   Floating mode now recognizes a rehydrated thread layer and the exit path
   repositions the card.

### Lifecycle and tray

1. Resolved state disappeared on reload. `resolvedCommentIds` now lives in the
   plan store and has integrated reload coverage.
2. Unattributed revision edits were invisible. They now appear in **Other
   changes in this round**.
3. Completed outcomes could regress to **With agent** after restarting the
   server. Exchanges now persist by plan identity while transport sessions
   remain replaceable.

### Anchor and placement

1. Offset reuse could paint a convincing but false partial highlight. Exact
   quote detection now controls whether any text receives selection emphasis.
2. A viewport clamp could pull a later chip over an expanded card or composer.
   Fitting now happens before the monotonic no-overlap constraint.
3. Inline deletion/insertion runs could visually touch at substitution
   boundaries. The diff vocabulary now adds a small visual separation without
   changing copied text.

## Regression coverage

- `npm run lint` — passed.
- `npm test -- --run` — 61 files and 751 tests passed.
- `npm run build` — passed.
- `npx playwright test --reporter=dot` — 16 browser tests passed.
- Pure revision-diff tests cover rewording, insertion/removal order, structural
  id shifts, and word-run output.
- Store and exchange tests cover snapshot idempotence, persisted resolved ids,
  multi-target validation, real changed-block attribution, and outcome
  restoration across review transport sessions.
- The critical browser journey covers the A1 lens and stepper, B1 ladder,
  pinned second revision, changed material under another outcome, revert
  self-heal, reload persistence, all touched control states in both themes,
  and the floating-layer non-overlap constraint.

No pipeline, push, or PR was run. This is the Stage 1 preview gate.
