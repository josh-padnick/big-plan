---
title: Handle an approval
description: Verify the digest the reviewer approved, acknowledge without editing, and begin execution.
---

**Goal.** Execution started against exactly the plan revision the human approved, with a hard
stop if it is not the one in front of you.

## Before you start

You are the primary agent on a live review, running the loop in
[Answer reviewer feedback](/for-agents/answer-feedback/).

## What arrives

When the reviewer confirms approval, Big Plan writes one `approval` mailbox request whose
`requestId` is the new approval id. It carries:

| Field                    | What it holds                                      |
| ------------------------ | -------------------------------------------------- |
| `planPath`               | The absolute path of the approved plan             |
| `pinnedSnapshot`         | The digest of the exact revision that was approved |
| The recorded answers     | Every decision the reviewer answered               |
| The unanswered decisions | Every decision they deliberately left open         |
| The covering message     | The note from the reviewer's **Settings**          |

Approval also writes those answers into the plan source itself: the decision gains
`state="decided"` and the option they chose gains `chosen`, and nothing else in the file
changes. The snapshot it pins is the revision approval just wrote, so the plan is not reported
as changed by Big Plan's own write.

## Steps

1. **Re-read `planPath`.** Read the file at that exact path. Do not use a copy you already have
   in context.

2. **Verify the digest equals `pinnedSnapshot`.** This is the whole point of the handshake: it
   proves the bytes you are about to build from are the bytes the human agreed to.

3. **Acknowledge without editing the plan.** An approval is not a request to revise. Publish no
   candidate in response to it.

4. **Begin execution in your own harness**, against the approved revision.

## Hard stop

A missing path, a missing file, or a digest mismatch is a hard stop. Report it through the
response by adding `hardStop` — one line naming what you found — and **do not search for
another copy**. A near-miss file is not the plan the human approved, and building from it is
the failure this check exists to prevent.

## Verify

- The digest you computed equals `pinnedSnapshot` exactly.
- The decisions you are building against read `state="decided"` in the file you just read.
- You made no edit to the plan in response to the approval.

## If it goes wrong

| What you find                              | What to do                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `planPath` is missing from the request     | Hard stop; report it with `hardStop`                                                                     |
| The file at `planPath` does not exist      | Hard stop; report it. Do not look for another copy                                                       |
| The digest does not equal `pinnedSnapshot` | Hard stop; report it. The plan moved after the approval was recorded                                     |
| A decision you needed is unanswered        | Approval never picks an answer. Ask through the ordinary feedback flow rather than choosing one yourself |
| The reviewer revoked the approval          | The plan is back in review and any still-unanswered approval request is cancelled. Stop executing        |

## Related

- [Approve a plan](/review/approve-a-plan/) — what the reviewer sees and what approval writes.
- [One writer owns the plan](/concepts/one-writer/) — why the digest check can be trusted.
