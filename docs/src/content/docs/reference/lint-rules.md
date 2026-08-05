---
title: Linting rules
description: Every authoring lint rule Big Plan enforces, with the exact boundaries that keep each one conservative.
---

Lint is an additional, deliberately stricter layer that `validate` and `render` both apply once structural compilation succeeds.
It can check any statically analyzable aspect of an authored plan.
`render` enforces the same rules before writing, so a plan that fails lint never reaches a reviewer; only `compile` stays permissive for Markdown the parser treats as prose.

This page is the exhaustive reference for what each rule matches and, just as importantly, what it deliberately leaves alone.
It does not explain why the rules exist or how to write a plan well.
Run `big-plan guidance` for that: it is the canonical and only source for every judgment a plan author has to make.

Every diagnostic is positional and names its own rule:

```text
line:column [rule-id] message
```

## The rules

`title-length` keeps a plan's leading level-one title a punchy noun phrase: at most eight words and sixty characters.
A document that does not open with a level-one title is left alone.

`lede-presence` requires a plan that opens with a level-one title to state its thesis in prose before the first section heading, so the reader is oriented before structure begins.
Any flow content after the title satisfies it; a title followed directly by another heading is the finding.

`lede-style` requires that lede to read as a declarative subtitle describing the delivered outcome.
A lede opening with a self-referential phrase such as "I propose", "We will", "This plan", or "This document" is flagged; prose mentioning those phrases later in a sentence is not.

`lede-length` keeps the lede a subtitle rather than an opening body paragraph: at most thirty words, counted across plain text, inline code, and emphasis.
Big Plan renders the paragraph directly under the title as the document's subtitle, so supporting detail belongs in a following paragraph or section.

`quick-summary-singleton` allows at most one `QuickSummary` per plan, so the reviewer always has exactly one place to start.

`slide-type-structure` enforces only objective facts from the registered catalog.
Singleton types may appear at most once, `desired-experience` and `desired-outcome` may not appear together, repeated user journeys must keep distinct names and TOC forms, every user journey must contain its required Wireframe mockups, and `acceptance-criteria` must follow every other typed slide.
It does not require any type, judge whether content matches a type, lint “Success looks like”, or enforce the plain-language title discipline.

`slide-leading-title` requires a slide or sub-slide to name its message before it shows anything.
A component, fenced code block, standalone image, or table as the first block under an h2 or h3 is flagged; a sub-slide fixes it with an h4 title above the figure, and a slide with a title line or context builder.
Prose, a context builder, an image used inside a sentence, and a section that opens straight into its sub-slides are never flagged.

`subtitle-duplication` rejects a leading context builder, or a figure's own `title`, that restates the heading above it.
Comparison ignores case, punctuation, and a leading article.
It flags an exact normalized match, the same words reordered, or a contained phrase of at least two words that covers at least half the longer name; a heading's words merely appearing inside a longer, more specific label are left alone.
A `Part` marker's act name and titles nested inside a component, such as an `Option` or `Criterion`, are never compared.

`collection-grouping` requires a list past eight items, or a table past eight body rows, to be grouped.
A list counts as grouped when its items carry nested items; a table counts as grouped when its first column repeats, which is what a grouping dimension looks like once equal values sit together.
Splitting a long collection into several shorter labelled lists satisfies the rule the same way, because no single list then reaches the threshold.

`table-of-contents-matches-sections` requires a `TableOfContents`'s Entry section names to repeat the document's overview forms exactly, in order, one to one.
For most typed slides that is the catalog name; for a user journey it is the marker's `toc` form; for an untyped slide it is the h2 title.
Every mismatch - a wrong name, a missing section, or an extra entry - is reported at the TableOfContents's position, so the overview can never drift from the plan it summarizes.

`markdown-table-format` catches table-shaped outer-pipe rows whose delimiter row is missing or malformed:

```md
| Change | Effect |
| Cache responses | Faster reads |
```

The diagnostic points to the row that should be the delimiter:

```text
2:1 [markdown-table-format] Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"
```

The rule ignores valid GFM tables, ordinary prose containing pipes, rows presented wholly as inline-code examples, fenced code blocks, blockquotes, and isolated table-like rows.
Inline code inside a table cell does not hide an otherwise table-shaped row.

`wireframe-product-copy` keeps implementation and review notes out of product artboards.
Within a `Wireframe`, literal attributes containing `sticky`, `remembered`, `Cmd+K`, or `J/K` are rejected; move that rationale to the surrounding plan prose and leave only language the intended product user sees inside the drawing.
The same words in prose outside a `Wireframe` are left alone.
