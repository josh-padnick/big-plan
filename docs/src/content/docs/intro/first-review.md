---
title: Your first review
description: Take one plan from download to an approved plan in about five minutes, without leaving this page.
---

**Goal.** One plan served locally, commented on, its questions answered, and approved — the
whole loop, once, so the rest of the documentation makes sense.

## Before you start

- Node.js 22 or newer. Check with `node --version`.
- About five minutes. Nothing you do here touches a server or needs an account.

## 1. Get a plan

Download the example plan, or use any plan your agent has written:

```sh
curl -o plan.mdx https://bigplan.dev/demo/example-plan.md
```

It should start with a `#` heading. If it starts with `<`, the download followed a redirect;
try again.

## 2. Read the guidance

```sh
npx -y big-plan@latest guidance
```

This prints the plan-writing principles. It also unlocks `validate`, `render`, and `review` for
this directory for 24 hours — they fail with `GUIDANCE_REQUIRED` until it has been run. You
only have to skim it now; it is written for whoever writes the plan.

## 3. Check the plan

```sh
npx -y big-plan@latest validate plan.mdx
```

```text
validated: /Users/you/plan.mdx
title: Ship the checkout retry queue
sections: 11
components: 18
```

It writes nothing. If it reports diagnostics, each one is `line:column message`, and lint
entries add `[rule-id]`.

## 4. Start the review

```sh
npx -y big-plan@latest review plan.mdx
```

```text
review: "http://127.0.0.1:8790/plan/61ba8e0b1849b290"
direct: "http://127.0.0.1:58348/"
custody: activated
```

Open the `review:` address. That is the one worth saving — it is derived from the plan's path,
so it is the same for every review of this plan and keeps answering through restarts. The
`direct:` line is for debugging.

Leave the command running.

## 5. Leave a comment

Select a sentence in the plan and choose **Comment**, or use a slide's comment icon.

Write anything — "why this order?" — and choose **Submit Now**.

Open **Feedback** in the branding bar to see it. Because no coding agent is connected yet, the
thread reads **Blocked - no agent connected** and will send itself when one arrives. That is
the expected behaviour, and it is worth seeing once.

## 6. Answer a decision

Scroll to a decision card. Choose an option and confirm.

The caption tells you the answer is saved with this review — it survives a reload and a runtime
restart. Open **Feedback** and switch to **Inputs**: that decision now reads answered, and
anything you have not settled reads not answered.

## 7. Approve

Choose **Approve plan** in the branding bar.

The dialog reports what is accepted and what is still open, the decisions you answered and the
ones you did not, and the covering note that will go to the agent. Confirm it.

Approval writes your answers into `plan.mdx` itself: the decision gains `state="decided"` and
the option you chose gains `chosen`. Nothing else in the file changes. Open the file and look —
that is the whole point of the workflow.

## Verify

- `plan.mdx` now contains at least one `state="decided"` and one `chosen`.
- The page shows the plan stamped approved.
- A `.big-plan/` directory sits beside the plan, holding the review state and the approval brief.

## If it goes wrong

| What you see                     | What to do                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GUIDANCE_REQUIRED`              | Run `guidance` from the same directory                                                                         |
| `custody: held`                  | A review is already serving this plan; open the address it printed                                             |
| The page stops accepting changes | Stop the runtime with `Ctrl+C` and start it again; see [When a review goes wrong](/reference/commands/review/) |
| **Approve plan** is missing      | You opened a rendered `.html` file rather than the review address                                              |

## Clean up

Stop the runtime with `Ctrl+C`. Delete `plan.mdx`, `plan.html`, and `.big-plan/` if you do not
want them.

## Next

[A tour of the review document](/intro/ui-review/) — what every control you just used actually does.
