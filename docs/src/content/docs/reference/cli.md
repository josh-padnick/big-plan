---
title: CLI reference
description: Reference the complete Big Plan command surface, defaults, results, and errors.
---

Big Plan exposes seven product commands through the `big-plan` executable: `guidance` for the plan-writing principles, `skill` for the agent skill shell, `validate` for a no-write authoring check, `render` for the human-facing HTML document, `compile` for the machine-facing plan model, `review` for local commenting, and `agent` for the local coding-agent exchange.
The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result serialization.
`axi-sdk-js` also reserves a built-in `update` command for optional package self-update of global installs.

## Commands

```text
big-plan guidance [component]
big-plan skill [write <path>]
big-plan validate <input.mdx>
big-plan render <input.mdx> [output.html]
big-plan compile <input.mdx> [output.json]
big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
big-plan service status|start|stop|restart
big-plan agent <input.mdx>
big-plan agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]
big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
big-plan update [--check]
```

`guidance` optionally takes one component name.
`skill` with no arguments prints the skill shell; `skill write <path>` writes it only when that action is explicit.
For the plan-file commands `<input.mdx>` is required.
`validate` accepts no output argument.
The output argument is optional for `render` and `compile`.
`service` takes one action and no plan file; with no action it reports status.
`update` is the optional `axi-sdk-js` built-in rather than a Big Plan product command.

The equivalent package runner forms are:

```sh
npx big-plan guidance
npx big-plan skill
npx big-plan skill write <path/to/SKILL.md>
npx big-plan validate <input.mdx>
npx big-plan render <input.mdx> [output.html]
npx big-plan compile <input.mdx> [output.json]
npx big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
npx big-plan service status
npx big-plan agent <input.mdx>
npx big-plan agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]
npx big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
npx big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
npx big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
npx big-plan update --check
```

## Guidance and the acknowledgment gate

`guidance` prints the authoring principles for writing a plan a human loves to review.
It deliberately prescribes principles rather than a template, so each plan keeps the structure its content needs.
Running it also records a guidance acknowledgment for the current working directory.

With a component name, `big-plan guidance <Component>` prints that component's judgment-level usage guidance instead: when to reach for it and what belongs in it.
`big-plan guidance Slide` returns every registered slide type and its matching, authoring, component-pairing, and cardinality guidance in one call for the whole plan.
The component form records no acknowledgment, and an unknown name fails with the list of components that have guidance.

`validate`, `render`, and `review` require a current acknowledgment and fail with a structured `GUIDANCE_REQUIRED` error until `guidance` has been run.
An acknowledgment is current when it was recorded for the same working directory within the last 24 hours against the guidance content the installed CLI ships.
Updating Big Plan to a release with changed guidance therefore re-locks all three commands until `guidance` is read again.
`compile`, `skill`, and `agent` are not gated, so machine tooling, skill install, and an already-live agent loop can run without the authoring workflow.

Acknowledgment state lives outside the project: in `.big-plan/` under the user's home directory, falling back to a `big-plan/` directory under the system temporary directory when the home directory rejects writes, as workspace-scoped sandboxes commonly do.
Setting the `BIG_PLAN_STATE_DIR` environment variable pins state to exactly one directory, which test suites and sandboxed environments use to keep state isolated.

When no state location accepts writes at all, the gate degrades instead of blocking: `guidance` still prints the full guidance and notes that the acknowledgment could not be saved, and `validate`, `render`, and `review` proceed while their results carry a warning that the acknowledgment could not be verified.
Filesystem restrictions therefore never lock an agent out of the plan workflow.

## Skill shell

`skill` prints the thin agent skill document embedded in the package (authored at `assets/skill/SKILL.md` and generated into the CLI).
The shell tells agents when to use Big Plan, how to invoke the CLI, and that they must run `big-plan guidance` for live authoring rules.
It does not duplicate plan-writing principles; those stay in `guidance` so package upgrades refresh authoring policy without editing installed skill files.

