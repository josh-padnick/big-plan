---
title: Reviewing a plan
description: Review, revise, and approve a plan through the local runtime.
---

`big-plan review` serves one plan on your machine so you can attach notes to its
rendered blocks and hand the staged set to the agent.

```sh
npx -y big-plan@latest review plans/checkout-retry.mdx
```

The command prints a stable `http://127.0.0.1:8790/plan/<plan-id>` address and keeps running.
Open that address, review the plan, and stop the runtime with `Ctrl+C`.
By default the review stays up until you stop it, so a link you were handed
keeps working if you step away.
To close an abandoned session, set `--idle-timeout <minutes>`; a nonzero
timeout must be at least 1 minute.
An open review page then counts as activity on its own, so a session never ends
while you are still reading it.
Pass `--idle-timeout 0` to say the same thing as the default, explicitly.
A waiting agent receives that normal inactivity reason instead of a failed background command.
When an already-open page loses contact with its review runtime, it reports that loss rather than claiming the server stopped, because a request that merely timed out can happen while the runtime is still running.
If the deadline the page last knew has also passed, it reports that observation too.
When the page has no unsaved browser-only input, Refresh is offered in either case so you can check whether the review is still running.
If it does have unsaved input, Refresh stays disabled and the page asks you to keep the tab open instead.
It does not say why contact was lost, because a page that has lost contact cannot tell an idle expiry from a runtime someone stopped, or from one that is still serving another tab.
For the same reason it never tells you to start a new review runtime; the command is the only place that decides whether starting or taking over a runtime is allowed, and it answers that question for you.
When a newer review session for that plan was recorded before contact was lost, the page also links to it as **Open latest review**.

## The link worth saving

The printed address is derived from the plan file's path, so it is the same for
every review of that plan and keeps answering through runtime restarts. Save or
share the address the command printed rather than one assembled from the default
port: `BIG_PLAN_PORT` moves the service, and every link with it. The command also
prints the session's ephemeral address as a debugging line.

The service keeps the review on that stable address by default.
`BIG_PLAN_PROXY=0` restores the redirect to the session port. The switch is read
once when the service starts, so changing it requires
`big-plan service restart`, or `big-plan service stop` before the next command,
to take effect. Each review still runs on its own unique session port so its
process, custody, and write fences remain isolated; the service only supplies
the hop.

If a runtime stops answering without recording an ending, opening the stable
address shows that the review is restarting. API requests receive `503` with
`Retry-After`, which lets an open page record runtime unavailability without a
network failure. A live runtime's bare `503` remains its own refusal while a
write is stalled.

Opening it while a review is running serves that session without changing the
address. A deliberate stop gives a page saying why it ended. An unexpected stop
holds the address for the replacement runtime and includes the command that
starts the review again there.

