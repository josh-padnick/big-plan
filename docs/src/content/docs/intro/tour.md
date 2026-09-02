---
title: A tour of the review document
description: What every control in a Big Plan document does, from the branding bar to a comment thread.
---

A rendered plan and a live review look almost the same. The difference is what the controls can
do: a rendered `.html` file is a document you read, and a live `big-plan review` session is a
document you can write back to.

This page walks the chrome once, top to bottom. Nothing here is a step to follow — it is a map
of what you are looking at.

## The branding bar

Along the top of every document.

| Control | What it does | Where it appears |
| --- | --- | --- |
| The logo | Follows the effective light or dark appearance, independently of the colour theme | Everywhere |
| **Approve plan** | Opens the approval dialog | Live review with write custody only |
| **Feedback** | Opens the sidebar on **Comments**, **Chat**, or **Inputs** | Live review |
| **Agent Status** | The coding-agent connection and its current work | Live review |
| **More actions** | **Export**, then **Settings** | Live review |
| The gear | **Settings** on its own | Standalone rendered document |

A read-only review — one whose plan a newer session took custody of — keeps showing an approval
already in force but offers no approval actions. A standalone document shows no approval
control at all, though it carries the approved stamp when `render` found an approval pinning
that exact source.

## The contents sidebar

On wide screens, a viewport-bounded sticky sidebar with a fixed **Contents** header and an
independently scrolling section list that reveals the active entry when needed. On narrow
screens it becomes a compact **Sections** menu.

- Section links scroll smoothly, unless you have asked your OS for reduced motion.
- During a wide-screen jump, the sidebar holds its exact scroll position until the requested
  section becomes current, then resumes tracking.
- **Expand all** and **Collapse all** act on the whole document; a jump expands collapsed
  ancestors on the way.

## The reading column

One column, with coordinated light and dark variants for every colour theme.

- **Collapse controls** sit on Parts, slides, and sub-slides.
- **Maximize** appears on fenced code, code snippets and diffs, tree diffs, data tables,
  database schemas, flow diagrams, and wireframes. `Escape` restores the reading view.
- **Copy** controls sit on fenced code, code snippets and diffs, data tables, and database
  schemas. Success replaces the copy icon with a check without shifting the toolbar.
- Collapse choices, diff views, and database-schema column order persist for the exact source
  path and authored revision, so same-titled plans and distinct revisions never share state.

## Commenting

Every block a reader can point at carries a comment affordance.

- A **slide's comment icon** addresses the whole slide, so an instruction like "rewrite this in
  Spanish" carries the slide's content rather than its heading.
- A **component toolbar's comment icon** addresses that component.
- **Selecting text** inside a paragraph, list, or table cell anchors the note to that block
  alone.

See [Comment on a plan](/review/comment-on-a-plan/) for the workflow.

## The Feedback sidebar

Four things share one sidebar, and choosing an open one closes it.

| Tab | What it holds |
| --- | --- |
| **Comments** | Staged and sent comments, grouped by the package they were sent in |
| **Chat** | Plan-wide questions, and threads the agent pushed into the review |
| **Inputs** | What the review is still waiting for — for now, every decision the plan asks |
| **Agent Status** | The connected agent's identity, its current work, and the connect prompt |

## Decision cards

An open `Decision`, `QuickDecision`, or `DecisionAnalysis` with `interaction="choose"` can be
answered in place. The card's caption always states what is true right now: saving, saved with
this review, or noted for this reading session only.

**Suggest another option** opens a composer that asks what your own words are for — the
decision itself, or a comment the agent should act on.

See [Answer the plan's decisions](/review/answer-decisions/).

## Change sets

When the agent answers, its message carries a change digest, and **Proposed changes** gives
that thread one evolving change set. The navigator tours each changed place without losing your
reading position; **Accept change** marks the current place and advances.

Acceptance is a review checklist rather than an edit: it does not change the plan or resolve
the thread.

See [Read the agent's changes](/review/read-changes/).

## Settings

Appearance, colour theme, and the approval message, each on its own page in a sidebar beside
the page you pick.

See [Change how the viewer looks](/review/viewer-settings/).

## What works with scripts disabled

The plan itself. Content is server-rendered HTML; scripts add the interactions above and never
render or gate plan content. Big Plan ships no separate script-free variant because it does not
need one.

## Next

[See a rendered plan](/intro/demo/) — open a real one and try the controls.