With no arguments, `skill` returns the Markdown skill text (including harness-oriented frontmatter) and writes nothing.
`skill write <path>` creates parent directories as needed and writes that text to the resolved path.
Write is the only mutation path; unknown options and unknown actions fail with `VALIDATION_ERROR` and leave the filesystem unchanged.
Overwriting an existing file at that path is allowed only because `write` was explicit.

After a package upgrade, new guidance is available immediately via `big-plan guidance`.
Re-run `skill write` only when the thin shell itself changed.
Prefer `npx big-plan@latest` for always-current one-off runs; see [Use the skill](/for-agents/use-the-skill/) for the full update-propagation story.

## Optional global update

`big-plan update --check` reports the installed and latest published versions without installing anything.
Running `big-plan update` without `--check` is opt-in mutation: for a recognized global npm or pnpm install, the built-in updater runs the matching global package-manager upgrade.
Use it only when a global upgrade is wanted; prefer `npx big-plan@latest` for always-current one-off runs.

## Input and output paths

The CLI resolves the input path against the current working directory.
It reads the input as UTF-8 text.

When the output argument is omitted, `render` replaces the input filename extension with `.html` and `compile` replaces it with `.model.json`.
An input without an extension receives the suffix at the end.
The default output therefore sits next to the input.

When the output argument is present, the CLI resolves it against the current working directory.
It creates the output file's parent directories recursively before writing UTF-8 HTML or JSON.
Neither derived-output command permits the output to resolve to the input file, including through a symbolic link or hard link, so derived output cannot overwrite the canonical MDX source.

## Document metadata

`validate`, `render`, and `compile` choose the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the document's level-two sections.

## The compiled plan model

