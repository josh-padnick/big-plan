# Round 24 verification report

Branch: `fm/bp-commenting-round3`  
Implementation head: `f7305aae`  
Stage: fresh-state preview; persistence work continues without a validation pipeline

## Preview

- Fresh-state review: <http://127.0.0.1:52571/>
- Plan: `/tmp/fm-bp-commenting-round24-preview.01xQ9y/plan.mdx`
- State: `/tmp/fm-bp-commenting-round24-preview.01xQ9y/state`
- Fresh-state assertion: 0 drafts, 0 review rows, 0 sent comments, and no browser console errors.
- Matching agent command:

  ```sh
  BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round24-preview.01xQ9y/state \
    node /Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs \
    agent /tmp/fm-bp-commenting-round24-preview.01xQ9y/plan.mdx
  ```

### Relaunch from scratch

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
preview_dir="$(mktemp -d /tmp/fm-bp-commenting-round24-preview.XXXXXX)"
cp /tmp/fm-bp-commenting-round23-preview.RroOZ4/plan.mdx "$preview_dir/plan.mdx"
mkdir "$preview_dir/state"
BIG_PLAN_STATE_DIR="$preview_dir/state" node "$PWD/bin/big-plan.mjs" guidance
BIG_PLAN_STATE_DIR="$preview_dir/state" node "$PWD/bin/big-plan.mjs" review "$preview_dir/plan.mdx"
```

In a second terminal, substitute the printed directory into:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR="<printed-preview-dir>/state" \
  node "$PWD/bin/big-plan.mjs" agent "<printed-preview-dir>/plan.mdx"
```

## Eight-item result

| Item | Result |
| --- | --- |
| 1 | Code blocks now use a quiet tinted surface with no heavy border, preserving syntax and copy affordances in both themes. |
| 2 | Tray-open composition is inline again; tray-closed desktop composition stays beside the selection. Missing anchors fall back to a centered in-flow surface and cannot appear at viewport origin. |
| 3 | The Agent tab now leads with one componentized current-activity card, covering idle, waiting, working, stalled, error, and offline states while keeping connection health and history compact below it. |
| 4 | The redundant `Reply` heading beneath `Next steps` is gone; the textarea remains explicitly labelled for assistive technology. |
| 5 | `Needs input` is a distinct, first group with an amber question treatment and `Needs your answer` secondary line, separate from Ready for Review. |
| 6 | The shell header and review toolbar own the maximum application z-index; anchored staged cards cannot cover either segment. |
| 7 | `Send all to agent` in the toolbar opens Feedback before submitting, so the resulting state remains visible. |
| 8 | The waiting agent loop now polls at 100 ms. A cancelled queued request is skipped and its successor is picked up within the regression budget. |

## Root causes and limits

**Composer at 0,0.** Round 23 removed the tray-aware inline insertion branch
and made every resolved desktop anchor floating. During a stale or incomplete
client build, that floating composer could be appended before positioning and
retain its absolute origin. Restoring the state-dependent insertion path and
giving missing anchors a structural centered fallback prevents the class.

**Cancellation latency.** A waiting agent reread the exchange only every 500
ms even though tombstones were already correct. The poll is now 100 ms. Once an
external coding agent has picked up a request, Big Plan cannot preempt that
separate process; the exact late response is rejected and the agent advances
when it runs its next loop command. That external-process boundary is the
honest remaining floor.

## Verification

- `bun run build` — passed.
- `bunx tsc --noEmit` — passed.
- Agent activity, thread status, and CLI agent suites — 25 tests passed.
- Dedicated Chromium composer journey — passed.
- Real Chrome fresh-state review — Feedback opened with `Alt+C`; Agent tab
  selected; current activity, recovery commands, and connection log inspected.
- Both themes inspected at the final URL.
- Screenshot evidence:
  `data/bp-commenting-round24/shots/20260804-2358/`.

## Picky-review pass

1. The new activity card could overpower the document — it stays inside the
   existing sidebar width and uses the existing type, color, and spacing tokens.
2. Recovery commands could be clipped in the narrower rail — both long blocks
   wrap and keep their copy controls visible in both themes.
3. The topbar could still lose hit-testing to a staged card — the regression
   checks the overlap coordinate and confirms the header/toolbar wins.

No additional visual correction was needed after this pass.
