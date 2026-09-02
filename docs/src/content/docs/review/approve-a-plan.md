---
title: Approve a plan
description: Turn agreement into a record the agent can verify before it starts work.
---

**Goal.** A durable approval recorded beside the plan, your decision answers written into the
plan source, and the agent told to begin.

## Before you start

- A live review session that still has authority to write this plan. A replaced, read-only
  session keeps showing an approval already in force but offers no approval actions, and a
  standalone rendered document shows no control at all.
- Ideally every change set accepted and every question answered — approval reports what is
  still open and lets you inspect each item before confirming.
- The covering note you want to send, from **Settings**; see
  [Change how the viewer looks](/review/viewer-settings/).

## Steps

**Approve plan** appears in the branding bar only for a live review session that still has authority to write this plan.
Its confirmation dialog reports accepted and open change sets, answered and unanswered decisions, in-flight agent work, and the covering message from **Settings**.
Choose a listed item to inspect it before approving, or choose **Edit in Settings** to close the confirmation and open the **Approval message** page.

Confirming approval writes every saved decision answer into the plan source itself: the decision gains `state="decided"` and the option you chose gains `chosen`, and nothing else in the file changes.
Those decisions then read as the record of what was chosen and stop asking, and the page rereads the new revision in place without a reload.
An unanswered decision is left exactly as it was; approval never picks an answer for you.
Approval then accepts every still-open change set, cancels every in-flight agent request, and records that written revision's snapshot, the saved decision answers, the unanswered decisions, and the covering message.
The snapshot it pins is the revision approval just wrote, so the plan is not reported as changed by Big Plan's own write.
It then writes one `approval` mailbox request whose `requestId` is the new approval id, carrying the absolute `planPath`, the pinned snapshot digest, the recorded answers, the unanswered decisions, and the covering message.
It also writes a human-readable approval brief beside the review's feedback briefs, containing those same facts and the canonical-source check.
If brief publication fails, approval reports the failure and retains its finalization record so a runtime restart can retry the brief and mailbox delivery.
If that mailbox write fails, the approval remains recorded, the confirmation reports that it was not delivered, and the approval details keep showing the delivery failure.
The agent is expected to re-read that exact path, verify its digest equals `pinnedSnapshot`, and acknowledge without editing the plan.
A missing path, a missing file, or a digest mismatch is a hard stop: the agent reports it through the response as a `hardStop` and must not search for another copy.
A reported hard stop is not an acknowledgment: the review records it as a failed step, and the Chat thread names it.
An acknowledgment whose result digest does not match the pinned snapshot is refused.
Revoking an approval that the agent has not yet answered cancels that still-open request.

Every critical decision must be answered first; non-critical decisions may remain unanswered and are recorded that way.
A decision already written into the source as decided is no longer being asked, so re-approving a later revision leaves it alone and writes only the answers you have given since.
There is no un-stamping: ask the agent to reopen a decision you want to revisit.
The approval is refused if the plan changes while the confirmation is open, so the record never silently covers a different revision.

After approval, the branding-bar control reads **Plan approved**, and a persistent approval stamp appears above the document title without moving the title or contents.
Open **Plan approved** to inspect the recorded message and any decisions left unanswered.
It also lists this plan's approval history, newest first: the time of each approval, the plan version it pinned, and a struck-through row with a **Revoked** marker for any approval that was revoked.
The plan-wide Chat thread shows **Plan approved**, followed by **Approval acknowledged** after a successful acknowledgment or a warning when the agent reports a hard stop.
When no agent is connected, the **Plan approved** entry instead says the approval was recorded but there was no agent to notify; the mailbox request remains waiting for the next agent.
Choose **Revoke approval** there to return the plan to review; revocation does not undo anything already recorded in the plan source.
If the plan source changes while an approval remains in force, the bar reports **Changed since approval** and offers **Re-approve** for the plan as it now reads.

A review session that has become read-only continues to show an approval already in force, but does not offer approval or revocation actions.
A standalone rendered document shows no approval control.
It does carry the approval stamp when `big-plan render` finds an approval in force beside the plan that pins the exact source being rendered; hovering the stamp shows when it was approved and which version it pinned.
An unapproved, revoked, or stale plan renders no stamp at all, so an export never claims an approval that does not cover it.

## Verify

- The branding bar shows the plan stamped approved, and offers **Re-approve** only if the plan
  changes afterwards.
- A human-readable approval brief exists beside the review's feedback briefs.
- Your answered decisions now read `state="decided"` in the plan file, with `chosen` on the
  option you picked.

## If it goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| The confirmation reports the approval was not delivered | The mailbox write failed | The approval is still recorded; the details keep showing the delivery failure, and a runtime restart retries |
| Approval reports a brief-publication failure | The Markdown brief could not be written | The finalization record is retained so a restart can retry both the brief and the mailbox delivery |
| A decision you expected to be recorded was left alone | It was unanswered at approval time | Approval never picks an answer for you; answer it and re-approve |
| **Approve plan** is missing | This session is read-only, or this is a standalone rendered document | Open the newest review for that plan |

## Next

[Export a plan as Markdown](/review/export-markdown/) — take the approved plan out as portable
text.
