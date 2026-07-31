---
title: Authoring plans
description: The MDX plan format Big Plan renders, what it rejects, and how validation errors guide you to a fix.
---

Big Plan documents are MDX files containing Markdown and built-in components.
The renderer never evaluates code from a plan: imports, exports, `{}` expressions, and inline JSX are rejected.
A plan is prose plus components, and the file on disk stays the greppable, diffable source of truth.

## Read the guidance first

Run `big-plan guidance` before writing a plan.
It prints the principles for writing a plan a human loves to review, including the quick-summary opening and the terseness the reviewer expects.
Reading it recently is required: `validate` and `render` fail with `GUIDANCE_REQUIRED` until guidance has been run from the same working directory within 24 hours.

## What a plan may contain

Standard Markdown plus GFM tables, task lists, footnotes, and literal autolinks all work.
Fenced code blocks with a supported declared language receive syntax highlighting; unknown and undeclared languages stay plain.
Components are flow-level JSX elements from the built-in [component registry](/components/): `ComplexDecision`, `Callout`, `CodeDiff`, `CodeSnippet`, `DatabaseTableSchema`, `Decision`, `FileTree`, `FileTreeDiff`, `FlowDiagram`, `GraphqlOperation`, `GrpcMethod`, `HttpEndpoint`, `Part`, `QuickSummary`, `SimpleDecisionSet`, and `TableOfContents`, plus scoped child components such as `Annotation`, `Entry`, `Option`, and `Score` that are valid only in the hierarchy declared by their parent.
Component attributes are strings (`title="Rollout"`) or bare shorthand booleans (`showLineNumbers`) where a component's schema allows them.

## What a plan may not contain

- `import` and `export` statements.
- `{expression}` syntax, in components or inline (including `{/* comments */}`).
- Inline (text-level) JSX; components must stand alone at flow level.
- Unknown component names, unknown attributes, spread attributes, expression-valued attributes, and duplicate attributes.
- Four-space indented code blocks; MDX treats indented text as paragraphs, so always use fenced code blocks.
- HTML comments and angle-bracket `<url>` autolinks.

Because `<` and `{` begin MDX syntax, write them in code spans or fences when you need them literally in prose.

## How structure renders as a deck

The rendered document reads as a deck: every h2 section becomes a slide frame headed by a numbered kicker, and `Part` markers group the slides into numbered acts that also group the sidebar navigation and the in-document `TableOfContents` overview.
A section containing h3 headings renders as a parent header block over numbered sub-slides, one per h3 run, with the h3 itself becoming the sub-slide's kicker.
Because that kicker is a label rather than a headline, a sub-slide that opens with a figure - a component, code block, image, or table - needs a title of its own as an h4 directly under the h3 and before the figure.
A sub-slide that opens with prose or a context builder needs no h4; never put a figure first under a heading.
An h4 title and a context builder are alternative ways to lead a sub-slide, never a sequence.
A slide or sub-slide whose first block under the heading is an entirely emphasized paragraph (`*like this*`) renders that paragraph as the context builder: one muted line under the kicker telling the reader what they are looking at.
Keep that line only when it adds what the title does not already carry, and never let a subtitle or figure label repeat or near-duplicate its slide title.

## Validate before rendering

Use `big-plan validate <input.mdx>` as the correction loop while authoring.
It reads the plan, renders the complete HTML document in memory, builds the machine plan model in the same pass, and applies linting rules to the authored plan without writing an output file.
Success reports the resolved title plus section and component counts, and reminds you to reread the rendered document against the guidance principles before presenting it.

Validation answers whether Big Plan can render the plan and whether the plan passes every statically analyzable rule in the lint collection.
It does not replace looking at the rendered document: visual quality, writing clarity, and whether a wide table is pleasant to read still require human review.

Structural validation is positional and aggregated when possible.
After MDX parses, Big Plan collects every recoverable problem and fails with the complete list, each entry carrying a `line:column` position:

```text
error: Cannot validate document with invalid MDX
help[3]: "3:1 ESM import/export statements are not supported",
         "5:14 Text expressions are not supported",
         "7:1 Unknown component \"Unknwon\""
```

An MDX syntax error can stop parsing before component validation begins, so validation may report only the parse error.
A silently degraded document would be worse than a failed one, because the entire product is trust in what the reviewer approves.

## Linting rules catch statically analyzable problems

Lint rules are an additional, deliberately stricter layer applied by `validate` and `render`.
They can check any statically analyzable aspect of an authored plan.

`title-length` keeps a plan's leading level-one title a punchy noun phrase: at most eight words and sixty characters.
A document that does not open with a level-one title is left alone.

`lede-presence` requires a plan that opens with a level-one title to state its thesis in prose before the first section heading, so the reader is oriented before structure begins.
Any flow content after the title satisfies it; a title followed directly by another heading is the finding.

`lede-style` requires that lede to read as a declarative subtitle describing the delivered outcome.
A lede opening with a self-referential phrase such as "I propose", "We will", "This plan", or "This document" is flagged; prose mentioning those phrases later in a sentence is not.

`lede-length` keeps the lede a subtitle rather than an opening body paragraph: at most thirty words, counted across plain text, inline code, and emphasis.
Big Plan renders the paragraph directly under the title as the document's subtitle, so supporting detail belongs in a following paragraph or section.

`section-vocabulary` keeps section names in Big Plan's opinionated review vocabulary.
A heading reading exactly "Desired outcome", "Desired outcomes", or "Definition of done" is flagged with the preferred heading "Acceptance criteria".
Prose mentioning those phrases, and headings that merely contain them, are never flagged.

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
`render` enforces the same rules before writing, so a plan that fails lint never reaches a reviewer; only `compile` remains permissive for Markdown that the parser treats as prose.
