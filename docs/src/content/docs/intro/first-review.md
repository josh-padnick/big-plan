---
title: Your first review
description: Take one plan from your agent's first draft to an approved plan in about five minutes, by asking rather than typing.
---

**Goal.** One plan served locally, commented on, its questions answered, and approved — the
whole loop, once, so the rest of the documentation makes sense.

You will not type any of this yourself. You ask your coding agent, in plain language, and it runs
the commands. The commands below are shown so you can recognise what your agent is doing, not so
you can copy them.

## Before you start

- **A coding agent** that can run commands in a directory — the one you already work with.
- **Node.js 22 or newer**, which your agent will check for you.
- About five minutes. Nothing here touches a server or needs an account.

If your agent has never used Big Plan, see [Install Big Plan](/intro/installation/) first: one
sentence to your agent sets it up.

## 1. Ask for a review

**You say:**

```text
Use Big Plan to put this plan up for review.
```

Use a plan your agent has already written, or ask it for the example plan:
_"Grab the Big Plan example plan and put that up for review instead."_

**Your agent runs** three commands, in this order:

```sh
# 1. Read the plan-writing principles. This also unlocks the next two
#    commands in this directory for 24 hours.
npx -y big-plan@latest guidance

# 2. Check the plan compiles, and report anything wrong with it.
npx -y big-plan@latest validate plan.mdx

# 3. Serve the plan for review, and keep serving it.
npx -y big-plan@latest review plan.mdx
```

The first is a gate, not a formality: `validate`, `render`, and `review` fail with
`GUIDANCE_REQUIRED` until it has been run. It is written for whoever writes the plan, so it is
your agent's reading, not yours.

**You see** your agent report that the plan checks out, and hand you an address:

```text
validated: /Users/you/plan.mdx
title: Ship the checkout retry queue
sections: 11
components: 18

review: "http://127.0.0.1:8790/plan/61ba8e0b1849b290"
```

That `review:` address is the one worth saving. It is derived from the plan's path, so it is the
same for every review of this plan and keeps answering through restarts.

If your agent reports diagnostics instead, ask it to fix them: _"Fix those and try again."_ Each
one is `line:column message`, and lint entries add `[rule-id]` — all of it addressed to the agent.

## 2. Open the review

Open the address in your browser. Your agent leaves the review running while you read.

From here on, everything is yours to do. Big Plan is a reading and reviewing surface, and no part
of the rest of this page involves a command.

## 3. Leave a comment

Select a sentence in the plan and choose **Comment**, or use a slide's comment icon.

Write anything — "why this order?" — and choose **Submit Now**.

Open **Feedback** in the branding bar to see it. If your agent is not connected to the review yet,
the thread reads **Blocked - no agent connected** and sends itself the moment one arrives. That is
the expected behaviour, and it is worth seeing once.

## 4. Answer a decision

Scroll to a decision card. Choose an option and confirm.

The caption tells you the answer is saved with this review — it survives a reload and a runtime
restart. Open **Feedback** and switch to **Inputs**: that decision now reads answered, and
anything you have not settled reads not answered.

## 5. Approve

Choose **Approve plan** in the branding bar.

The dialog reports what is accepted and what is still open, the decisions you answered and the
ones you did not, and the covering note that will go to your agent. Confirm it.

Approval writes your answers into the plan file itself: the decision gains `state="decided"` and
the option you chose gains `chosen`. Nothing else in the file changes. Ask your agent to show you
the file afterwards — that is the whole point of the workflow.

## Verify

Ask your agent: _"Show me what approving changed."_ You should hear back that:

- The plan file now contains at least one `state="decided"` and one `chosen`.
- A `.big-plan/` directory sits beside the plan, holding the review state and the approval brief.

And on your own screen, the page shows the plan stamped approved.

## If it goes wrong

The left column is mostly what your _agent_ runs into, which reaches you as a sentence from it
rather than as an error on your screen. Either way, the right column is what to say back.

| What you see                            | What to say                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Your agent mentions `GUIDANCE_REQUIRED` | _"Run Big Plan's guidance command in that directory first."_                                              |
| Your agent mentions `custody: held`     | _"A review is already serving that plan — give me the address it printed."_                               |
| The page stops accepting changes        | _"Restart the Big Plan review."_ See [When a review goes wrong](/reference/commands/review/)              |
| **Approve plan** is missing             | You are looking at a rendered `.html` file, not the review address. _"Give me the review address again."_ |

## Clean up

_"Stop the Big Plan review and clean up the files it made."_

That stops the runtime and removes the plan copy, any rendered `.html`, and `.big-plan/` — keep
whichever of them you want.

## Next

[A tour of the review document](/intro/ui-review/) — what every control you just used actually does.
