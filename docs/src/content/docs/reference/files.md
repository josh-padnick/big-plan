---
title: Files Big Plan writes
description: Every path Big Plan creates on your disk, and what lives in each one.
---

Big Plan writes in two places: beside the plan you are reviewing, and in a state directory
under your home. Nothing else on your machine is touched, and no file leaves it.

## Beside the plan

```text
your-repo/
  plans/
    checkout-retry.mdx        The authoritative plan. Exactly one code path writes it.
    checkout-retry.html       Only if you ran `render`. Derived, safe to delete.
    checkout-retry.model.json Only if you ran `compile`. Derived, safe to delete.
  .big-plan/                  Created for you alone, and ignored by version control.
    .gitignore                Written by Big Plan so the directory ignores itself.
    review/
      <plan-id>/              One directory per plan, keyed by the resolved source path.
        session.json          The live session's identity.
        session-heartbeat.json  What proves a runtime is alive.
        agent/connections/    One record per connected coding agent.
    feedback/                 Feedback packages and their Markdown briefs, plus approval briefs.
```

The review id comes from the resolved source path, so staged comments survive the plan
revision an agent creates in response to feedback.

`.big-plan/` also holds runtime-backed staged comments, recorded decision answers, recorded
change acceptances, and the append-only approval log.

## Under your home directory

```text
~/.big-plan/
  service/                    Owner-only records for the review-link service.
```

The service keeps one small identity record per plan, the token that authorizes stopping it,
and an advisory record of the running process. **No file there records whether a session is
alive**; that answer only ever comes from the plan's own heartbeat.

The guidance acknowledgment lives here too, falling back to a `big-plan/` directory under the
system temporary directory when the home directory rejects writes.
`BIG_PLAN_STATE_DIR` pins both to exactly one directory.

## In your browser

A rendered document and a live review both use browser storage for per-reader conveniences:
appearance, colour theme, the approval message, collapse choices, diff view selections, and a
tab's own recovery record of comment text you have typed but not yet staged.

Runtime-backed staged comments, recorded decision answers, recorded change acceptances, and the append-only approval log live under `.big-plan/review/<plan-id>/` beside the plan.
The review id comes from the resolved source path, so staged comments survive the plan revision the agent creates in response to feedback.
Comment text that is typed but not yet staged or sent is kept in a recovery record owned by its browser tab, so reloading or reopening after a crash gives back the tab's staged drafts, open comment composer, and half-written thread replies.
Each tab keeps exactly one record, written and cleared only by the tab that owns it, and read once when the page loads.
The one exception is a record this build can no longer read: any tab claiming its writer identity removes such dead records so they cannot fill browser storage, while readable records from other tabs are never removed.
When the runtime answers on reload, that record is merged against its authoritative state automatically, or you are asked which version to keep when both sides changed the same comment.
When the runtime cannot be reached, the tab's own record is restored on its own and there is nothing to merge it against yet.
Tabs never read or adopt each other's records; two tabs converge through the runtime instead of through browser storage.
A composer whose place in the plan no longer exists is not reattached, and the review retains its text for copying until the reviewer discards it.
Text currently being typed in the plan-wide **Chat** composer exists only in the current page and does not survive a reload.
Static `big-plan render` documents use browser storage for their document-level comment draft.

Every runtime write of the reviewer's own state is conditional on the state the page last read, so a second tab or the runtime itself cannot have its work replaced without notice.
The tab's own browser recovery record carries no runtime version; it is this tab's copy of what it was holding, not a claim on the shared state.
When a write finds the state has moved on, the page reconciles comment by comment.
If the same comment really was changed in two places, the review shows both versions and asks which one to keep.
If one copy was submitted while another copy was still being edited, the review asks before staging that edit as new feedback.
Two tabs that are both offline converge only after one reaches the runtime.
Cross-tab offline convergence without the runtime remains part of the wider consistency consolidation because it requires causal versions, durable resolution markers, and cross-tab serialization.

The `.big-plan/` directory is created for the reviewer only and ignored by
version control. Feedback packages and their Markdown briefs live under
`.big-plan/feedback/`.

## What is safe to delete

| Path | Safe to delete | What you lose |
| --- | --- | --- |
| `<plan>.html`, `<plan>.model.json` | Yes | Nothing; both are derived and regenerate |
| `.big-plan/review/<plan-id>/` | While no review is running | Staged comments, decision answers, recorded acceptances, and the approval log for that plan |
| `.big-plan/feedback/` | Yes | The human-readable feedback and approval briefs |
| `~/.big-plan/service/` | While no review link needs to resolve | Nothing durable; the next link-printing command recreates it |

Never edit the plan file while a review holds custody of it. The authoritative source has
exactly one writer; see [One writer owns the plan](/concepts/one-writer/).

## Related

- [Configuration and state](/reference/configuration/) — the variables that move these paths.
- [Trust boundaries](/concepts/trust-boundaries/) — why the review directory is owner-only.
