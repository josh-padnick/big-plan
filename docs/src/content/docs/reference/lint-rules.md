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

`table-of-contents-matches-sections` requires a `TableOfContents`'s Entry section names to repeat the document's h2 titles exactly, in order, one to one.
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
