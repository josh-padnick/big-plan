---
title: Reviewing a plan
description: Stage block notes in the thin thread kernel and hand them to the agent through a local review runtime.
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
   **Chat** and **Agent** tabs identify the later stack capabilities they will
   own without pretending those loops are connected yet.
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

## Trust boundaries

Loopback is not an authentication boundary. The runtime therefore:

- binds only `127.0.0.1` on an ephemeral port;
- requires a per-session token in a request header;
- refuses an unexpected `Host`, foreign `Origin`, or cross-site request;
- exposes a fixed route-and-method allow-list; and
- renders the selected MDX itself instead of serving arbitrary HTML.

Reviewer and plan text remain plain, untrusted data in the browser and in the
agent brief. Sending a package grants only authority to consider the notes
while revising the named plan source.
