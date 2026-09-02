---
title: Anatomy of a plan
description: The shape every Big Plan document shares, from the title through the verification contract.
---

Every plan is one MDX file. This is the shape that file takes, top to bottom, and what each
part is for. The judgment behind each choice lives in `big-plan guidance`; this page is the
map.

## The whole file, annotated

```mdx
# Retire the inline capture retry
```

The **title**: a punchy noun phrase naming what will exist after execution. At most eight
words and sixty characters, enforced by `title-length`.

```mdx
A durable retry queue that recovers failed captures without blocking checkout requests.
```

The **lede**: one declarative sentence, rendered as the document's subtitle. It describes the
delivered outcome — never "This plan proposes…". At most thirty words.

```mdx
<QuickSummary>
  <Why>  ...one bullet: the product goal a sponsor would repeat
  <What> ...one bullet: one imperative sentence naming what you will build
  <How>  ...up to three bullets: the actions you will take
</QuickSummary>
```

The **quick summary**: the card a reviewer reads first, directly after the lede and before any
section. Exactly one per plan. Its three facets are three rungs of one abstraction chain, and
the whole card is capped so it cannot grow into a summary of everything.

```mdx
<TableOfContents>
  <Entry section="Status quo" gist="Captures retry inline and block the request" />
  ...
</TableOfContents>
```

The **table of contents**: one row per section, in document order, so the reviewer sees the
whole argument before reading any of it. A `gist` is the section's takeaway at the altitude of
a decision, not a topic label. Lint verifies the one-to-one match with your sections.

```mdx
<Part title="Context" />
```

A **part**: a chapter break grouping the slides after it into one act. About three acts per
plan — context, the proposal, and shipping plus the reviewer's calls. Big Plan numbers them,
so never write numbers into the titles.

```mdx
<Slide type="status-quo" />

## Captures retry inline and block the request
```

A **slide**: one h2 section carrying one thought, at roughly one screen. An optional `Slide`
marker applies one of the [five registered types](/authoring/slide-types/) and its guidance;
the heading states this plan's specific message. If a section needs a second screen, it holds a
second thought — split it into h3 sub-slides, each of which renders as its own numbered frame.

```mdx
<Slide type="acceptance-criteria" />

## A failed capture recovers without a blocked request
```

The **verification contract**, near the end: every criterion independently checkable. Past
seven criteria, group them by a dimension that helps the reviewer judge.

## The reading order this produces

1. **Title and lede** — the mission.
2. **Quick summary** — why, what, how, at three altitudes.
3. **Table of contents** — the whole argument in one look.
4. **Part 1, Context** — status quo, then the outcome.
5. **Part 2, The proposal** — the design, the decisions, the mechanisms.
6. **Part 3, Shipping and your review** — the verification contract and the calls you need.

Everything after the quick summary is elaboration. Nothing essential should appear for the
first time in a later section.

## Two habits that carry most of the quality

**Lead with the title, and say it once.** Every slide and sub-slide names its message before it
shows anything. A component, fence, standalone image, or table as the first block under a
heading is rejected by `slide-leading-title`, because a reader has to know what they are
looking at before they look at it.

**Place every statement at a deliberate abstraction level.** A sentence naming files, commands,
or flags is mechanism-level and belongs in a design section, never in the lede or the summary.

## Where to look next

Run `big-plan guidance` before writing. It is the only place the judgment lives, it is gated so
every authoring session reads it, and it stays current through package upgrades rather than
through this page.

## Next

[Choose the right component](/authoring/choose-a-component/) — which component presents each
kind of plan information.
