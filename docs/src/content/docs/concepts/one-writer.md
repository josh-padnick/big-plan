---
title: One writer owns the plan
description: Why an agent's edit and a reviewer's revert can never silently overwrite each other.
---

**The problem.** A live review has two parties that both want to change the plan: the coding
agent revising it in response to feedback, and the reviewer reverting a response they did not
want. If either could write the file directly, the loser of a race would lose work without
anything refusing it. The bytes would land, and nothing would say so until the reviewer noticed
work they never approved.

## The model

The plan file on disk is authoritative, and exactly one code path may write it.
An agent's edits go into a claim-scoped stage rather than the plan itself.
A stage publishes only under the plan-mutation lock, only while the recorded lock holder, the claim generation, and the source's base digest all still hold, and only through a single atomic rename, with a journal written beforehand so an interrupted publish can be settled after a crash.

A reviewer's revert crosses that same boundary and re-proves the digest it was computed against.
That is why a revision an agent published while you were deciding refuses the revert instead of disappearing under it: the revert is rejected rather than silently applied to content it never saw.

One local filesystem limit is accepted rather than fixed.
Node offers no file-open relative to an already-open directory handle, so someone who can already write inside your plan directory can swap an ancestor directory between the moment a path is validated and the moment it is opened.
Closing that race is not possible with the available primitives, and an attacker who can write in that directory already has the access the check would protect, so Big Plan documents the limit instead of pretending to remove it.

## What follows from it

- **An agent never writes your plan file.** It edits a claim-scoped candidate — its own copy —
  and Big Plan swaps that copy in only when a valid answer publishes. An agent that stalls, is
  taken over, or dies mid-edit leaves your plan exactly as it was.
- **A publish that finds the plan changed is refused, not applied.** `agent respond` returns
  `SOURCE_MOVED` and the agent takes the work again from the current plan.
- **A revert re-proves its digest.** A revision an agent published while you were deciding
  refuses the revert instead of disappearing under it.
- **Approval stamps your answers inside the same lock.** It writes `state="decided"` and
  `chosen` into the plan source, and pins the revision it just wrote — so the plan is not
  reported as changed by Big Plan's own write, and an approval cannot go stale against itself.
- **An interrupted publish settles rather than corrupts.** A journal is written beforehand, so
  the next `agent` command and the next `big-plan review` settle the commit before serving
  anything: the answer completes if the swap won, the request stays open if it did not, and a
  plan matching neither revision stops agent edits with a conflict naming both digests.

## Related

- [Handle an approval](/for-agents/approval/) — the digest check this model makes trustworthy.
- [Files Big Plan writes](/reference/files/) — what else appears beside your plan.

## Next

[Trust boundaries](/concepts/trust-boundaries/) — what loopback does and does not protect.
