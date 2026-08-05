# Round 22 verification report

Branch: `fm/bp-commenting-round3`  
Head: `f087b3f7`  
Stage: preview only — no validation pipeline

## Preview

- Fresh-state review: <http://127.0.0.1:56737/>
- Plan: `/tmp/fm-bp-commenting-round22-final.PXGMLR/plan.mdx`
- State: `/tmp/fm-bp-commenting-round22-final.PXGMLR/state`
- Fresh-state assertion: 0 drafts, 0 review rows, 0 sent comments, and no browser console errors.
- Matching agent command:

  ```sh
  BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round22-final.PXGMLR/state node '/Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs' agent '/tmp/fm-bp-commenting-round22-final.PXGMLR/plan.mdx'
  ```

### Relaunch the current preview

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round22-final.PXGMLR/state \
  node "$PWD/bin/big-plan.mjs" review \
  /tmp/fm-bp-commenting-round22-final.PXGMLR/plan.mdx
```

In a second terminal:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
BIG_PLAN_STATE_DIR=/tmp/fm-bp-commenting-round22-final.PXGMLR/state \
  node "$PWD/bin/big-plan.mjs" agent \
  /tmp/fm-bp-commenting-round22-final.PXGMLR/plan.mdx
```

### Relaunch from scratch

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
preview_dir="$(mktemp -d /tmp/fm-bp-commenting-round22-final.XXXXXX)"
cp /private/tmp/bp-fresh/plan.mdx "$preview_dir/plan.mdx"
mkdir "$preview_dir/state"
BIG_PLAN_STATE_DIR="$preview_dir/state" node "$PWD/bin/big-plan.mjs" guidance
BIG_PLAN_STATE_DIR="$preview_dir/state" node "$PWD/bin/big-plan.mjs" review "$preview_dir/plan.mdx"
```

Then run the matching agent command against the exact printed plan path:

```sh
BIG_PLAN_STATE_DIR="<printed-preview-dir>/state" \
  node /Users/personal/.treehouse/big-plan-918a82/8/big-plan/bin/big-plan.mjs \
  agent "<printed-preview-dir>/plan.mdx"
```

## Item 1 — working spinner motion

Commit: `4bc56616`

### Why the prior fix looked green but remained visibly frozen

The circles already had a running `spin` animation. The visual gap was lost in
the cascade: Tailwind emitted the arbitrary full-border declaration after the
arbitrary transparent-right-border declaration, so all four edges resolved to
the same color. A perfectly symmetric ring can rotate while looking static.

The earlier assertion compounded the miss by checking `.first()` and only
proving one animation clock advanced. It did not cover the newer activity
treatment's thread-header and per-update circles, and it did not assert the
asymmetric border that makes rotation perceptible.

### Fix and prevention

Every working circle now uses the same utilities-first ring contract:
`animate-spin`, `border-[1.5px]`, `border-current`, and
`border-r-transparent`. No new traditional CSS was added.

The browser regression enumerates every visible variant rather than taking the
first match:

| Variant | Surface |
| --- | --- |
| `outcome-badge` | compact working outcome |
| `thread-header` | “Agent is working on this” |
| `activity-update` | current per-update activity |
| `group-heading` | Working group heading |

For each variant in light and dark themes it asserts `animation-name: spin`,
the expected duration, advancing `Animation.currentTime`, a transparent right
border, and a nontransparent top border.

### Chrome gesture

Created a whole-slide comment, submitted immediately, picked it up with
`agent next`, emitted two real `agent note` updates, expanded the thread in the
tray, then closed the tray to inspect the floating anchored card. In both
themes the thread-header and activity-update clocks advanced across a 200 ms
sample and the transparent gap was visible. The same tray pass verified the
Working group spinner.

## Item 2 — in-place plan revision refresh

Commit: `f087b3f7`

### Root cause

Revision delivery was explicitly a hard navigation. The review progress poll
compared `exchange.sourceRevision` with its bootstrap revision and called
`window.location.reload()` on any change. Because the server exposes a newly
compiled self-contained HTML document rather than a slide-fragment endpoint,
the browser discarded every live DOM node even though only authored plan
content had changed.

### Implemented scope

The server still owns whole-document MDX compilation. The browser now fetches
that newly rendered document and atomically imports only the authored
`main > article` content plus the mobile/desktop TOCs. The review shell stays
mounted.

After the swap it refreshes block identity, slide numbers, slide-selection
controls, TOC scroll-spy/popover hooks, target highlights, and anchored cards.
It preserves:

- the visible reading anchor and scroll position;
- sidebar open/closed state and selected tab;
- expanded thread IDs;
- plan-wide composer text;
- focused thread-reply text and selection;
- mobile TOC disclosure state.

This is deliberately not a new persistence system or a server fragment
protocol. A true browser navigation still starts a new document; this change
removes that navigation from the normal revision path.

### Chrome gesture

From the fresh runtime:

1. Opened Feedback with the keyboard and selected Chat.
2. Sent a real plan-wide request.
3. Typed a second, unsent composer draft.
4. Scrolled into the document and installed an in-memory navigation sentinel.
5. Ran `agent next`, edited the authoritative MDX, and ran `agent respond`.
6. Waited for the review poll to receive the new source revision.

Assertions after the real exchange:

| Assertion | Result |
| --- | --- |
| Revised `2,2 %` source appeared | Passed |
| Same in-memory navigation sentinel | Passed |
| Refresh state reached `complete` | Passed |
| Refresh-boundary reading-anchor delta | `0px` |
| Feedback rail remained open | Passed |
| Chat remained selected | Passed |
| Unsent composer text remained exact | Passed |
| Slide selectors reinstalled | 7 |
| TOC links rebound | 12 |
| Browser navigation entry count | 1 |

The complete Playwright journey additionally keeps an expanded review thread
open across the source swap.

## Verification

- `bun run build` — passed; shipped `dist` rebuilt and contains no
  `window.location.reload()` revision path.
- `bunx tsc --noEmit` — passed.
- `bun run lint` — passed, including the stylesheet contract and formatting.
- Relevant render/server Vitest suites — 38 tests passed.
- `bunx playwright test test/commenting-runtime.spec.ts --grep "should preserve and send a floating review across reload and viewport changes" --retries=1`
  — passed in 40.3 seconds.
- Integrated spinner matrix — passed for all four variants in both themes.
- Real Chrome — light and dark screenshots inspected; no console errors on
  the final fresh preview.

Screenshots were first saved and existence-checked under
`/tmp/fm-bp-commenting-round22/shots/`, then copied without deleting prior
captures to:

`/Users/personal/.treehouse/big-plan-918a82/8/big-plan/.agent-runs/round22/shots-20260804-213529/`

## Picky-review pass

Before presenting, three likely flags were checked on each changed surface.

Spinner surface:

1. A computed animation could still look static — fixed by asserting and
   visually confirming the transparent gap.
2. The new anchored header/update variants could remain uncovered — fixed by
   the explicit four-variant matrix.
3. The subtle ring could disappear in one theme — inspected at the exact
   floating-card size in both themes; contrast and motion remain legible.

Revision-refresh surface:

1. The article could visibly flash or rebuild the shell — the live shell and
   navigation sentinel remain mounted.
2. The page could drift after the content swap — the refresh-boundary anchor
   delta measured `0px`.
3. Review work could be lost — rail/tab, expanded thread, plan-wide draft, and
   focused reply state are covered by the live gesture and integrated journey.

No follow-up visual correction was needed after this pass.
