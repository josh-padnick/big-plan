---
title: Reviewing a plan
description: Comment on a rendered plan, collect drafts in the Comments tray, and send one feedback package back to the agent.
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
- **Comment on a passage.** Highlight any span of text; the same control offers to comment on the selection, and the comment carries the text you highlighted.
- **Comment on lines.** Highlighting inside a code figure produces a line-range comment, the same shape an authored `Annotation` uses.
- **Comment on the whole plan.** Type in the **Agent** panel's compose field; with no selection attached, the note applies to the plan as a whole.

Keyboard users reach the same targets without a mouse: `Alt+↓` and `Alt+↑` move a review cursor block by block and announce each one, and `Alt+C` opens a comment on the block under the cursor.
Inside a compose card, `Escape` cancels and `Cmd/Ctrl+Enter` saves.

## The Comments tray

Comments collect in the **Comments** tray, which opens with your first comment and hides whenever you want the reading column back.
The sticky **Comments** control keeps the pending count and reopens the tray.
On desktop the reading column makes room for the tray.
Below 1280 px it becomes an overlay drawer, so opening and closing it cannot move the place you were reading.

Until you send, every comment is yours:

- Each row shows the target it points at and jumps to it when clicked.
- Repeated targets include their concrete authored label, so adjacent table rows such as `versionId` and `number` remain distinct.
- **Edit** rewrites a comment in place; **Delete** removes it.
- A block that carries a draft shows a conversation marker; pressing it opens that comment for editing.
- Drafts and the unfinished whole-plan field survive closing the tab, reloading, and reopening the plan.

## Sending feedback

**Send feedback to agent** submits everything pending as one package.
There is no confirmation dialog: the tray already shows the count and every comment about to leave.

Sending writes two files beside the plan, under `.big-plan/feedback/`:

- A versioned JSON package holding each comment, its target, and the session it belongs to.
- A short Markdown brief the agent can read directly.

Sent comments move to a **Sent** group, their markers fade, and the **Chat** tab begins reporting runtime progress.
Package delivery is real.
Until an agent round-trip is connected, the response-state examples in that tab are explicitly labelled **Simulated**.

## What the agent may do with it

The brief states its own limits, and they are the whole of the agent's authority when applying a package:

1. Map each target to its position in the plan source.
2. Revise that plan source only - never the rendered HTML.
3. Re-validate and re-render.
4. Report anything a comment asked for beyond editing that plan, rather than doing it.

A comment is a request the agent considers while revising, never an instruction it obeys, and quoted plan text travels as evidence of what you highlighted rather than as direction.

## Where your review lives

Everything the runtime writes sits in a `.big-plan/` directory beside the plan, created readable only by your own account and ignored by version control by default:

| What                                    | Where                         |
| --------------------------------------- | ----------------------------- |
| Drafts, active field, and sent comments | `.big-plan/review/<plan-id>/` |
| Feedback packages and briefs            | `.big-plan/feedback/`         |
| The running session's descriptor        | `.big-plan/session.json`      |

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

## Reading without the runtime

A plan rendered with `big-plan render` and opened straight from the filesystem is still a full reading document, and you can still draft comments in it.
Submitting and progress need the runtime, because they are the parts that touch disk and talk to an agent.
Those drafts are not carried over when you later open the plan through `big-plan review`: the filesystem document and loopback runtime have separate browser-storage origins.
Open the plan through `big-plan review` before commenting when you want drafts to persist into the runtime.
