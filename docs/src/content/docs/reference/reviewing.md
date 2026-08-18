---
title: Reviewing a plan
description: Stage block notes, connect a coding agent, and review causal diffs through the local runtime.
---

`big-plan review` serves one plan on your machine so you can attach notes to its
rendered blocks and hand the staged set to the agent.

```sh
npx big-plan review plans/checkout-retry.mdx
```

The command prints a `http://127.0.0.1:<port>/` address and keeps running.
Open that address, review the plan, and stop the runtime with `Ctrl+C`.
By default, a review ends normally after 30 minutes with no page open and no
agent working. An open review page counts as activity on its own, so a session
never ends while you are still reading it. Set a different duration with
`--idle-timeout <minutes>`; a nonzero timeout must be at least 1 minute.
Pass `--idle-timeout 0` to keep the review open until it is stopped explicitly.
A waiting agent receives that normal inactivity reason instead of a failed background command.
When an already-open page loses contact with its review runtime, it reports that loss rather than claiming the server stopped, because a request that merely timed out can happen while the runtime is still running.
If the deadline the page last knew has also passed, it reports that observation too.
When the page has no unsaved browser-only input, Refresh is offered in either case so you can check whether the review is still running.
If it does have unsaved input, Refresh stays disabled and the page asks you to keep the tab open instead.
It does not say why contact was lost, because a page that has lost contact cannot tell an idle expiry from a runtime someone stopped, or from one that is still serving another tab.
For the same reason it never tells you to start a new review runtime; the command is the only place that decides whether starting or taking over a runtime is allowed, and it answers that question for you.
When a newer review session for that plan was recorded before contact was lost, the page also links to it as **Open latest review**.
Opening an old address after its runtime has already ended still reaches the browser's connection-error page; giving shared links an explicit lifetime remains a separate product decision.

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
npx big-plan review plans/checkout-retry.mdx --takeover
```

The replaced runtime keeps listening but loses write custody.
Its open page and its connected agent become read-only until each moves to the new address, so prefer opening the printed address over taking custody.
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
3. Open **Feedback** to inspect staged comments in the **Comments** tab. The
   **Chat** tab asks questions about the plan as a whole, **Inputs** lists what
   the review is still waiting for, and **Agent** shows
   the coding-agent connection and current work for a live review session.
   A review-session outage is reported separately and does not label the agent
   as offline.
4. Edit or delete an individual staged comment, or choose **Send all comments
   to agent** to write one feedback package.

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
Paste an image into a composer, drop a file onto it, or choose **Choose image**.
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
The answer stays inside the review session; Big Plan does not yet deliver it to your agent, so tell the agent your decision through the feedback flow when you want it acted on.
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
By default they are the decision: **Confirm choice** records them as the answer, and they then stand as a **New option** until **Change** reopens the field with the text kept.
Flip it to **Submit as comment** when the agent should act on the words instead: that side uses the review's own comment controls, so **Submit right away** decides whether the comment is sent immediately or staged with the rest of your feedback, and it reaches the agent as **Decision options feedback** with its thread beside the composer.
**Cancel** leaves the composer from either side, and the comment side needs a live review; a standalone document says so instead of submitting.

A read-only review page - one whose plan a newer review session took custody of - cannot record answers: every answering control is disabled, with a note beside it saying why.
A confirm made before the page has learned whether it may write is held rather than guessed at: it is saved once the session proves writable, and kept as a reading-session note when the session proves read-only.
Words recorded as the decision are a reading-session note either way, never a saved answer; submit them as a comment when the agent should act on them.
In a standalone rendered document, an answer lasts only for the reading session and is not saved with a review.

## What the review is waiting for

A live review's **Inputs** tab lists everything the review expects from you before the plan can be approved: every open decision the plan asks, and every change set an agent published.
Each row says where that input stands - answered, not answered, or stale - and a decision the plan's author marked `critical` says so beside its state.
A decision row scrolls the plan to its card.

The list is the runtime's answer rather than the page's, so two browsers reading the same review read the same list, and a reload cannot invent a different one.
**Stale** is its own state rather than a kind of unanswered: you answered, and the plan moved underneath the answer.
A decision goes stale under exactly the edits that mask its answer on the card, and restoring the wording it answered makes it answered again.
A change set goes stale when a later revision reopened changes you had already accepted, because an acceptance names the revision it closed and never migrates onto content you did not see.

A standalone rendered document has no Inputs tab: the contract is derived by the review runtime, and a document opened without one has nothing to derive it from.

## Persistence

Runtime-backed staged comments, recorded decision answers, and recorded change acceptances live under `.big-plan/review/<plan-id>/` beside the plan.
The review id comes from the resolved source path, so staged comments survive the plan revision the agent creates in response to feedback.
Comment text that is typed but not yet staged or sent is kept in a recovery record owned by its browser tab, so reloading or reopening after a crash gives back the tab's staged drafts, open comment composer, and half-written thread replies.
Each tab keeps exactly one record, written and cleared only by the tab that owns it, and read once when the page loads.
The one exception is a record this build can no longer read: any tab claiming its writer identity removes such dead records so they cannot fill browser storage, while readable records from other tabs are never removed.
A reload merges that record against the runtime's authoritative state automatically, or asks which version to keep when both sides changed the same comment.
Tabs never read or adopt each other's records; two tabs converge through the runtime instead of through browser storage.
A composer whose place in the plan no longer exists is not reattached, and the review retains its text for copying until the reviewer discards it.
Text currently being typed in the plan-wide **Chat** composer exists only in the current page and does not survive a reload.
Static `big-plan render` documents use browser storage for their document-level comment draft.

Every write of the reviewer's own state is conditional on the state the page last read, so a second tab or the runtime itself cannot have its work replaced without notice.
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
npx big-plan agent plans/checkout-retry.mdx
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
A sent thread reports that wait in two places until an agent picks its request up: the comment sidebar groups it under the **Queued** heading and numbers its card by position within that group, while the status block inside the thread reads **Waiting for an agent**.
That in-thread block adds the line **Queued, _N_ ahead** above the headline when earlier unanswered work exists, then reaches the agent when every earlier request is answered or canceled.
Canceling the active request releases the plan immediately, so the next queued request advances without waiting for the canceled claim's lease to lapse.
Once an agent picks the request up the thread says **Working**, and it stays picked up from then on.
A turn can run longer than the agent reports progress for, because `big-plan agent next` hands the work over and its own process exits, so nothing is running on that agent's behalf between two progress notes.
After 75 seconds of that quiet the thread reads **No progress for *N*m** and the **Agent** tab reads **Agent may be stalled**, naming how long the agent has been silent and suggesting you check its terminal.
That is a report about the silence and not about the connection: the work is still picked up, the answer is still accepted when it arrives, and a message you send meanwhile is queued behind that turn rather than reported as blocked.
Big Plan cannot tell a slow agent from a stopped one, because neither produces a signal, so the stalled reading covers both and resolves itself as soon as the agent speaks again.

When the coding agent that started the session exits, its waiting connection ends with it rather than outliving it: within a few seconds the **Agent** tab reads **Agent session ended**, the status card names when the session ended instead of guessing at a threshold, and the connection log records a **Session ended** row.
A session that disappears without the connection noticing - a machine losing power, or something killing the whole process tree at once - still reads as disconnected after the same 75 seconds of silence as before.
Either way a message you send once the agent is gone reads **Blocked - no agent connected** and sends itself when an agent reconnects, rather than being picked up by a session that can no longer answer.

The **Agent** tab offers **Reconnect your agent**, holding the prompt and the connector command that start a coding-agent session.
An agent going quiet never hides that section, because it is the only place those two live and losing your route back is the last thing a silence should cost you; only a read-only session or a review runtime you cannot reach hides it.
While a request is picked up that section instead reads **Connect an agent and take over this work** and says plainly that the agent may still be working and may finish on its own, and that connecting a session takes the work over so its answer will no longer be accepted - because [the agent request protocol ADR](https://github.com/josh-padnick/big-plan/blob/main/adr/0002-serialize-agent-work-per-plan.md) serializes pickup and only the current holder may answer.
The taken-over agent's unfinished edits stay in its own copy and never reach your plan, so the new agent starts from the last published revision.
Your comments are safe whichever you choose.

The stalled reading is bounded, because a pickup cannot account for silence indefinitely.
After 30 minutes without a single report Big Plan stops treating the pickup as an explanation: the **Agent** tab gives way to the ordinary connection reading, the thread reads **No longer reporting**, drops its promise to resolve itself, leaves the **Working** group and offers **Show setup instructions →**, a message you send now reads **Blocked - no agent connected**, and the recovery section returns to its plain wording.
Past that point, and only while no agent is connected, the pickup also stops holding your comment: the claim is treated as abandoned, and **Delete comment the agent left?** returns with a confirmation that says the agent stopped reporting and its claim expired.
Both halves of that proof are required, because a quiet lease alone is what an ordinary turn looks like: a connected agent, or a silence still inside the 30 minutes, keeps the comment held exactly as before.
Deleting or editing what an abandoned claim was holding releases the claim, so an agent that comes back afterwards is refused rather than allowed to answer a message you have already changed.
A real response records an `answered`, `changed`, `warning`, `needs-input`, or `declined` outcome and shows the agent's message.
A warning leaves the plan unchanged, shows its short one-line summary directly under the **Warning** badge, explains the standard or template the request would cross, and lets the reviewer explicitly choose **Do it anyway**.
A changed result updates the plan in place without discarding staged comments, open threads, or scroll position.
The [agent request protocol ADR](https://github.com/josh-padnick/big-plan/blob/main/adr/0002-serialize-agent-work-per-plan.md) owns why pickup is serialized and what must change before concurrent plan editing can return.

Set `BIG_PLAN_AGENT_MODEL` before starting the coding-agent session to report
the model identity for each pickup, for example `Grok 4.6` or
`GPT-5.6-Luna`.
The **Agent** tab shows the model name and icon of the request it is describing,
for as long as that pickup still explains the quiet - through the working
reading and the whole stalled window, not only while the claim is live.
With nothing picked up, or once a pickup has gone quiet past 30 minutes, the tab
shows connection status and no model badge.
A name containing `openai`, a `gpt-4` or `gpt-5` family name, `claude`, or
`grok` uses that vendor's own logo; any other reported name uses a generic
model icon instead of guessing a vendor. This keeps a different GPT-named
model, such as EleutherAI's GPT-J, from showing the OpenAI logo.
Leave `BIG_PLAN_AGENT_MODEL` unset and an active claim still appears with no
name guessed on its behalf.

## Diff and anchor truth

**What changed** compares the request's claim-time baseline snapshot with the
validated result snapshot. Each changed answer carries its own attributed
places; plan-wide chat carries a grouped digest. The in-place lens shows
word-level edits for close rewrites and stacked **Was**/**Now** bands for
larger rewrites, additions, removals, tables, and code. Decision, diagram, and
file-tree changes retain their compiled component presentation behind a
**Was**/**Now** switch instead of flattening their structure into prose.
When either revision contains multiple screens, wireframe changes add a per-screen selector for **Added**, **Removed**, **Updated**, **Moved**, and **Initial screen** changes.
They keep the full device frame visible behind interactive **Was**/**Now** controls and carry the shared maximize control into the diff lens.
An added or replaced picture shows the picture itself in its band, because a
picture carries no words for a text comparison to show.
Changes inside `QuickSummary`, `HttpEndpoint`, `GraphqlOperation`, `GrpcMethod`,
and `DatabaseTableSchema` are compared field by field.
The change navigator tours several places without losing reading context.

Choose **Accept change** to mark the current place accepted and advance to the next unaccepted place, or **Accept all** to accept the remaining set.
Acceptance is a review checklist rather than an edit: it does not change the plan or resolve the comment thread.
It is recorded with the review, so it survives a reload and a runtime restart, and every place it is counted - the change digest on the agent's message and the navigator touring that same set - reports the same number.
Acceptance is recorded against the two snapshots the change set compares, so a later revision arrives as its own set to review rather than inheriting what you already accepted.
A read-only review session records nothing, so its accept controls say why instead of offering a checklist nothing reads back.
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
It checks the `Host` header on every request and refuses a value that is not its own address.

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
