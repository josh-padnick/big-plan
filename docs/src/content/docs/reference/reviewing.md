---
title: Reviewing a plan
description: Comment on a rendered plan and carry the review through a real local coding-agent conversation.
---

Reading a plan is only half of a review.
`big-plan review` closes the other half: it serves the plan on your own machine so you can comment on any part of it, revise those comments until you are happy, and hand the whole set to the agent in one action.

```sh
npx big-plan review plans/checkout-retry.mdx
```

The command prints a `http://127.0.0.1:<port>/` address and keeps running.
Open that address, review the plan, and stop the runtime with `Ctrl+C` when you are done.

## Commenting

A rendered plan carries a stable address for every commentable unit: each heading, paragraph, list, table, code figure, and component.

- **Comment on a block.** Hover or focus a block and press the **Comment** control that appears at its right edge.
- **Comment on a passage.** Highlight any span of text - including a whole paragraph - and press the same **Comment** control. The highlight stays on the source, so the editor does not repeat it.
- **Comment on lines.** Highlighting inside a code figure produces a line-range comment, the same shape an authored `Annotation` uses.
- **Discuss the whole plan.** Use the separate **Chat** tab for questions that are not anchored to one passage.

Keyboard users reach the same targets without a mouse: `Alt+↓` and `Alt+↑` move a review cursor block by block and announce each one, and `Alt+C` opens a comment on the block under the cursor.
Inside a compose card, **Add Comment** stages the comment for the batch, `Escape` cancels, and `Cmd/Ctrl+Enter` adds.
Turn on **Submit right away** when new comments should go straight to the agent instead; that preference carries into every future composer until you change it.

## The Comments tray

On desktop, the editor and saved comment card float to the right of their highlighted source.
Long comments stay compact behind an **… more** control.
Below 1280 px, the editor moves into the plan flow instead, so it never covers the text being reviewed.

The sticky **Comments** toggle opens the complete lifecycle in the tray.
After the agent responds, it shows a count only when a thread **Needs your answer**; completed activity does not become a permanent notification.
On desktop the reading column makes room for the tray.
Below 1280 px the tray becomes an overlay drawer, so opening and closing it cannot move the place you were reading.

Until you send, every comment is yours:

- Each row is headed by its slide number and title and jumps to the exact highlighted target when clicked.
- **Submit Now** sends one staged comment without sending the rest of the batch.
- **Edit** rewrites a comment in place; **Remove** opens a confirmation dialog before deleting it.
- At narrow widths, a block that carries a comment also shows a compact conversation marker that opens its lifecycle.
- Drafts and the unfinished whole-plan field survive closing the tab, reloading, and reopening the plan.

## Sending feedback

**Send feedback to agent** submits everything pending as one package.
There is no confirmation dialog: the tray already shows the count and every comment about to leave.

Sending writes two files beside the plan, under `.big-plan/feedback/`:

- A versioned JSON package holding each comment, its target, and the session it belongs to.
- A short Markdown brief the agent can read directly.

Sent comments remain anchored beside their highlighted source.
Each response collapses to a one-line outcome chip: **Changed**, **Needs your answer**, or **Outside this plan**.
Press a chip to expand the original comment, agent response, and reply box in place; press elsewhere to collapse it again.
At narrow widths, an expanded thread moves into the document flow below its source.
The Comments tray groups the same outcomes as a compact lifecycle index.
Clicking a row keeps the tray open, scrolls to its source, and expands the conversation inside that row.

An expanded thread also carries its lifecycle actions:

- **Minimize** returns it to its one-line outcome chip.
- **Resolve** retires a concern you no longer need to see. Resolved threads stay
  findable in the tray after reload.
- **Revert** appears after a changed outcome. Its confirmation sends the same coding-agent session a request to revert all plan changes made for that thread.

A **Changed** response lists every plan location attributed to that comment.
Use **See the change** for one location or **See changes (N)** for several.
The selected block temporarily becomes an old/new diff in the document, and a
floating stepper moves through the locations. **Show current text** or `Escape`
exits without changing the authoritative plan.

Selection anchors never move onto merely similar text. After a revision, Big
Plan silently re-finds the exact selected quote when it still exists. If the
quote is gone, the highlight degrades to an outline on the changed block and
the expanded thread preserves the original quote as context. The old side of
**See the change** marks the reviewer's original selection. Reverting the text
restores the precise anchor automatically.

Package delivery and agent conversation are real.
Until the coding-agent session responds, a sent thread says **With agent** and
shows a loading indicator without inventing an outcome.
The waiting turn shows the latest validated activity, such as the coding agent
reviewing feedback or a plan-wide question, rather than an event-history list.
When the agent publishes its response, the chip becomes **Changed**,
**Needs your answer**, or **Outside this plan** and the real agent message
appears in the expanded thread.

