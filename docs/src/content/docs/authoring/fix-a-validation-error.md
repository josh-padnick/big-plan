---
title: Fix a validation error
description: Turn any diagnostic big-plan validate raises into the edit that clears it.
---

**Goal.** A plan that passes `npx -y big-plan@latest validate <plan.mdx>` cleanly.

## Before you start

Run the correction loop rather than guessing:

```sh
npx -y big-plan@latest validate plans/checkout-retry.mdx
```

It reads the plan, renders the whole document in memory, builds the machine plan model in the
same pass, and applies every linting rule — without writing anything.

## How to read a diagnostic

Structural problems are positional and aggregated. After MDX parses, Big Plan collects every
recoverable problem and fails with the complete list, so you fix them in one pass:

```text
error: Cannot validate document with invalid MDX
help[3]: "3:1 ESM import/export statements are not supported",
         "5:14 Text expressions are not supported",
         "7:1 Unknown component \"Unknwon\""
```

Lint diagnostics name their own rule:

```text
line:column [rule-id] message
```

An MDX **syntax** error can stop parsing before component validation begins, so validation may
report only that one. Fix it and run again to see the rest.

## Structural errors

| What you see | Why | The edit |
| --- | --- | --- |
| `ESM import/export statements are not supported` | A plan is prose plus components; nothing in it may execute | Delete the `import` or `export` line |
| `Text expressions are not supported` | `{...}` is MDX expression syntax, including `{/* comments */}` | Put the braces in a code span or fence; delete the comment |
| `Unknown component "X"` | The registry is closed | Check the spelling against [Components](/components/) |
| An unknown attribute, a spread attribute, an expression-valued attribute, or a duplicate | Attributes are strings or bare booleans only | Read that component's Attributes table |
| A scoped child in the wrong place | `Annotation`, `Column`, `Entry`, `Option`, `Score` and friends are valid only inside their declared parent | Move it under the parent its own page names |
| Content that should be fenced is read as a paragraph | MDX treats four-space indented text as prose | Always use a fenced code block |
| A stray `<` or `{` in prose | Both begin MDX syntax | Write them inside a code span or fence |

## Lint rules

Lint is a stricter layer applied once structural compilation succeeds.
`render` applies the same rules before writing and `review` before opening a port, so a plan
that fails lint never reaches a reviewer.

| Rule | What it wants |
| --- | --- |
| `title-length` | A level-one title of at most eight words and sixty characters |
| `lede-presence` | Prose between the title and the first section heading |
| `lede-style` | A lede that describes the outcome, not the act of proposing it: no "I propose", "We will", "This plan", "This document" |
| `lede-length` | A lede of at most thirty words |
| `quick-summary-singleton` | At most one `QuickSummary` per plan |
| `slide-type-structure` | The objective facts of the [slide catalog](/authoring/slide-types/): singletons once, no `desired-experience` beside `desired-outcome`, distinct journey names, wireframes or a `wireframeReason` but never both, journeys nested in their container Part |
| `acceptance-criteria-grouping` | An acceptance-criteria slide past seven criteria to expose a grouping dimension |
| `slide-leading-title` | A slide to name its message before it shows anything: no component, fence, standalone image, or table as the first block under an h2 or h3 |
| `subtitle-duplication` | A context builder or a figure title that does not restate the heading above it |
| `collection-grouping` | A list past eight items, or a table past eight body rows, to be grouped |
| `table-of-contents-matches-sections` | `Entry` section names to repeat the document's overview forms exactly, in order, one to one |
| `markdown-table-format` | A table-shaped block to carry a valid delimiter row |
| `wireframe-product-copy` | Implementation and review notes out of product artboards |
| `wireframe-envelope-fit` | A `Row` inside the device's column budget: three on desktop and landscape tablet, two on portrait tablet, one on phone |

[Lint rules](/reference/lint-rules/) is the exhaustive reference, including what each rule
deliberately leaves alone.

## Command-level errors

| Code | What it means | The fix |
| --- | --- | --- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours | Run `npx -y big-plan@latest guidance` |
| `VALIDATION_ERROR` | A missing or extra argument, invalid MDX, or failed lint | Read the `help` entries; every diagnostic is there |
| `INPUT_NOT_FOUND` | The plan file cannot be read | Check the resolved absolute path in the message |

Every code, and which commands raise it, is in [Error codes](/reference/error-codes/).

## Verify

```text
$ npx -y big-plan@latest validate plans/checkout-retry.mdx
validated: /Users/you/repo/plans/checkout-retry.mdx
title: Retire the inline capture retry
sections: 11
components: 18
```

## If it goes wrong

- **Only one diagnostic comes back and you expected several.** An MDX syntax error stopped
  parsing before component validation began. Fix it and run again.
- **Validation passes and the plan still reads badly.** It says nothing about whether the plan
  reads well. Render it and reread the document exactly as your human will; `big-plan guidance`
  owns that bar.
- **A rule fires on something you believe is correct.** Every rule documents what it
  deliberately leaves alone. Check [Lint rules](/reference/lint-rules/) before working around it.

## Next

[Components](/components/) — the exact attributes and shapes for each component.
