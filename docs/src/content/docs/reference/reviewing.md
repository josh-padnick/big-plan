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

## Commenting workflow

1. Use a slide's comment icon, a component toolbar comment icon, or select text
   and choose **Comment**.
2. Write a Markdown comment and choose **Submit Now**. Turn off **Submit right
   away** to stage it with **Add Comment** instead. `Cmd/Ctrl+Enter` performs
   the visible primary action; `Escape` cancels.
3. Open **Feedback** to inspect staged comments in the **Comments** tab. The
   **Chat** tab asks questions about the plan as a whole, while **Agent** shows
   the connection and current work for a live review session.
4. Edit or delete an individual staged comment, or choose **Send all comments
   to agent** to write one feedback package.

The kernel is a typed React interaction island built from token-themed
shadcn/ui primitives. The plan content stays server-rendered HTML: React adds
controls beside that content and never renders, replaces, or gates it.

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
explains the standard or template the request would cross, and lets the
reviewer explicitly choose **Do it anyway**. An accepted result updates the plan in place without
discarding drafts, open threads, or scroll position.

## Diff and anchor truth

**What changed** compares the request's claim-time baseline snapshot with the
validated result snapshot. Each changed answer carries its own attributed
places; plan-wide chat carries a grouped digest. The in-place lens shows
word-level edits for close rewrites and stacked **Was**/**Now** bands for
larger rewrites, additions, removals, tables, and code. Decision, diagram, and
file-tree changes retain their compiled component presentation behind a
**Was**/**Now** switch instead of flattening their structure into prose. The
change navigator tours several places without losing reading context.

Comments retain their premise snapshot. If the plan changes before a comment
is sent, a **Plan changed since this comment** badge opens the premise-to-current
diff. Answer diffs remain historical and reviewable after later revisions.

Targets use exact structural paths. After reload, a target with the same path
remains anchored. If that path disappeared, the thread reports **Original
target unavailable** and keeps its recorded address; Big Plan does not use
fuzzy matching or silently attach it to nearby prose.

## Trust boundaries

Loopback is not an authentication boundary. The runtime therefore:

- binds only `127.0.0.1` on an ephemeral port;
- requires a per-session token in a request header;
- refuses an unexpected `Host`, foreign `Origin`, or cross-site request;
- exposes a fixed route-and-method allow-list;
- renders the selected MDX itself instead of serving arbitrary HTML;
- validates every agent response against its pending request and the computed
  snapshot diff; and
- keeps requests, responses, heartbeats, and source snapshots in the
  owner-only ignored review store.

Reviewer and plan text remain plain, untrusted data in the browser and in the
agent brief. Sending a package grants only authority to consider the notes
while revising the named plan source.