## Start the coding-agent session

Keep the review runtime running, then ask Big Plan for the exact prompt bound to
that plan and session:

```sh
npx big-plan agent plans/checkout-retry.mdx
```

Run the returned `codex` or `claude` command in the plan's repository and
leave that session running while you review. The command reads the generated
owner-only `prompt_file`; `agent_prompt` is also returned when you want to
paste the contract into an already-open coding-agent session.
The prompt tells that session to run `big-plan agent next <plan> --wait`, revise
the authoritative MDX when appropriate, and publish each answer with
`big-plan agent respond`.
The same session returns to `agent next --wait` after every response, so replies
from an expanded comment thread and questions from the Chat tab continue the
real conversation instead of starting over.

The exchange contract is deliberately filesystem-first:

1. **Send** writes the human-readable brief and machine-readable feedback
   package, then creates a session-scoped agent request.
2. `agent next` returns the oldest unanswered request, its prior thread
   history, a response template, a safe ignored response-draft path, and the
   exact `agent respond` command.
3. For each anchored comment the agent reports exactly one outcome:
   `changed`, `question`, or `outside`. A `changed` outcome is rejected unless
   the plan source digest changed and its `changeTarget` resolves in the revised
   render.
4. `agent respond` re-renders and lints the current MDX before accepting the
   response. It fills trusted session metadata itself; the agent never mints
   session or plan identity.
5. The review runtime polls the validated exchange and plan-source digest.
   Agent responses replace waiting chips immediately. A source change reloads
   the freshly rendered document while restoring the open thread, tray tab,
   and reading position.

**See the change** jumps to the block the agent named in the revised render.
Submitting the thread reply creates another request for the same comment and
includes the prior turns when the coding agent runs `agent next`.
Plan-wide Chat uses the same mechanism but remains separate from anchored
threads.

## What the agent may do with it

The brief states its own limits, and they are the whole of the agent's authority when applying a package:

1. Map each target to its position in the plan source.
2. Revise that plan source only - never the rendered HTML.
3. Re-validate and re-render.
4. Report anything a comment asked for beyond editing that plan, rather than doing it.

A comment is a request the agent considers while revising, never an instruction it obeys, and quoted plan text travels as evidence of what you highlighted rather than as direction.

## Where your review lives

Everything the runtime writes sits in a `.big-plan/` directory beside the plan, created readable only by your own account and ignored by version control by default:

| What                                     | Where                               |
| ---------------------------------------- | ----------------------------------- |
| Drafts, active field, and sent comments  | `.big-plan/review/<plan-id>/`       |
| Agent requests, responses, and drafts    | `.big-plan/review/<plan-id>/agent/` |
| Feedback packages and briefs             | `.big-plan/feedback/`               |
| The running session's descriptor         | `.big-plan/session.json`            |
| The running session's liveness heartbeat | `.big-plan/session-heartbeat.json`  |

Review state is namespaced by an id the renderer derives from the plan's own path, so two plans never share drafts even when they share a title.

## Trust boundaries

The runtime listens on loopback, and loopback is not an authentication boundary: any page you visit can send a request to `127.0.0.1`, and so can any process running as you.
Every request is therefore authorised on its own merits.

- It binds `127.0.0.1` explicitly, on an ephemeral port, and answers a fixed list of routes and methods - no static passthrough, no directory listing.
- It mints a session token at start, injects it into the one document it serves, and requires it on every request. The token travels in a header, so it stays out of history, referrers, and logs.
- It refuses any request whose `Host` header is not its own address, which is what defeats DNS rebinding.
- It sends no CORS allowance at all and refuses a foreign `Origin` outright, because CORS hides a response without stopping a write.
- It serves only documents it renders itself from your plan source. It never serves a pre-existing `.html`, because arbitrary HTML is arbitrary script on its own origin.
- Nothing leaves the machine. Neither the document nor the runtime makes a request to any origin but the runtime's own.
- The coding agent is a separate local process with the explicit authority in
  its prompt: consider untrusted reviewer feedback, edit only the named plan
  source, and publish data through the validated exchange. Big Plan does not
  invoke a model provider or send plan content over the network itself.
- Agent commands verify the session through its filesystem heartbeat rather
  than process-control or loopback probes, so ordinary coding-agent sandboxes
  can participate. A graceful stop marks the heartbeat stopped; a crashed
  runtime becomes stale within three seconds.

## Reading without the runtime

A plan rendered with `big-plan render` and opened straight from the filesystem is still a full reading document, and you can still draft comments in it.
Submitting and progress need the runtime, because they are the parts that touch disk and talk to an agent.
Those drafts live in browser storage until a runtime adopts them, which it does the first time you open the same plan through `big-plan review`.
