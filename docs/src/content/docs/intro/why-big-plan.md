---
title: Why Big Plan?
description: The big decisions happen in the plan, while they're still cheap to change; reviewing them deserves a first-class experience.
---

Plans get treated like small things.
They're not.
The big decisions happen in the plan, while they're still cheap to change.
Plans are a big deal.
Make yours a big plan.

## Philosophy

Big Plan makes two bets that shape everything else.

**A plan should be structured, not freeform.** Plans are MDX with a fixed library of typed
components, so every plan renders into the same document shape. The agent spends its effort on
the decisions rather than the presentation, and the tenth plan you review reads exactly like
the first.

**A plan on your own disk should not require an account.** One standalone command renders it,
the output is one HTML file, and nothing about reviewing it involves logging in or leaving your
machine.

## Small plans and big plans

In a typical AI workflow, the more confident you are in the plan, the better your agent performs at execution, and the faster your final review goes.
That confidence comes from review, and review quality is set by how the plan presents itself.

By default, an agent plan renders as a wall of text that's painful to read.
We think of those plans of limited ambition as small plans.
If plans matter this much to the human, they should present in a first-class way.
We think of those plans of large ambition as big plans, and Big Plan exists to turn every small plan into one.

## The wall of text problem

An agent's plan usually arrives as a wall of text: thousands of words of markdown, scrolled past in a terminal or skimmed in a raw diff.
The most consequential document in the workflow is routinely the least readable one.
When reading the plan is painful, review quietly collapses into rubber-stamping, and the decisions that matter most go unexamined.

Most tools treat the plan as a throwaway preamble to the real work.
Big Plan gives it a first-class reading and review experience, built for the moment of agreement.

## Agree before the agent acts

Big Plan is built around one question: what is the best way to review a plan and reach agreement on it before an agent acts?

Once an agent starts executing, changing course means unwinding work.
While the plan is on the table, changing everything costs one comment.

## How it's different

**Code review** judges a change after the work is done, when pushing back is expensive.
Big Plan reviews intent before any code exists; agree on the plan first, and code review gets easier.

**Project management** tracks work over time with tickets, statuses, and boards.
Big Plan has none of that; it exists only for the moment of agreement.

**A markdown preview** shows you the text.
Big Plan is built for review: section navigation, readable code, and typed components.

For how Big Plan compares to its closest neighbors, Lavish and Agent-Native Plans, see [Big Plan vs. Other](/intro/vs-other/).

## Keep the workflow local

An agent writes its plan as a document on disk, and Big Plan renders it into a local review document.
Everything runs on your machine, the rendered file makes no external requests, and the plan file on your disk stays the source of truth.

## Next

[Install Big Plan](/intro/installation/) — Node.js 22, one command, nothing installed globally.
