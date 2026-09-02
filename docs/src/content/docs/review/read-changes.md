---
title: Read the agent's changes
description: Walk a change set, accept each changed place, and revert a response you do not want.
---

**Goal.** Every place the agent changed seen at least once, accepted, and — where you disagree
— reverted.

## Before you start

- A live review with write custody. A standalone rendered document and a read-only session
  both disable the accept controls and say why.
- At least one answered comment, plan-wide question, or agent-pushed thread carrying a change
  set.

## How a change set is computed

**What changed** compares the request's claim-time baseline snapshot with the
validated result snapshot. Each changed answer carries its own attributed
places; plan-wide chat carries a grouped digest.
Every change digest names the model and client declared for that request with
the same identity presentation as **Agent Status**; undeclared fields remain
absent. This applies equally to reviewer-started work and pushed threads.
The in-place lens shows word-level edits for close rewrites and stacked **Was**/**Now** bands for larger rewrites, additions, removals, tables, and code.
Component changes that use the component diff contract render the component's compiled presentation on both **Was** and **Now** sides.
The change replaces the component in the plan instead of sitting beside a hidden copy.
When a **Now** side exists, it is the live, commentable component.
It keeps its comment entry and any controls, including maximize.
The **Was** side is inert evidence and carries no live plan identity, apart from the controls that reach evidence only it holds: a wireframe's screen switcher stays navigable there, so a screen marked as removed or moved can be opened on the side that still has it.
The controls drawn inside a **Was** screen look exactly as the plan draws them and do nothing, so the screen it shows stays the one the reader chose from its switcher.
That switcher moves the **Was** side alone, so the two sides can show different screens - which is how a screen the change removed stays reachable on the side that still has it.
Until the reviewer accepts an answerable **Now** Decision, a banner at the top of its card asks them to accept the change before answering.
Its disabled **Confirm choice** control shows the same guidance in a hazard-icon tooltip.
Diagram, file tree, and wireframe changes use the component's own maximize control and name.
Their controls work inside the change: diagram theme and flow controls, tree copy controls, and wireframe screen switchers.
A wireframe change compares the two prototypes one at a time behind the **Was**/**Now** toggle.
For a changed wireframe, its own screen switcher marks screens that were added, removed, moved, or updated; wholly added or removed wireframes keep plain entries.
A removed component or a change superseded by a later revision appears as inert evidence rather than as something to answer.
A removed wireframe keeps its own screen switcher, so the screens the change took away stay readable.
An added or replaced picture shows the picture itself in its band, because a
picture carries no words for a text comparison to show.
Changes inside `DataTable`, `QuickSummary`, `HttpEndpoint`, `GraphqlOperation`,
`GrpcMethod`, `DatabaseTableSchema`, `Callout`, `CodeSnippet`, and `CodeDiff`
use their component-owned field, row, facet, or text presentation instead of a
generic snapshot comparison.
A `DataTable` configuration-only change keeps the full row evidence visible
beside the changed table or column settings.
The change navigator tours several places without losing reading context.

Choose **Accept change** to mark the current place accepted and advance to the next unaccepted place, or **Accept all** to accept the remaining set.
Acceptance is a review checklist rather than an edit: it does not change the plan or resolve the comment thread.
It is recorded with the review, so it survives a reload and a runtime restart, and every place it is counted - the change digest on the agent's message and the navigator touring that same set - reports the same number.
Acceptance is recorded against the two snapshots the change set compares, so a later revision arrives as its own set to review rather than inheriting what you already accepted.
A page that cannot record review state, such as a read-only review session or a standalone rendered document, disables its accept controls and says why.
If Big Plan cannot reach the runtime while reading recorded acceptances, it warns that the page may show an incomplete count and keeps retrying.
If recording an acceptance fails, Big Plan says it is not saved yet and keeps retrying; keep the review open until the change set reports itself accepted.
If the runtime refuses the acceptance outright, the mark comes back off and the review says so, so the page never claims work that nothing recorded.
After accepting the set, choose **Keep chatting**; a comment thread also offers **Resolve thread**.
Resolving never cancels a message the thread is still waiting on: while the agent owes that thread an answer, the review runtime refuses the resolve and says so, so cancel the waiting message or wait for its answer first.
A resolved thread will not accept a reply or new feedback until you unresolve it: a reply you have already typed is kept, and unresolving the thread clears the message so you can send it.
**Revert response** restores only that response's claim-time baseline, leaves earlier changes in place, and becomes unavailable after the plan changes again.

Comments retain their premise snapshot. If the plan changes before a comment
is sent, a **Plan changed since this comment** badge opens the premise-to-current
diff. Answer diffs remain historical and reviewable after later revisions.

Targets use exact structural paths. After reload, a target with the same path
remains anchored. If that path disappeared, the thread reports **Original
target unavailable** and keeps its recorded address; Big Plan does not use
fuzzy matching or silently attach it to nearby prose.

## Verify

- The change digest on the agent's message and the navigator touring that set report the same
  number of accepted places.
- After **Accept all**, the set reports itself accepted, and the count survives a reload.

## If it goes wrong

| What you see                               | What it means                                                           | What to do                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The page warns the count may be incomplete | Big Plan could not reach the runtime while reading recorded acceptances | It keeps retrying; leave the page open                                                       |
| An acceptance says it is not saved yet     | Recording failed and is being retried                                   | Keep the review open until the set reports itself accepted                                   |
| A mark comes back off after you set it     | The runtime refused the acceptance outright                             | The review says so rather than claiming work nothing recorded                                |
| **Revert response** is not offered         | The plan changed again after that response                              | Reverting is only available while the response is still the latest state of its own baseline |
| **Resolve thread** is refused              | The agent still owes that thread an answer                              | Cancel the waiting message, or wait for its answer, then resolve                             |

## Next

[Approve a plan](/review/approve-a-plan/) — turn agreement into a record the agent can verify.
