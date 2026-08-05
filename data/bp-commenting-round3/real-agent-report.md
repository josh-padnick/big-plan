# Real coding-agent round-trip

## Outcome

The review runtime now exchanges real, validated work with a coding-agent
session. There are no simulated agent turns:

1. **Send** writes the existing feedback package and a session-scoped agent
   request under the plan's ignored `.big-plan/` store.
2. `big-plan agent next <plan> --wait` gives the coding agent the oldest
   unanswered request, its thread history, a response template, a safe draft
   path, and the exact publish command.
3. The coding agent revises the authoritative MDX when appropriate and runs
   `big-plan agent respond`. Big Plan re-renders and lints the current source,
   rejects a false **Changed** outcome when its source digest did not change,
   validates every change target against the revised render, and writes trusted
   session metadata itself.
4. The browser sees the response and source digest through loopback polling,
   reloads the revised plan while preserving reading position and expanded
   thread state, and shows the real **Changed**, **Needs your answer**, or
   **Outside this plan** outcome.
5. An anchored reply or a Chat-tab message becomes the next request. Keeping
   one coding-agent session in the `agent next --wait` loop preserves the real
   conversation history across turns.

The exchange is local-first: Big Plan invokes no model provider. The review
server, browser, authoritative MDX, feedback package, requests, response drafts,
and validated responses all remain local. The separately started Codex or
Claude process is the agent.

## Exact captain try-out

In terminal 1:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
mkdir -p .agent-runs/captain-real-review/state
test -f .agent-runs/captain-real-review/plan.mdx || cp examples/sample.mdx .agent-runs/captain-real-review/plan.mdx
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/captain-real-review/state" node bin/big-plan.mjs guidance >/dev/null
BIG_PLAN_STATE_DIR="$PWD/.agent-runs/captain-real-review/state" node bin/big-plan.mjs review .agent-runs/captain-real-review/plan.mdx
```

Leave that terminal running and open the printed loopback URL. In terminal 2:

```sh
cd /Users/personal/.treehouse/big-plan-918a82/8/big-plan
node bin/big-plan.mjs agent .agent-runs/captain-real-review/plan.mdx
```

That prints exact `codex` and `claude` commands bound to this plan and live
review session. Paste either returned command into terminal 2. Then:

1. Comment on any plan block and press **Send feedback to agent**.
2. The anchored chip reads **With agent** while the real coding agent works.
3. A source revision appears live. A **Changed** chip expands to the real
   response and **See the change** jumps to the revised block.
4. Reply inside the expanded thread. The same agent session receives the
   reply with the original reviewer and agent turns as history.
5. Use the **Chat** tab for a plan-wide conversation; it uses the same
   filesystem exchange without inventing an anchored target.

Stop the review server with `Ctrl+C`; a waiting `agent next --wait` exits when
it sees that the server stopped.

## End-to-end proof

The first browser proof sent a comment asking to make durable retries
launch-critical. Fresh Codex thread
`019fc265-6d8a-74b2-a1db-ce3c559c7f89` consumed request
`21d6776e85124219`, changed the MDX, and published a **Changed** response. The
browser re-rendered the new “Required for the first release” wording without a
scroll jump and exposed a working **See the change** jump.

The browser then replied: “Good. Also say this requirement is the launch gate,
not merely a goal.” The same Codex thread was resumed, consumed request
`52e66f7e9ec39073` with the preceding reviewer and agent turns, changed the
source to “First-release launch gate: do not launch until…”, and published the
second real agent turn. The expanded thread and reading position survived both
live source reloads.

After the adversarial positioning fixes, a second clean proof used the exact
generated prompt file in a fresh sandboxed Codex thread
`019fc27f-89f5-7c32-aa73-0cd78bf2f903`. It consumed browser request
`247db6cf9236a670`, revised the source with checkout reliability as the customer
outcome, and published a real **Changed** turn. A browser reply then became
request `ca7df0fbc656d9c7`; the same Codex thread received the preceding history,
made the outcome sentence the Goals lede, and published the second turn. When
the review server stopped, the waiting agent command exited on the local
heartbeat instead of hanging.

That run also caught and fixed a sandbox-specific liveness flaw: process and
loopback probes can be unavailable inside a normal coding-agent sandbox. The
runtime now refreshes a session-scoped filesystem heartbeat, marks it stopped
on graceful close, and lets it expire after a crash. Agent commands therefore
reject dead descriptors without needing process-control or network authority.

Browser evidence, captured first under the required `/tmp` path and copied
after non-empty-file checks, is under the ignored
`.agent-runs/bp-commenting-round3/evidence-shots-real-agent-20260802-0518/`
directory. It includes the light waiting state, light first response, and dark
expanded two-turn conversation.

## Reviewer-sloppiness pass

Three issues a picky reviewer could still have flagged on the real-agent
surface were checked and fixed before presentation:

- The pending state could look like a fake completed response: it now says
  **With agent** and shows no agent-authored turn until a validated response
  exists.
- A live source revision could disorient the reader: the browser restores the
  exact scroll position, selected tab, tray state, and expanded thread ids
  across the re-render, and reloads only after `agent respond` has rendered,
  linted, and accepted the revision—not while the agent is midway through an
  invalid edit.
- The structured CLI output escaped the multi-line prompt: `big-plan agent`
  now writes an owner-only prompt file and prints exact one-line `codex` and
  `claude` commands that read it.

## Adversarial UX review 2

The separate Fable walkthrough confirmed the round-5 design and found one
floating-layer blocker plus four should-fixes. All five are included in this
preview:

- Floating cards now fit to the viewport before the 8px stack constraint is
  applied. An expanded thread or composer can push later chips beyond the
  viewport, but a later clamp can never pull them backward over a textarea,
  Reply button, or staged-card header.
- Scrolling dismisses the selection Comment pill and clears its selection,
  rather than leaving the pill frozen over unrelated text.
- Document comments use the document's first rendered block as their visual
  anchor, so they scroll away. Gutter markers and hover controls hide once
  their block clears the content viewport and use one 52px toolbar boundary.
- A completed generic progress step reads **Caught up**, never **Working**.
  Pending replies immediately re-derive the thread as **With agent**, remove
  the reply box, and clear the persistent needs-answer badge until the agent
  responds.
- Clicking a staged or sent tray row adopts that destination as the reader's
  new position. Closing the tray—including closing it through Send—no longer
  restores the position from before that deliberate navigation.

## Regression coverage

- `npm run lint` — passed.
- `npm test` — 60 files and 741 tests passed.
- `npx playwright test --reporter=dot` — 16 browser tests passed.
- The critical commenting journey now covers package-to-request creation,
  waiting-without-fake-response, an invalid in-progress source edit that must
  not reload, real filesystem response, accepted live source revision with
  reading-position restoration, **See the change**, an anchored reply and
  response, and a real Chat request and response.
- Browser geometry assertions cover a constrained 1440×520 viewport: every
  adjacent floating card remains at least 8px below the preceding card, no
  neighbor intersects the Reply button, and all thread cards begin at least
  8px below the floating composer. The same journey verifies scroll-dismissed
  selection chrome, marker clearance below the toolbar, and Send after a
  deliberate tray-row navigation.
- Exchange unit coverage rejects incomplete outcomes, false **Changed**
  responses, invalid change targets, foreign/orphaned disk values, and
  mismatched sessions.
- Final structured autoreview:
  `/Users/personal/Code/openclaw/agent-skills/skills/autoreview/scripts/autoreview --mode local --stream-engine-output`
  — clean, with no accepted/actionable findings.
