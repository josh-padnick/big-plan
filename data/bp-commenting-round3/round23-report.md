# Round 23 verification report

Branch: `fm/bp-commenting-round3`  
Head: `5efab073`  
Stage: fresh-state preview only; no validation pipeline

## Preview

- Fresh-state review: <http://127.0.0.1:62088/>
- Plan: `/tmp/fm-bp-commenting-round23-preview.RroOZ4/plan.mdx`
- State: `/tmp/fm-bp-commenting-round23-preview.RroOZ4/state`
- Fresh-state assertion: 0 drafts, 0 review rows, and 0 sent comments.
- Matching agent command:

  ```sh
  BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round23-preview.RroOZ4/state \
    node /Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs \
    agent /tmp/fm-bp-commenting-round23-preview.RroOZ4/plan.mdx
  ```

### Relaunch this preview

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round23-preview.RroOZ4/state \
  node "$PWD/bin/big-plan.mjs" review \
  /tmp/fm-bp-commenting-round23-preview.RroOZ4/plan.mdx
```

Run the matching agent command above in a second terminal.

## Ten-item result

| Item | Result |
| --- | --- |
| 1 | The red disconnected alert owns only the two warning sentences. Recovery prose and copyable commands are normal content outside it. |
| 2 | The surviving responsive inline-composer branch was removed. At desktop widths every anchored composer uses the right-side thread layer, including with the tray open. Below 1280px the genuine constrained-space fallback is a centered dialog—never an in-flow card above a slide. |
| 3 | The current activity line no longer creates a third spinner. Working group and thread-header motion remain. |
| 4 | `Reply & resolve` and its combined action path are removed. |
| 5 | Thread actions now have a `Next steps` section after the final agent turn and before Reply. The standing header controls remain; change navigation no longer owns thread actions. |
| 6 | Added one shared vanilla toast manager with a global imperative API, stacked bottom viewport, auto-dismiss timers, hover/focus pause, dismissal, optional action, and a polite live region. Resolve/Undo and resolve failures use it. This adapts shadcn/Base UI behavior without React or a package dependency. |
| 7 | The explicit expanded-row header target now navigates to the document target before collapsing; collapsed rows retain their wide open-and-navigate target and native-interactive guard. |
| 8 | Diff migration steps 1–4 landed as separate checkpoints: claim-time causal ownership, same-scope boundary anchors, historical fallback for inexact newer mappings, and unchanged structural-move suppression. |
| 9 | Shortcut-bearing Add, Save, Send, and Reply actions were audited against the shared `attachShortcutTooltip` owner; Reply exposes the same Cmd/Ctrl+Enter tooltip and `aria-keyshortcuts` contract. |
| 10 | Plan-wide chat and comment threads now derive their immutable pair from the globally serialized claim rather than package-local position. Stored responses whose pair does not begin at that claim are rejected. |

## Diff correctness

The core ownership change is `claimedFromRevision`, recorded once at
`agent next`. Every response pair starts at that claim. The architecture pass
then made the claim write-once so a repeated pickup cannot move the baseline
after the agent has begun editing.

Removal anchors first search matched neighbors in the same section and only
use an unmatched insertion neighbor when it is also in that section. When the
browser displays a newer revision and cannot find an exact live block, the
saved Was/Now content renders as a historical thread surface instead of being
guessed into the current document. Finally, content-identical structural
matches are suppressed, so a renamed heading cannot drag an unchanged diagram
or its flattened text into the change set.

The focused tests include cross-kind/cross-package causal ownership, a
cancelled predecessor, reply-behind-queue ownership, immutable repeated claims,
same-section boundary removal, and the captain’s heading-plus-diagram scenario.
That diagram test asserts both zero diagram entries and absence of the
flattened `claimssucceeds...` text.

## Architecture pass

One additional change was worth the stability cost: moving write-once claim
semantics into the exchange module. This deepens the protocol seam and prevents
the CLI from silently rewriting a causal baseline.

Rejected:

- Splitting `review.js` by file size alone: its stateful browser orchestration
  would gain cross-module coupling without a more stable interface.
- A second notification abstraction: the new toast manager is already the
  single owner.
- Diff migration steps 5–6: explicitly held by the captain.

## Verification

- `bun run build` — passed.
- `bunx tsc --noEmit` — passed.
- Focused exchange and revision-diff suites — 27 tests passed.
- Full Chromium commenting journey was replayed repeatedly while updating the
  changed interaction contracts. It reached the later lifecycle sections; two
  independent pre-existing scroll/selection timing assertions remained flaky
  across reruns and are not presented as green.
- Real Chrome — desktop right-side composer checked with tray closed and open;
  disconnected panel and fresh-state assertions checked.
- Light and dark disconnected/recovery surfaces inspected from screenshots.
- Toast resolve gesture verified the shared viewport, title, Undo action,
  dismissal affordance, and polite live region.
- Screenshot evidence:
  `.agent-runs/round23/shots-20260804T224457/`

## Picky-review pass

Three likely flags were checked on each changed surface:

1. Recovery commands could still inherit the danger box — DOM containment and
   both screenshots confirm they do not.
2. The composer could escape under the open tray — measured right edge stays
   left of the tray, and no inline attribute remains.
3. Toast chrome could obscure or overflow review content — it is constrained,
   bottom-anchored, stacked, pointer-isolated, and wraps unbounded text.

No further visual correction was needed after this pass.
