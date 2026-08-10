---
title: Reviewing a plan
description: Stage block notes, connect a coding agent, and review truthful source revisions through the local runtime.
---

`big-plan review` serves one plan on your machine so you can attach notes to its
rendered blocks and hand the staged set to the agent.

```sh
npx big-plan review plans/checkout-retry.mdx
```

The command prints a `http://127.0.0.1:<port>/` address and keeps running.
Open that address, review the plan, and stop the runtime with `Ctrl+C`.

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
changes it to **Changed**, **Needs your answer**, or **Outside this plan** and
shows the agent's message. When the accepted source revision changes, reload
the plan from the notice in the thread kernel.

## Revision and anchor truth

**What changed** compares the stored source revision from the request with the
validated revision in the response. It shows additions, removals, and
word-level rewrites for authored blocks.

Targets use exact structural paths. After reload, a target with the same path
remains anchored. If that path disappeared, the thread is shown as orphaned
and keeps its original recorded target; Big Plan does not use fuzzy matching
or silently attach it to nearby prose.

## Trust boundaries

Loopback is not an authentication boundary. The runtime therefore:

- binds only `127.0.0.1` on an ephemeral port;
- requires a per-session token in a request header;
- refuses an unexpected `Host`, foreign `Origin`, or cross-site request;
- exposes a fixed route-and-method allow-list; and
- renders the selected MDX itself instead of serving arbitrary HTML;
- validates every agent response against its pending request and the computed
  source revision; and
- keeps requests, responses, heartbeats, and revision snapshots in the
  owner-only ignored review store.

Reviewer and plan text remain plain, untrusted data in the browser and in the
agent brief. Sending a package grants only authority to consider the notes
while revising the named plan source.