The JSON written by `compile` is Big Plan's **compiled plan model**: a structured representation intended for agents and tools.
`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes that representation as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with `id`, structural `name`, h2 `title`, and optional registered `type`.
- `components`: every component instance in document order, each with its `component` name, source `line` and `column`, its `blockId`, and its compiled `model` - the same typed model the renderer consumes, so structure can never drift from rendering.
  `blockId` is the address a reviewer's comment on that component resolves to, so a tool holding the model already holds the anchor feedback arrives against.
  It is absent for a component the reader cannot point at on its own: one rendered privately inside another component's markup, or one that is a slide scope rather than a block.

Prose fields inside models (context paragraphs, option bodies) are HAST subtrees: plain JSON objects describing the markdown content.
Generated element ids inside models match the ids in the rendered HTML, so a tool can link a model entry to its rendered element.

## Validation and linting

`validate` reads and checks the plan without choosing an output path, creating a directory, or writing a file.
It performs three checks:

1. The shared static-subset MDX and component compiler accepts the authored structure.
2. Big Plan renders the complete HTML document in memory, including React component presentation, Markdown transforms, shell composition, and serialization.
3. The authored plan passes every registered linting rule.

Lint is intentionally stricter than structural compilation.
`render` applies the same linting rules after derivation and before writing, so a plan that fails lint never becomes a review document; `compile` continues to accept legal Markdown that a quality rule flags.
See [Linting rules](/reference/lint-rules/) for every rule and its conservative matching boundaries.
Rendering the document in memory does not replace visual review: browser layout, readability, and whether the page matches author intent still require a human.

## Successful results

On success, each command returns a structured result for `axi-sdk-js` to serialize.
`render` returns:

- `rendered`: the absolute output path.
- `title`: the rendered document title.
- `sections`: the number of rendered sections.
- `help`: an instruction to open the absolute output path in a browser.

`compile` returns:

- `compiled`: the absolute output path.
- `title`: the document title.
- `sections` and `components`: the counts collected.
- `help`: a description of what the JSON holds.

`validate` returns:

- `validated`: the absolute input path.
- `title`: the document title.
- `sections` and `components`: the validated counts.
- `help`: a reminder that lint checks only what is statically analyzable, so the rendered document still needs rereading against the `guidance` principles.

It writes no output.

When `review` takes custody of the plan, it returns the stable loopback address,
resolved plan path, session id, and feedback directory, then keeps running until
`Ctrl+C` or an opt-in idle timeout. It owns the local session token,
heartbeat, durable review state, and source snapshots.

`review` is the plan's address on the review-link service. It is the same for
every run of the same plan file and keeps answering through runtime restarts.
`direct` is the ephemeral session address and is reported as a debugging line.
When the service cannot run, `review` falls back to that direct address,
`direct` is omitted, and `help` says why.

It always reports `custody`, because only one runtime may hold a plan at a time,
and that value says whether this command took it:

- `activated`: this runtime took a free plan and is now serving it.
- `held`: a live runtime already serves this plan, so no second runtime started. The returned address, plan, and session id are that live runtime's, and no `feedback` directory is reported. The command exits instead of listening.
- `seized`: `--takeover` replaced a live runtime, which is named in `help`.

Liveness is the session heartbeat the coding agent already relies on, plus one
freshness window of grace for a runtime that has not yet written its first
heartbeat, so two simultaneous starts cannot both take the same plan.
A stopped, expired, or crashed session leaves the plan free, and the next
`review` takes custody normally.
`--takeover` leaves the replaced runtime listening without write custody, which
makes its open page and its connected agent read-only until each moves to the
new address.

`agent <input.mdx>` reads the matching live session and returns the owner-only
prompt plus pasteable Codex and Claude launch commands. Big Plan does not call
a model provider itself. The launched coding-agent session uses:

- `agent next <input.mdx> --wait` to receive the oldest pending feedback,
  thread reply, or plan-wide chat question, its prior conversation, a validated
  response template, the private candidate to edit, and the exact publish command;
- `agent push <input.mdx> --prompt "<text>"` to relay the reviewer's own words as an agent-initiated thread, or `--about "<text>"` to open it in the agent's words;
- `agent note <input.mdx> "<progress>"` to keep the reviewer
  informed as each meaningful work step begins; and
- `agent respond <input.mdx> <response.json>` to publish one
  complete answer, and the candidate it was written against, after that
  candidate has rendered and passed lint.

A claim records the connection that took it, so the agent that is working can be named without ever naming one that is only waiting.

`agent push` opens and claims a private candidate immediately rather than placing work in the reviewer-message queue.
Exactly one of `--prompt` or `--about` is required because the stored origin determines whose words the review later presents.
Pass the returned thread id back with `--thread <id>` to continue a pushed thread; omitting it opens a new thread.
A resolved or unknown thread is refused, and any live claim or other non-terminal push on the plan must be answered or canceled first.
Queued but unclaimed reviewer messages do not block a push, but the returned `rules` list names their count so the agent can answer them next.
The result mirrors `agent next`: it returns the claimed `work`, private `candidate_plan`, `response_file`, claim and connection tokens, ready-to-run `note_command` and `respond_command`, and whether the returned thread was opened or continued.
The unchanged reviewer cancel action drops the push's private stage and releases the plan.

`agent next` mints the `--agent` token when it hands out a request, and returns
it as `agent_token` together with ready-to-run `note_command`,
`respond_command`, and `next_command` strings.
It also mints the `--connection` token at the agent's first command and returns
it as `connection_token`, carried by every command string it returns.
The two say different things: the agent token names one claim and ends with it,
while the connection token names the agent session running the loop and lasts as
long as that session does.
Running the returned commands unchanged hands both back, which is what lets the
reviewer's **Agent Status** name one connected agent across a whole conversation
instead of a new one at every command - and what lets a decision the reviewer
takes between two of the agent's commands still reach it.
An agent that brings no connection token is a new connection and is given a new
one, so a second agent never inherits a decision taken about the first.
It also returns `candidate_plan`: this claim's own copy of the plan, and the
only repository file the agent edits.
The agent writes its response JSON to the returned `response_file`, then runs
the returned `respond_command` to validate and publish both files.
The plan path itself stays read-only identity, so relative asset paths and
repository context still resolve against it, and Big Plan writes it only when a
response publishes.
Resuming with `--agent <token>` returns the same candidate, with the edits the
previous process left in it.
The returned `note_command` includes the progress text `"Working on the request"`, so running it unchanged records that update and renews the claim.
For later meaningful steps, use `agent note <input.mdx> "<progress>" --agent <token>` with a short, specific progress line.
If the agent process restarts while that request remains open, pass the returned token back with `agent next <input.mdx> --agent <token>` to resume the same pickup.
Run the returned `note_command` and `respond_command` strings unchanged.
The token is what proves this agent process holds the request, so a second
agent working the same review cannot narrate over or answer another agent's
work.
Only one request on a plan may hold a live claim, so a second agent waits rather than editing the plan in parallel.
Without `--wait`, `agent next` reports that no work is available while another claim is live.
With `--wait`, it continues once the holder's request is answered or canceled.
A waiting `agent next` also ends when the process that started it does: it records that process at startup, rechecks it before every wait and once more before claiming, and exits rather than claiming work whose output nothing would read.
A lapsed lease no longer risks the plan.
Every claim carries a generation that a reviewer's hand-off raises, the displaced agent keeps writing only to its own candidate, and `agent respond` refuses a generation that no longer holds the claim.
A hand-off therefore starts from the last published revision, and the reviewer is told the previous agent's unpublished edits stayed in its own stage.

A claim also ends when the reviewer takes the message back: once an agent has reported nothing for far longer than a turn takes and no agent is connected, that claim counts as abandoned and the message becomes editable and deletable again.
Taking a message back discards the stage its claim was drafting, and a returning agent's `agent respond` is refused rather than published, so pick up current work with `agent next`.

The reviewer can also take an agent off a review from **Agent Status**, and every `agent` command answers that at its next run.
The disconnect names exactly one agent, by the connection token of the agent holding the plan's live claim, or by the connected agent's own connection token when no claim is live.
It names a connection rather than a pickup because disconnecting releases that pickup immediately, so it reaches that agent whether it is mid-answer or between commands, and it reaches nobody else - including a second agent waiting beside it.
`agent next` reports it as an ordinary end - `ended`, `disconnected`, and `role: "disconnected"` with the reason, and a zero exit - after marking the session ended so the reviewer's connection log records a reported end rather than a silence.
`agent push`, `agent note`, and `agent respond` refuse with the `AGENT_DISCONNECTED` code and a nonzero exit, so a harness stops rather than retrying a command that can never succeed again.
The answer the disconnected session was drafting is dropped, its private stage is removed, and the reviewer's message goes back in the queue for whichever agent connects next.
The agent also leaves the roster of attached agents, so the seat it held is empty and the next connector takes it instead of attaching as an observer of an agent that has gone.

`agent respond` publishes under one plan-mutation lock: it re-proves the claim, requires the plan to still carry the revision the candidate started from, and swaps the candidate in with one atomic rename.
A response that finds the plan changed underneath it is refused with the `SOURCE_MOVED` code rather than applied, so the agent takes the work again from the current plan.
If the process dies mid-publish, the next `agent` command and the next `big-plan review` settle the interrupted commit before serving anything: the answer completes if the swap won, the request stays open if it did not, and a plan matching neither revision stops agent edits with a conflict naming both digests instead of overwriting the file.

Export any of these environment variables before running `agent next`, `agent
push`, or `agent note` to report who is connected. They carry the four facts **Agent Status**
shows, with a session declared either as an address or as an id:

| Variable                     | What it declares                                                         | Limit       |
| ---------------------------- | ------------------------------------------------------------------------ | ----------- |
| `BIG_PLAN_AGENT_MODEL`       | Your API's own canonical model id, for example `grok-4.6`.               | 80 chars    |
| `BIG_PLAN_AGENT_EFFORT`      | How hard the model was told to think, for example `high`.                | 24 chars    |
| `BIG_PLAN_AGENT_CLIENT`      | Which tool is connected, for example `grok-cli 0.2.99`.                  | 80 chars    |
| `BIG_PLAN_AGENT_SESSION_URL` | The agent's own conversation address; Big Plan decides whether it links. | 2,048 chars |
| `BIG_PLAN_AGENT_SESSION`     | That conversation's opaque id, when it has no address.                   | 120 chars   |

All are optional and independent: declare only the ones you can answer, and the
reviewer is shown exactly those.
Terminal escape and control sequences are removed before the values are shown,
because they are terminal formatting rather than part of the declaration.
Beyond that cleanup, Big Plan does not guess missing facts or re-case an
unrecognized id: its declared text is shown unchanged.
Where nothing is declared the reviewer is shown no identity at all rather than a
note about its absence.
A value that exceeds its limit, is empty, or fails its own check is dropped on
its own; the rest of the declaration still stands.
`agent next` and `agent push` store the declaration with the durable per-pickup claim, and `agent note` preserves or refreshes that claim identity.
The reviewer's browser reads the declaration from the pickup it is describing, for as long as that pickup still explains the plan's quiet, so a waiting agent's heartbeat cannot relabel another agent's request.

A `changed` outcome is accepted only when the result snapshot differs and every
named target belongs to the computed snapshot diff. Other outcomes are
`answered`, `warning`, `needs-input`, and `declined`; a warning makes no edit,
must carry a short scannable `summary` of the boundary it would cross,
and waits for explicit reviewer confirmation. **What changed** uses retained
premise, claim-time baseline, and result snapshots rather than DOM mutation.
The temporary development-only `review --diff-preview` flag seeds a synthetic
gallery answer through that same pipeline and marks the browser with a visible
preview banner.

### One review, one primary agent

One agent answers a review at a time, and which one is the reviewer's decision rather than a race.
The first connector to attach is the **primary**: it may claim work, report progress, and publish.
Every connector after it attaches as an **observer**, which may read the plan and may do none of those three things; the reviewer's comments and the state of their requests are not handed to an observer either.
An observer never picks up queued work, however long the primary has been quiet, and it never becomes the primary by arriving.

Arriving as an observer is itself the request to become the primary, so nothing extra has to be passed for the reviewer to be asked.
`agent next` returns this instead of a work item:

```json
{
  "pending": false,
  "role": "observer",
  "plan": "/path/to/plan.mdx",
  "review": "http://127.0.0.1:8420/",
  "reason": "Another agent is the primary for this review, so this session cannot answer the reviewer yet"
}
```

Without `--wait` that result is final and the process should exit.
With `--wait` the loop stays attached and keeps asking until the reviewer answers, then continues as a work item if they made it the primary.

The reviewer answers from **Agent Status** in the review, where every attached agent has a card: **Make it primary**, **Leave it as observer**, or **Disconnect this agent**.
Making an observer the primary displaces the incumbent immediately: its open claim is freed, and the reviewer may hand its unpublished draft to the new primary as `previous_agent_draft` - a path to read as reference, never a candidate to publish.

A displaced agent finds out at its next command rather than after paying for a whole turn, and there are two shapes to branch on.
`agent note` and `agent respond` refuse with the error code `PRIMACY_LOST`, naming the agent that holds the plan now.
`agent next` is not an error: a displaced loop is an observer again, so it returns the `role: "observer"` result above.
Branch on both.
A harness that watches only for `PRIMACY_LOST` reads the observer result as ordinary "no work" and polls on, which is exactly the churn this design removes; the correct response to either is to stop claiming, not to retry.

**Disconnect this agent** ends the loop outright rather than moving its role.
The reviewer's answer is recorded, so a loop already waiting on `--wait` is told at its very next refresh instead of quietly registering again, and `agent next` returns a final result:

```json
{
  "pending": false,
  "ended": true,
  "disconnected": true,
  "role": "disconnected",
  "plan": "/path/to/plan.mdx",
  "review": "http://127.0.0.1:8420/",
  "reason": "The reviewer disconnected this agent from the review, so this session no longer speaks for the plan"
}
```

That is the same result **Disconnect agent** on the agent status card returns, because it is the same fact: the reviewer took this agent off the review.
It states that fact twice on purpose - as the end (`ended` and `disconnected`) and as the role it is no longer in (`role`) - so a harness branches on whichever one it already reads, rather than on which control the reviewer pressed.
That result is terminal even with `--wait`: stop the loop.
`agent note` and `agent respond` from the same session refuse with `PRIMACY_LOST` and say the reviewer disconnected it, for as long as the turn they belong to could still be running.
The claim it was part way through is freed as well, so the turn it had in flight can no longer reach the plan, and no other agent's claim is touched.
Disconnecting the agent that answers the review leaves the review with no primary until the reviewer fills the seat, and they have two ways to do it.
No agent already attached succeeds into a seat the reviewer emptied, so an observer waits there until they pick it from **Agent Status**.
A connector started afterwards is a different matter: it arrives to an empty seat and becomes the primary under the ordinary arrival rule, without being asked, because running the connect prompt is the reviewer saying who answers.

A published turn keeps its own seat for as long as the answering agent's return trip takes.
`agent respond` therefore returns `next`: an `agent next ... --wait --agent <token>` command carrying the token just answered under.
Run it as given.
It reclaims the same registration at once, which is what keeps one agent one agent to the reviewer across the several short-lived processes a turn takes.
A bare `agent next` after publishing mints a new identity instead, so it attaches as an observer of the turn it just finished and waits for the seat rather than picking up straight away.
It does not put a question to the reviewer while it waits: until the return trip is over, Big Plan cannot tell a second agent from the incumbent coming back, so the question is held and raised only if a second agent is what it turns out to be.

An observer succeeds to the seat by itself in one case only: the primary fell silent, and the seat has stayed empty for longer than a turn's own quiet.
That is the recovery path for an agent that died mid review, and it is deliberately slow.
Every other way a seat empties - a turn ending, a poll returning, a reviewer disconnecting the primary - is either momentary or the reviewer's own decision, and neither is a vacancy to be filled.

### `big-plan service`

The review-link service is one small loopback process on a fixed port that
answers saved review links, so a link keeps working after the review session
behind it ends. It holds no review state: it reads the plan's own session files
at the moment of the request, then forwards to the live session by default,
redirects to it when the rollback switch is enabled, or serves a page explaining
the session state.

Nothing needs installing. Any command that prints a review link starts the
service when nothing is answering, and it stops when you tell it to or when your
login session ends.

- `service status` reports `running`, `stopped`, or `unavailable`, plus the
  port, the version, the process id, the start time, how many plans it answers
  for, and how it is managed.
- `service start` starts it now, exactly as a link-printing command would.
- `service stop` stops it; the next `big-plan` command that prints a link starts
  it again. Saved links do not open in between.
- `service restart` stops and starts it.

The service listens on `127.0.0.1` only and never connects beyond loopback.

Opening the port itself shows what the process is, when it started, and a
`Stop the service` control that asks for confirmation and then does exactly what
`service stop` does, so whoever finds the port can also shut it down. That page
lists nothing about the plans this machine knows, so an address cannot be
guessed into an index of someone's work.

The port is fixed at `8790` because saved links point at it. Big Plan never
moves to a different port on its own: when something else already holds the
port, every command says so, names the process holding it where the platform can
report one, and keeps working with the session's direct address. Set
`BIG_PLAN_PORT` to choose a different port, remembering that links saved at the
old one stop resolving.

The service forwards a running review by default, so the browser stays on the
stable address. `BIG_PLAN_PROXY=0` is the reversible escape hatch that restores
the redirect. It is a startup switch, not a persisted setting: the listening
process reads it once, and a command that finds a healthy service adopts that
process. Changing the variable therefore requires `service restart`, or
`service stop` before the next command that prints an address.

State lives under `~/.big-plan/service/`, owner-only, and honours
`BIG_PLAN_STATE_DIR`: one small identity record per plan, the token that
authorizes stopping, and an advisory record of the running process. No file
there records whether a session is alive; that answer only ever comes from the
plan's own heartbeat.

A service left running from an older install is replaced automatically: the
version it reports is compared with the running CLI, and a mismatch stops and
respawns it before a link is printed.

`guidance` returns the guidance Markdown itself rather than a structured result.
`skill` with no arguments returns the skill Markdown the same way.
`skill write` returns:

- `written`: the absolute output path.
- `help`: a reminder that authoring rules still come from `guidance`, and when to re-run `skill write`.

## Errors

If the input argument is missing, `validate`, `render`, `compile`, or `review` raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and its command-specific usage line.

```text
Usage: big-plan validate <input.mdx>
Usage: big-plan render <input.mdx> [output.html]
Usage: big-plan compile <input.mdx> [output.json]
Usage: big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
```

`validate`, `render`, `compile`, and `skill` reject any dash-prefixed command argument as an unknown option. `review` additionally accepts `--diff-preview`, `--idle-timeout <minutes>`, and `--takeover`; it defaults to no idle timeout, `--idle-timeout 0` is the same, and a nonzero timeout must be at least 1 minute.
`validate` and `review` reject a second positional argument; `render` and `compile` reject a third.
Both cases raise a structured `VALIDATION_ERROR`, include the command's usage line, and write no output.
An empty, non-numeric, negative, nonzero sub-minute, or overflowing `review --idle-timeout` value raises a structured `INVALID_INPUT` error.

`agent` rejects an unknown action or invalid action arguments with
`INVALID_INPUT` and its complete multi-line usage text.

`agent note` and `agent respond` raise `PRIMACY_LOST` when the reviewer has made another attached agent the primary for this review, or has disconnected this one.
The message names the agent that holds the plan now, or says the reviewer disconnected this one, and the help entries say to stop the loop rather than retry.
It carries no usage text, because the command was well formed; a harness branches on the code to end a displaced loop cleanly instead of churning.
`agent next` reports the same two situations as ordinary results rather than errors - `role: "observer"` and `role: "disconnected"` - so a harness must branch on those too.

If the input for `validate`, `render`, `compile`, or `review` cannot be read, the command raises a structured `INPUT_NOT_FOUND` error with the resolved absolute input path and the same usage line.
The read error covers any failure to read the input file.

If the output would overwrite the input file, the command raises a structured `VALIDATION_ERROR` with the message `Output path would overwrite the input MDX file` and the command-specific usage line.
The input file is left unchanged.

If parsing or component validation fails, the command raises a structured `VALIDATION_ERROR` with `Cannot validate document with invalid MDX`, `Cannot render document with invalid MDX`, `Cannot compile document with invalid MDX`, or `Cannot review a document with invalid MDX`, according to the command.
Its help entries contain every collected authoring diagnostic as `line:column message`, and no output file is written.

If authoring lint fails, `validate`, `render`, and `review` raise `VALIDATION_ERROR` with `Plan failed authoring lint`.
Each help entry is `line:column [rule-id] message`.
`render` runs lint before writing, and `review` runs it before opening a port.

If guidance has not been acknowledged for the working directory, `validate`, `render`, and `review` raise a structured `GUIDANCE_REQUIRED` error whose help entries name the `big-plan guidance` command and the acknowledgment window.

`axi-sdk-js` maps `VALIDATION_ERROR` to exit status `2`.
Successful validation exits `0`; operational or internal failures use `1`.

## Top-level help and version

The CLI configures top-level help that lists the product commands and the derived-output defaults; `axi-sdk-js` appends the built-in update commands.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.