The address is answered by a small local process described in
[the CLI reference](/reference/cli/#big-plan-service); `big-plan service status`
reports on it and `big-plan service stop` stops it. When it cannot run, the
command explains why and falls back to the direct session address.

## Starting a review that is already running

Only one review runtime holds custody of a plan at a time.
The one holding it is the only session that can save comments, and the only one a coding agent can answer through.

Running `big-plan review` on a plan a live runtime is already serving therefore takes nothing away.
It starts no second runtime, reports `custody: held`, and prints that runtime's address so you can open it.
The live session, its open page, and its connected agent keep working.
A runtime counts as live while its session heartbeat is current, which is the same liveness the coding agent relies on; a session that has stopped, expired, or crashed leaves the plan free and the next `big-plan review` takes custody normally.
Two `big-plan review` commands started at the same instant resolve the same way: exactly one takes custody, and the other prints that one's address.

Pass `--takeover` to replace a live session deliberately, for example when its terminal is gone but the process is still running:

```sh
npx -y big-plan@latest review plans/checkout-retry.mdx --takeover
```

The replaced runtime keeps listening but loses write custody.
Its open page and its connected agent become read-only until each reloads, so prefer opening the printed address over taking custody.
The command reports `custody: seized` together with the session it displaced.

## When a session stops accepting changes

A review session can stay online after one change never finishes: reading the plan keeps working, but the runtime stops accepting changes.
After 30 seconds, the runtime refuses the unfinished request and answers later direct write requests instead of leaving them waiting indefinitely.
The page then shows a **This review session has stopped accepting changes** alert, disables sending, and stops automatic draft-save requests instead of submitting changes the runtime has already said it will refuse.
The runtime keeps renewing its heartbeat, so the coding agent still sees the session as live, but it cannot save changes through that runtime.
Already persisted review data remains available, and a newly staged comment stays in the page and its local recovery snapshot, so keep the tab open, stop the runtime, and start it again on the same plan.

Every action that changes the review asks the same question before it sends: submitting comments, replying in a thread, asking a plan-wide question, deleting a sent comment, reverting the agent's changes, cancelling a queued request, and attaching an image.
When the answer is no, the action is refused up front and says why, what became of what you typed, and what clears the block, rather than appearing to start and failing seconds later.
Reading is never affected, and nothing you typed is discarded: text stays in its box, an unattached image leaves the message unchanged, and a request you could not cancel is still reported as being with the agent.
The same refusal covers a runtime the page has lost contact with and a session a newer review runtime has replaced, so the reason you are given always matches the condition the page actually observed.

## Diagnose an unresponsive session

Keep the terminal running the review open when the page stops answering.
The runtime gives up on waiting for a write that has run for 30 seconds, reports it once with its route and age, and lets the next write run.
The unfinished work is not cancelled and may still hold the review store's lock, so later writes are answered promptly with the same refusal rather than served.
It also reports current progress-history and agent-exchange counts when retained state crosses each 1,000-entry milestone.
Request failures that reach the runtime's generic error boundary leave their safe error type and stack in that terminal while keeping the reviewer-facing message and sensitive details out of the log.

Before stopping an unresponsive runtime on macOS or Linux, ask it for an immediate diagnostic dump:

```sh
kill -USR2 <review-process-pid>
```

The signal does not stop the review.
It prints the session, plan path, in-flight and stalled writes, and current growth counts to the review command's standard error output.

## Commenting workflow

1. Use a slide's comment icon, a component toolbar comment icon, or select text
   and choose **Comment**.
2. Write a Markdown comment and choose **Submit Now**. Turn off **Submit right
   away** to stage it with **Add Comment** instead. `Cmd/Ctrl+Enter` performs
   the visible primary action; `Escape` cancels.
   Hover or focus the primary action or **Cancel** to see the shortcut for that control, including while the primary action is disabled.
   Hover or focus the information mark beside **Submit right away** to compare immediate submission with staging comments for a later batch.
3. Open **Feedback** to inspect staged comments in the **Comments** tab.
   The **Chat** tab asks questions about the plan as a whole.
   The **Chat** tab also shows threads that the agent pushed into the review.
   **Inputs** lists what the review is still waiting for.
   **Agent Status** - its own control beside **Feedback** - shows the coding-agent connection and current work for a live review session.
   **More actions** follows those visible controls and contains **Export**, then **Settings**.
   The two controls share the sidebar and toggle independently: choosing one
   swaps the sidebar's body to it, and choosing it again closes the sidebar.
   A review-session outage is reported separately and does not label the agent
   as offline.
4. Edit or delete an individual staged comment, or choose **Send all comments
   to agent** to write one feedback package.

The **Chat** tab groups unresolved pushed conversations under **Threads** and files resolved ones under **Resolved**.
Every pushed card uses the bot icon and **Added by agent** heading.
A push that relays reviewer wording needs no extra origin marker, while an agent-authored opener carries the narrower **Agent-opened · About** context.
Open the card to reply, review and accept its changes, revert a response, or resolve the thread after its pending work finishes.
When the agent continues a pushed thread, Big Plan adds another exchange to the same card.
The card keeps the opener's presentation.

A push that lands while you are reading announces itself.
The **Chat** tab leads with a **Pushed just now** entry naming the agent's model and client, plus how many blocks changed when the push revised the plan.
**Open thread** takes you to the conversation, and **Dismiss** clears the entry; either way the entry names the newest arrival, and a newer push replaces it.
On a wide screen, where the sidebar sits beside the plan rather than over it, an arrival opens the sidebar on **Chat** for you, unless you are part-way through writing a comment or reply or a pointer press is in flight: reserving the sidebar's gutter would move or recreate the control you are using, so the arrival waits until that interaction finishes.
On a narrower screen it waits as well, because the sidebar would cover the sentence you are reading.
The entry waits on **Chat** without adding a closed-sidebar toolbar indicator; once the sidebar is open on another tab, **Chat** carries a mark until you view the entry.
Your reading position is kept either way.

The blocks the revision changed settle briefly in place, so you can see what moved without hunting for it.
Readers who ask their system for reduced motion get the entry without the highlight.

A comment reaches the agent with the scope it was left at.
Selecting text inside a paragraph, list, or table cell anchors the note to that block alone.
A slide's comment icon, or a selection of the slide's own title, addresses the whole slide, so an instruction such as "rewrite this in Spanish" carries the slide's content rather than its heading.
When that slide is split into sub-slides, the agent is given the slide's own content above the first sub-slide plus the names of the sub-slides it continues into, and reads their content from the plan source.

A plan may also point at picture files of its own, such as
`![The cabinet](./assets/cabinet.jpg)`.
`big-plan review` serves any PNG, JPEG, WebP, GIF, AVIF, or SVG file up to 10 MiB that sits inside the plan's own directory, at any depth, so a photograph an author or an agent saves beside the plan appears in the review document.
Nothing else in that directory is served: another file type, a dot-prefixed
directory such as `.big-plan/`, and any path that leaves the plan's directory
are all refused.

Comments, replies, and plan-wide chat accept PNG, JPEG, and WebP screenshots.
Paste an image into a composer or drag and drop a file onto it.
The runtime stores each image by its SHA-256 digest and inserts a Markdown
reference into the message.
Images are limited to four per message, 10 MiB per image, and 20 MiB total.
Each stored image belongs to the plan rather than to one review session, so a
picture pasted today still appears after the review runtime is restarted.
A stored picture that cannot load is shown as an **Image unavailable** placeholder that explains itself on demand.
The local `big-plan review` runtime is required to capture or retrieve images;
standalone rendered files keep text drafts but do not accept image bytes.

The kernel is a typed React interaction island built from token-themed
shadcn/ui primitives. The plan content stays server-rendered HTML: React adds
controls beside that content, and a live revision swaps in the next
server-rendered article without client-rendering or gating the plan.

## Decision answers

An open decision card - a `Decision`, a `QuickDecision`, or a `DecisionAnalysis` with `interaction="choose"` - can be answered during a live review.
A confirmed choice is saved with the review: it survives reload and runtime restarts, so the answer is still there when you come back to the page, and it stays saved until you change or clear it.
The answer stays inside the review session until approval records it for the later agent handoff; tell the agent through the feedback flow when you want it acted on before then.
The card's caption always states what is true right now: saving, saved with this review, or noted for this reading session only.
If a save fails, the card says the answer is not saved yet and retries automatically; keep the page open until it reports the answer saved.

The review runtime alone decides which answers are current.
It compiles the plan, accepts only decision and option ids the current plan asks, and records with each answer a digest of that decision's full compiled content.
An answer is served only while its decision still asks exactly that content, so editing the decision's own question, options, summaries, considerations, or context masks its answer, while an edit elsewhere in the plan leaves it alone.
A card whose stored answer stopped applying says so on the card itself and asks to be answered again.
Nothing is deleted: restoring the decision's exact content revives the original answer.
Choosing **Change** is not a reversible peek: it retracts the saved answer straight away, and the decision counts as unanswered until you confirm again.
So choose **Change** and confirm a different option to replace an answer, or **Change** and then **Clear answer** to leave the decision deliberately unanswered.

**Suggest another option** opens a composer that asks what your own words are for.
By default they are the decision: **Confirm choice** records them as the answer for this reading session, and they then stand as a **New option** until **Change** reopens the field with the text kept.
Unlike a chosen option, your own words are not saved with the review and do not come back after a reload.
Flip it to **Submit as comment** when the agent should act on the words instead: that side uses the review's own comment controls, so **Submit right away** decides whether the comment is sent immediately or staged with the rest of your feedback, and it reaches the agent as **Decision options feedback** with its thread beside the composer.
**Cancel** leaves the composer from either side, and the comment side needs a live review; a standalone document says so instead of submitting.

A read-only review page - one whose plan a newer review session took custody of - cannot record answers: every answering control is disabled, with a note beside it saying why.
A confirm made before the page has learned whether it may write is held rather than guessed at: it is saved once the session proves writable, and kept as a reading-session note when the session proves read-only.
Words recorded as the decision are a reading-session note either way, never a saved answer; submit them as a comment when the agent should act on them.
In a standalone rendered document, an answer lasts only for the reading session and is not saved with a review.

## What the review is waiting for

A live review's **Inputs** tab lists what the review is waiting on: for now, every decision the plan asks.
Each row says where that input stands - answered, not answered, or stale - and a decision the plan's author marked `critical` says so beside its state.
Selecting a row scrolls the plan to that decision's card.

The list is the runtime's answer rather than the page's, so two browsers reading the same review read the same list, and a reload cannot invent a different one.
**Stale** is its own state rather than a kind of unanswered: you answered, and the plan moved underneath the answer.
A decision goes stale under exactly the edits that mask its answer on the card, and restoring the wording it answered makes it answered again.

A standalone rendered document has no Inputs tab: the contract is derived by the review runtime, and a document opened without one has nothing to derive it from.

## Approving a plan

**Approve plan** appears in the branding bar only for a live review session that still has authority to write this plan.
Its confirmation dialog reports accepted and open change sets, answered and unanswered decisions, in-flight agent work, and the covering message from **Settings**.
Choose a listed item to inspect it before approving, or choose **Edit in Settings** to close the confirmation and open the **Approval message** page.

Confirming approval accepts every still-open change set, cancels every in-flight agent request, and records the current plan snapshot, saved decision answers, unanswered decisions, and covering message for the later agent handoff.
Every critical decision must be answered first; non-critical decisions may remain unanswered and are recorded that way.
The approval is refused if the plan changes while the confirmation is open, so the record never silently covers a different revision.

After approval, the branding-bar control reads **Plan approved**, and an approval stamp appears just above the document title in the reading column.
Open **Plan approved** to inspect the recorded message and any decisions left unanswered.
Choose **Revoke approval** there to return the plan to review; revocation does not undo anything already recorded in the plan source.
If the plan source changes while an approval remains in force, the bar reports **Changed since approval** and offers **Re-approve** for the plan as it now reads.

A review session that has become read-only continues to show an approval already in force, but does not offer approval or revocation actions.
A standalone rendered document shows no approval control.

## Exporting Markdown

Open **More actions**, choose **Export**, and confirm to download the latest committed plan as `<plan-name>.md`. The review runtime reads the authoritative plan source when you confirm, so a browser showing an older revision does not make the export stale. Candidate agent edits that have not been published are not part of that source.

The file preserves ordinary Markdown and turns every built-in component into a semantic Markdown presentation. Wireframes become vocabulary-neutral, per-screen reconstruction notes rather than screenshots: they describe the device frame, layout geometry, visual hierarchy, spatial groupings, appearance, states, labels, values, and navigation targets in plain UI language. A separated review overlay includes current saved decision answers and an approval summary only when the approval matches the exported plan version. Comments, comment drafts, feedback dispositions, staged agent candidates, and agent status are not included.

Export is available from live reviews, including a session that has become read-only, while its runtime remains reachable. A standalone document keeps the Settings gear and does not offer export because it has no authoritative source to refresh from.

## Persistence

Runtime-backed staged comments, recorded decision answers, recorded change acceptances, and the append-only approval log live under `.big-plan/review/<plan-id>/` beside the plan.
The review id comes from the resolved source path, so staged comments survive the plan revision the agent creates in response to feedback.
Comment text that is typed but not yet staged or sent is kept in a recovery record owned by its browser tab, so reloading or reopening after a crash gives back the tab's staged drafts, open comment composer, and half-written thread replies.
Each tab keeps exactly one record, written and cleared only by the tab that owns it, and read once when the page loads.
The one exception is a record this build can no longer read: any tab claiming its writer identity removes such dead records so they cannot fill browser storage, while readable records from other tabs are never removed.
When the runtime answers on reload, that record is merged against its authoritative state automatically, or you are asked which version to keep when both sides changed the same comment.
When the runtime cannot be reached, the tab's own record is restored on its own and there is nothing to merge it against yet.
Tabs never read or adopt each other's records; two tabs converge through the runtime instead of through browser storage.
A composer whose place in the plan no longer exists is not reattached, and the review retains its text for copying until the reviewer discards it.
Text currently being typed in the plan-wide **Chat** composer exists only in the current page and does not survive a reload.
Static `big-plan render` documents use browser storage for their document-level comment draft.

Every runtime write of the reviewer's own state is conditional on the state the page last read, so a second tab or the runtime itself cannot have its work replaced without notice.
The tab's own browser recovery record carries no runtime version; it is this tab's copy of what it was holding, not a claim on the shared state.
When a write finds the state has moved on, the page reconciles comment by comment.
If the same comment really was changed in two places, the review shows both versions and asks which one to keep.
If one copy was submitted while another copy was still being edited, the review asks before staging that edit as new feedback.
Two tabs that are both offline converge only after one reaches the runtime.
Cross-tab offline convergence without the runtime remains part of the wider consistency consolidation because it requires causal versions, durable resolution markers, and cross-tab serialization.

The `.big-plan/` directory is created for the reviewer only and ignored by
version control. Feedback packages and their Markdown briefs live under
`.big-plan/feedback/`.

## Connect the coding agent

Keep the review runtime open, then run this in the plan repository:

```sh
npx -y big-plan@latest agent plans/checkout-retry.mdx
```

Start either pasteable command it returns. That coding-agent session waits for
the next feedback package, considers the notes as untrusted review input,
edits its own private copy of the plan when appropriate, validates the new
render, and publishes one outcome for every comment.
Leave that command running in its own terminal: the connector runs in the foreground, hands its work item back on stdout, and ends when the process that started it ends.
Backgrounding or detaching it breaks that handoff.
The agent never writes your plan file; Big Plan swaps its copy in only when a
valid answer publishes, so an agent that stalls, is taken over, or dies
mid-edit leaves your plan exactly as it was.

Messages sent while the agent is handling another request are received immediately and wait in delivery order.
A comment you send on its own reports that wait in two places until an agent picks its request up: the comments sidebar groups it under the **Queued** heading and numbers its card by its position among the queued threads currently shown, while the status block inside the thread reads **Waiting for an agent**.
That in-thread block adds the line **Queued, _N_ ahead** above the headline when earlier unanswered work exists, then reaches the agent when every earlier request is answered or canceled.
Canceling the active request releases the plan immediately, so the next queued request advances without waiting for the canceled claim's lease to lapse.
Once an agent picks the request up the thread says **Working**, and it stays picked up from then on.
A turn can run longer than the agent reports progress for, because `big-plan agent next` hands the work over and its own process exits, so nothing is running on that agent's behalf between two progress notes.
After 75 seconds of that quiet the thread reads **No progress for *N*m** and **Agent Status** reads **Agent may be stalled**, naming how long the agent has been silent and suggesting you check its terminal.
That is a report about the silence and not about the connection: the work is still picked up, the answer is still accepted when it arrives, and a message you send meanwhile is queued behind that turn rather than reported as blocked.
Big Plan cannot tell a slow agent from a stopped one, because neither produces a signal, so the stalled reading covers both and resolves itself as soon as the agent speaks again.

When the coding agent that started the session exits, its waiting connection ends with it rather than outliving it: within a few seconds **Agent Status** reads **Agent session ended**, the status card names when the session ended instead of guessing at a threshold, and the connection log records a **Session ended** row.
A session that disappears without the connection noticing - a machine losing power, or something killing the whole process tree at once - still reads as disconnected after the same 75 seconds of silence as before.
Either way a message you send once the agent is gone reads **Blocked - no agent connected** and sends itself when an agent reconnects, rather than being picked up by a session that can no longer answer.

Sending several comments at once makes one feedback package, and the sidebar heads that package with what the package itself is doing.
One open package keeps one heading, and its threads stay under the **Queued** heading until an agent picks the package up - which is where they sit as soon as you send them, and for as long as no agent is connected.
Send a second package while the first is still being worked, and each package heads its own threads: the package being worked keeps the spinner, the package behind it reads **Queued, _N_ ahead** under an hourglass, and neither heading speaks for the other's threads.
A thread its package heads reports its wait through that heading instead of repeating it inside the card, and every thread still under the **Queued** heading keeps its position among the queued threads currently shown.

**Agent Status** offers **Reconnect your agent**, holding the one prompt that starts a coding-agent session; a session that has never had an agent reads **Connect your agent** instead.
An agent going quiet never hides that section, because it is the only place that prompt lives and losing your route back is the last thing a silence should cost you; only a read-only session or a review runtime you cannot reach hides it.
While an agent is attached that section instead reads **Connect another agent** and says what connecting one actually does: the new agent joins as an observer that can read the plan, cannot read your comments, and cannot answer you unless you make it the primary, and when it arrives you are asked who answers you from then on.
Nothing the current agent is working on is dropped unless you make the new agent the primary - because [the agent request protocol ADR](https://github.com/josh-padnick/big-plan/blob/main/adr/0002-serialize-agent-work-per-plan.md) serializes pickup and only the current holder may answer, so the agent holding the plan keeps answering until you move that.
When you do move it, the displaced agent's unfinished edits stay in its own copy and reach your plan only if you tick the box that hands them over, and even then they arrive as reference rather than as something that publishes itself.
Your comments are safe whichever you choose.

The agent status card carries **Disconnect agent** wherever an agent is attached, with a mark beside it that explains on hover or keyboard focus what disconnecting does: the agent is told to end its session so a different agent can attach, work it has in flight is dropped, and your comments stay.
Confirming is one dialog, and what it says depends on whether the agent is holding work rather than on how well it is doing.
An agent that holds a turn - answering, gone quiet mid-turn, or reporting an error - is named as holding work on the review, and the dialog states that the answer it has in flight is dropped rather than delivered; an agent holding nothing is disconnected without that sentence.
Either way your comments and questions stay exactly where they are, and a message the agent was holding goes back into the queue for the next agent instead of being canceled.

The disconnect is a message rather than a kill: Big Plan never reaches into the agent's process.
The agent is told at its next command - `big-plan agent next`, `agent push`, `agent note`, or `agent respond` - and ends its own session there, which is why the connection log records a **Session ended** row stating that the reviewer disconnected the agent rather than a quiet period it had to infer.
The row says so whether or not the agent lived long enough to acknowledge, because the decision is recorded against the connection you disconnected rather than against the message it was holding.
That row is recorded even when the agent had already gone quiet long enough for the log to write the silence off as a gap: the earlier row stays, because it was honest when it was written, and the end you asked for is recorded after it.
It is recorded when a second agent was waiting beside the one you disconnected too, and that agent stays attached and untouched: the log describes the review's connection rather than each agent separately, so it states the end you asked for and then shows the review continuing under the agent that stayed.
`agent next` reports the disconnect as an ordinary end; `agent push`, `agent note`, and `agent respond` refuse with the `AGENT_DISCONNECTED` code, so a harness stops instead of retrying.
The review itself is free the moment you confirm, so a second agent can connect without waiting for the first one to notice.

A second agent that connects does not take the review by arriving.
It attaches as an observer - able to read the plan, and nothing else: not your comments, not the state of your requests, and able to answer nothing - and asks you whether it should be the one answering you.
**Agent Status** raises a hazard mark while that question is unanswered.
The sidebar always leads with the agent status card, which carries a **Current primary** badge once a second agent is on the rail; under it sits the card that names the arriving agent by its declared harness and model plus an abbreviated writer id, falling back cleanly to the abbreviated id when it declared neither, and a **Current observer** card for anyone else attached.
Each agent gets exactly one card: the primary's is the status card at the top, so nobody is drawn twice.
The three answers stack under the asking agent's name with a mark beside each that says, on hover or keyboard focus, what it will do: **Make it primary** hands the review to that agent and makes the current one an observer, **Leave as observer** keeps the arrangement as it is and stops asking, and **Disconnect this agent** drops it from the review.
Making an observer the primary asks you to confirm, and offers to hand the outgoing agent's unfinished draft to the new one as reference it may read rather than as work that publishes itself; left unticked, that draft stays where it is and never reaches your plan.
Whichever you choose, the agent you moved away from is told at its next command instead of discovering it when its answer is refused, and anything it had in flight is fenced rather than delivered.
A disconnected agent stays gone: the decision is recorded, so a connector sitting in its waiting loop is told and stops rather than quietly re-attaching and asking you again.
Disconnecting the agent that answers you leaves the review without one until you say who takes over: Big Plan does not promote a watching agent into a seat you emptied, because that would answer a question you were asked and chose not to answer.
You say so in one of two ways, and **Agent Status** keeps showing its cards for as long as nobody is answering you so that both stay available.
Either pick an agent that is already watching and choose **Make it primary**, or connect a new one - a connector you start after the seat is empty takes it and begins answering, since starting it is you saying who answers.
The roster stays out of the way while one agent is answering you: a single attached agent with nothing to ask shows no cards at all.
It comes back the moment nobody is answering you, so the decision is always in reach.
When an arrival initially cannot be distinguished from the current agent returning between turns, Big Plan parks the question instead of showing a false second-agent card.
It raises the question as soon as the incumbent's closed claim and lack of a later signal establish that the arrival is different, or once the incumbent's silence crosses the stall horizon.

The stalled reading is bounded, because a pickup cannot account for silence indefinitely.
After 30 minutes without a single report Big Plan stops treating the pickup as an explanation: **Agent Status** gives way to the ordinary connection reading, the thread reads **No longer reporting**, drops its promise to resolve itself, leaves the **Working** group and offers **Show setup instructions →**, a message you send now reads **Blocked - no agent connected**, and the recovery section returns to its plain wording.
Past that point, and only while no agent is connected, the pickup also stops holding your comment: the claim is treated as abandoned, and **Delete comment the agent left?** returns with a confirmation that says the agent stopped reporting and its claim expired.
Both halves of that proof are required, because a quiet lease alone is what an ordinary turn looks like: a connected agent, or a silence still inside the 30 minutes, keeps the comment held exactly as before.
Deleting or editing what an abandoned claim was holding releases the claim, so an agent that comes back afterwards is refused rather than allowed to answer a message you have already changed.
A real response records an `answered`, `changed`, `warning`, `needs-input`, or `declined` outcome and shows the agent's message.
A warning leaves the plan unchanged, shows its short one-line summary directly under the **Warning** badge, explains the standard or template the request would cross, and lets the reviewer explicitly choose **Do it anyway**.
A changed result updates the plan in place without discarding staged comments, open threads, or scroll position.
The [agent request protocol ADR](https://github.com/josh-padnick/big-plan/blob/main/adr/0002-serialize-agent-work-per-plan.md) owns why pickup is serialized and what must change before concurrent plan editing can return.

A connected agent may declare its model, its reasoning effort, its client, and
its own conversation, each optional and independent of the others, by exporting
the environment variables the [CLI reference](/reference/cli/) lists for
`big-plan agent` in the session it was launched in.

**Agent Status** shows what was declared, and only what was declared: client,
model, and effort read as one line, each segment appearing only if the agent
stated it, and a session with no declaration shows no identity at all rather
than a note about its absence.
Whether a declared session can be opened is Big Plan's judgment, not the
agent's. A URL becomes an **Open the agent's chat** link only when it matches an
interface known to serve conversations a browser can follow:

| Interface                         | Shape                                                                    |
| --------------------------------- | ------------------------------------------------------------------------ |
| Claude Code on the web or desktop | `https://claude.ai/code/<id>` or `https://claude.com/code/<id>`          |
| Codex on the web or desktop       | `https://chatgpt.com/codex/<id>` or `https://chat.openai.com/codex/<id>` |
| Grok on the web                   | `https://grok.com/chat/<id>` or `https://grok.com/c/<id>`                |

Anything else - a CLI serving its own session, a private host, a custom scheme,
a bare id - is offered as **Copy agent session identifier** instead. A link that
does not open costs the reader their attention and their trust, so Big Plan
offers one only where it can stand behind it. Adding an interface is a change to
that table rather than a change to what a connector may declare.

Model ids are looked up, never rewritten. A known id prints the name its vendor
writes - `grok-4.6` shows as `Grok 4.6` - and uses that vendor's own logo. An id
Big Plan does not hold prints exactly as declared after the [CLI
reference's](/reference/cli/) documented input cleanup, and shows a logo only
where Big Plan holds a mark faithful to the vendor's published one, so a different
GPT-named model such as EleutherAI's GPT-J neither borrows the OpenAI logo nor
stands behind a generic one.
A client is read the same way, except that a recognized one drops the version it
declared - `grok-cli 0.2.99` shows as `Grok CLI` - because which build is running
is a fact about the agent's machine rather than about your review.

Identity belongs to the session's agent rather than to its heartbeat.
Once declared it stays on the card through that agent's working turns, quiet periods, stalls, and disconnection - a disconnected card still names the agent that left.
It never carries across agents.
An agent that connects without declaring anything is shown with no identity rather than under the previous agent's name, and a picked-up request is named only by what was declared for that request, so an agent merely waiting for work cannot relabel another agent's turn.

The reconnect prompt the review hands the reviewer asks the agent to export
these itself before connecting, because the agent is the only party that knows
any of them; Big Plan never infers one. They cost the connection nothing: they
are read once per process and ride the heartbeat and claim writes that already
happen.

## Diff and anchor truth

**What changed** compares the request's claim-time baseline snapshot with the
validated result snapshot. Each changed answer carries its own attributed
places; plan-wide chat carries a grouped digest.
Every change digest names the model and client declared for that request with
the same identity presentation as **Agent Status**; undeclared fields remain
absent. This applies equally to reviewer-started work and pushed threads.
The in-place lens shows word-level edits for close rewrites and stacked **Was**/**Now** bands for larger rewrites, additions, removals, tables, and code.
Component changes that use the component diff contract render the component's compiled presentation on both **Was** and **Now** sides.
The change replaces the component in the plan instead of sitting beside a hidden copy.
When a **Now** side exists, it is the live, commentable component.
It keeps its comment entry and any controls, including maximize.
The **Was** side is inert evidence and carries no live plan identity, apart from the controls that reach evidence only it holds: a wireframe's screen switcher stays navigable there, so a screen marked as removed or moved can be opened on the side that still has it.
The controls drawn inside a **Was** screen look exactly as the plan draws them and do nothing, so the screen it shows stays the one the reader chose from its switcher.
That switcher moves the **Was** side alone, so the two sides can show different screens - which is how a screen the change removed stays reachable on the side that still has it.
Until the reviewer accepts an answerable **Now** Decision, a banner at the top of its card asks them to accept the change before answering.
Its disabled **Confirm choice** control shows the same guidance in a hazard-icon tooltip.
Diagram, file tree, and wireframe changes use the component's own maximize control and name.
Their controls work inside the change: diagram theme and flow controls, tree copy controls, and wireframe screen switchers.
A wireframe change compares the two prototypes one at a time behind the **Was**/**Now** toggle.
For a changed wireframe, its own screen switcher marks screens that were added, removed, moved, or updated; wholly added or removed wireframes keep plain entries.
A removed component or a change superseded by a later revision appears as inert evidence rather than as something to answer.
A removed wireframe keeps its own screen switcher, so the screens the change took away stay readable.
An added or replaced picture shows the picture itself in its band, because a
picture carries no words for a text comparison to show.
Changes inside `QuickSummary`, `HttpEndpoint`, `GraphqlOperation`, `GrpcMethod`,
and `DatabaseTableSchema` are compared field by field.
The change navigator tours several places without losing reading context.

Choose **Accept change** to mark the current place accepted and advance to the next unaccepted place, or **Accept all** to accept the remaining set.
Acceptance is a review checklist rather than an edit: it does not change the plan or resolve the comment thread.
It is recorded with the review, so it survives a reload and a runtime restart, and every place it is counted - the change digest on the agent's message and the navigator touring that same set - reports the same number.
Acceptance is recorded against the two snapshots the change set compares, so a later revision arrives as its own set to review rather than inheriting what you already accepted.
A page that cannot record review state, such as a read-only review session or a standalone rendered document, disables its accept controls and says why.
If Big Plan cannot reach the runtime while reading recorded acceptances, it warns that the page may show an incomplete count and keeps retrying.
If recording an acceptance fails, Big Plan says it is not saved yet and keeps retrying; keep the review open until the change set reports itself accepted.
If the runtime refuses the acceptance outright, the mark comes back off and the review says so, so the page never claims work that nothing recorded.
After accepting the set, choose **Keep chatting**; a comment thread also offers **Resolve thread**.
Resolving never cancels a message the thread is still waiting on: while the agent owes that thread an answer, the review runtime refuses the resolve and says so, so cancel the waiting message or wait for its answer first.
A resolved thread will not accept a reply or new feedback until you unresolve it: a reply you have already typed is kept, and unresolving the thread clears the message so you can send it.
**Revert response** restores only that response's claim-time baseline, leaves earlier changes in place, and becomes unavailable after the plan changes again.

Comments retain their premise snapshot. If the plan changes before a comment
is sent, a **Plan changed since this comment** badge opens the premise-to-current
diff. Answer diffs remain historical and reviewable after later revisions.

Targets use exact structural paths. After reload, a target with the same path
remains anchored. If that path disappeared, the thread reports **Original
target unavailable** and keeps its recorded address; Big Plan does not use
fuzzy matching or silently attach it to nearby prose.

## Trust boundaries

Loopback is not an authentication boundary.
The runtime binds only `127.0.0.1` on an ephemeral port and exposes a fixed route-and-method allow-list.
It checks the `Host` header on every request and refuses any value outside a short allow-list: its own address and the review-link service's, so the service hop can reach it while a rebound name still cannot.

The service that answers saved links is a separate process on its own fixed loopback port, holding no review content. It forwards requests to this runtime by default, while `BIG_PLAN_PROXY=0` restores the redirect, without rewriting the browser's `Host`, `Origin`, or `Sec-Fetch-Site` headers. Either way every check below still happens here.
[The CLI reference](/reference/cli/#big-plan-service) owns what that process stores and how to stop it.

Three types of read-only GET request do not use the per-session token, `Origin`, or `Sec-Fetch-Site` checks:

- the document route `/`, which renders the selected MDX instead of serving arbitrary HTML;
- plan-picture requests, which accept only supported picture file types; and
- stored review-image requests at `/review-images/<digest>`, which use a validated content digest.

For a plan-picture request, both the requested path and its real path must stay in the plan's own directory.
Neither path can contain a dot-prefixed segment.
The opened target must be a regular file and must stay inside the image size limit.
The file-identity check is best effort.
An attacker who can already write in the reviewer's plan directory can replace an ancestor directory between path validation and file open.
The attacker can then make the plan-picture route open a file outside the plan directory.
The runtime accepts this limit because the attacker already has access to the reviewer's local files, and the server listens only on loopback.
For a stored review-image request, the metadata and picture must be regular files and must stay inside their explicit size limits.

All API routes require the per-session token in a request header.
They refuse a foreign `Origin` or a cross-site request.
The runtime also validates every agent response against its pending request and the computed snapshot diff.
It keeps requests, responses, heartbeats, and source snapshots in the owner-only ignored review store.

Reviewer and plan text remain plain, untrusted data in the browser and in the
agent brief. Sending a package grants only authority to consider the notes
while revising the named plan source.
