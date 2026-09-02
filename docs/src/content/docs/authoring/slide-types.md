---
title: Slide types
description: The five registered slide types, when each one matches, and what it asks of the slide.
---

A `Slide` marker applies a recurring plan role to the heading below it. The catalog is closed
and small on purpose: a type exists only where the role recurs across plans and carries
guidance worth attaching.

Run `big-plan guidance Slide` once before drafting to get this catalog plus its authoring
advice in one call. This page is the same catalog as reference; the command is the version
that ships with your installed CLI, so it is the one to trust if the two ever disagree.

The catalog lives at `src/plan-vocabulary/slide-types/definitions/`, one file per type.

## The catalog

### Status quo

`<Slide type="status-quo" />` · at most once per plan

**Use it when** the slide establishes what is true today, including what already works, before
the proposal changes anything.

**Do not use it** for the root-cause diagnosis alone, a history lesson, or a disguised list of
proposed changes.

- Lead with observable evidence and user-visible consequences, then name the constraint the
  proposal must address.
- Include what already works, so the plan preserves strengths instead of presenting the
  current system as uniformly broken.
- Keep causes distinct from symptoms; mark inference as inference when the evidence does not
  prove the cause.

**Pairs with** [`CodeSnippet`](/components/code-snippet/) for the smallest excerpt that makes a
present constraint concrete, and [`FileTree`](/components/file-tree/) when the tree itself
explains the constraint.

### Desired experience

`<Slide type="desired-experience" />` · at most once per plan · cannot appear with
**Desired outcome**

**Use it when** the plan adds a feature and the slide describes the concrete change in a
user's or reviewer's lived experience.

**Do not use it** for a bug fix, re-architecture, or tech-debt payoff.

- Write from the human's point of view and name what they can see, do, understand, or recover
  from after the change.
- Prefer first-person outcomes when they make the experience tangible, but keep the title in
  plain language rather than turning it into a slogan.
- Separate the experience from the implementation; queues, schemas, and modules belong in later
  design slides.

**Pairs with** [`FlowDiagram`](/components/flow-diagram/) for a human-centered flow, never a
system pipeline, and [`Callout`](/components/callout/) for one non-negotiable experience
constraint.

### Desired outcome

`<Slide type="desired-outcome" />` · at most once per plan · cannot appear with
**Desired experience**

**Use it when** the plan fixes a bug, changes architecture, or pays down tech debt, and the
slide states the concrete result the work should produce.

**Do not use it** for a new feature's lived user experience, or for the checkable verification
contract at the end of the plan.

- State the operational or architectural result a sponsor would repeat, not the files,
  abstractions, or migrations used to reach it.
- Name the constraint removed or capability restored, and make the before-and-after difference
  concrete.
- Keep it distinct from Acceptance criteria: this slide explains why the work matters; the later
  contract proves when it is done.

**Pairs with** [`FileTreeDiff`](/components/file-tree-diff/) only when the ownership change is
itself the outcome, and [`Callout`](/components/callout/) for one architectural invariant.

### User journeys

`<Slide type="user-journey" name="..." toc="..." />` · repeatable

**Use it when** the slide follows one person through one complete goal, including the response,
recovery, or decision that closes the loop.

**Do not use it** for a service pipeline, an architecture sequence, an isolated screen
inventory, or a bundle of unrelated journeys.

- Name the container "User journeys" as a [`Part`](/components/part/) and nest every journey
  underneath it. A typed journey authored beside its container renders as its sibling instead
  of its child, and lint rejects that.
- Count the actors to pick the shape. With two or more actors, group by actor: one untyped
  group slide per actor inside the Part, each holding that actor's journeys as sub-slides.
  With a single actor, keep the journeys flat as typed slides directly inside the Part.
- Mark the heading the journey actually owns: the h3 in a grouped shape, the h2 in a flat one.
- Give every marker a distinct `name` for its kicker and sidebar, and an ultra-concise `toc`
  form for the overview; the heading beneath carries this plan's full claim.
- Open the container with a user-summaries overview slide in the standard convention.
- Include a [`Wireframe`](/components/wireframe/) with real `Screen` mockups, or add a
  non-empty `wireframeReason` explaining why no UI exists to show. Lint enforces one or the
  other, and rejects both at once.

**Pairs with** [`Wireframe`](/components/wireframe/) by default, and
[`Callout`](/components/callout/) for the moment a reviewer should inspect most closely.

### Acceptance criteria

`<Slide type="acceptance-criteria" />` · at most once per plan

**Use it when** the slide is the checkable contract proving the proposed work is complete.

**Do not use it** for aspirations, desired outcomes, implementation tasks, or a restatement of
the proposal.

- Make every criterion independently verifiable by naming an observable behavior, artifact, or
  boundary condition.
- Cover the promised experience and the important failure or degenerate cases, not only the
  happy path.
- Describe evidence of completion rather than implementation steps.
- Past seven criteria, group them by a dimension that helps the reviewer judge them. Lint
  enforces this.

**Pairs with** [`CodeDiff`](/components/code-diff/),
[`DatabaseTableSchema`](/components/database-table-schema/), and
[`HttpEndpoint`](/components/http-endpoint/) where an exact shape is itself part of the
contract.

## What lint checks

`slide-type-structure` enforces only objective facts from this catalog: singleton types appear
at most once, `desired-experience` and `desired-outcome` never appear together, repeated user
journeys keep distinct names and TOC forms, every user journey carries wireframes or a
`wireframeReason` but never both, and every typed journey nests inside its container Part.

It does not require any type, judge whether your content matches a type, or enforce the
plain-language title discipline. Those are yours.

## An untyped slide is fine

Typed coverage is not a quality target. When no type fits, write an untyped slide under the
general principles rather than forcing a match.

## Next

[Choose the right component](/authoring/choose-a-component/) — pick between components that
look interchangeable.
