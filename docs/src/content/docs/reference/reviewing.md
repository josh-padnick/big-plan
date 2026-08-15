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
By default, an idle review ends normally after 10 minutes without reviewer
activity. Set a different duration with `--idle-timeout <minutes>`, or pass
`--idle-timeout 0` to keep the review open until it is stopped explicitly. A
waiting agent receives that normal inactivity reason instead of a failed
background command.

## Diagnose an unresponsive session

Keep the terminal running the review open when the page stops answering.
The runtime reports a write that has run for at least 30 seconds once, naming its route and age without timing it out.
It also reports progress-history and agent-exchange counts as append-only state crosses each 1,000-entry milestone.
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
   **Chat** tab asks questions about the plan as a whole, while **Agent** shows
   the coding-agent connection and current work for a live review session.
   A review-session outage is reported separately and does not label the agent
   as offline.
4. Edit or delete an individual staged comment, or choose **Send all comments
   to agent** to write one feedback package.

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

## Persistence

Runtime-backed drafts live under `.big-plan/review/<plan-id>/` beside the plan.
The review id comes from the resolved source path, so it survives the plan
revision the agent creates in response to feedback. Static `big-plan render`
documents use browser storage as a draft-only fallback.

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
edits only the authoritative MDX when appropriate, validates the new render,
and publishes one outcome for every comment.

Until a response exists, a sent thread says **With agent**. A real response
records an `answered`, `changed`, `warning`, `needs-input`, or `declined`
outcome and shows the agent's message. A warning leaves the plan unchanged,
shows its short one-line summary directly under the **Warning** badge,
explains the standard or template the request would cross, and lets the
reviewer explicitly choose **Do it anyway**. A changed result updates the plan
in place without discarding drafts, open threads, or scroll position.

Set `BIG_PLAN_AGENT_MODEL` before starting the coding-agent session to name
which model is connected, for example `Grok 4.6` or `GPT-5.6-Luna`. The
**Agent** tab shows that name and an icon next to the connection status.
A name containing `openai`, a `gpt-4` or `gpt-5` family name, `claude`, or
`grok` uses that vendor's own logo; any other reported name uses a generic
model icon instead of guessing a vendor. This keeps a different GPT-named
model, such as EleutherAI's GPT-J, from showing the OpenAI logo.
Leave `BIG_PLAN_AGENT_MODEL` unset and the tab still shows the agent as
connected, with no name guessed on its behalf.

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
Acceptance is a browser-local review checklist: it does not edit the plan or resolve the comment thread.
After accepting the set, choose **Keep chatting**; a comment thread also offers **Resolve thread**.
Resolving never cancels a message the thread is still waiting on: while the agent owes that thread an answer, the review runtime refuses the resolve and says so, so cancel the waiting message or wait for its answer first.
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
