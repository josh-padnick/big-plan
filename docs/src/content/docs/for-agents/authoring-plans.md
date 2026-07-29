---
title: Authoring plans
description: The MDX plan format Big Plan renders, what it rejects, and how validation errors guide you to a fix.
---

Big Plan documents are MDX files containing Markdown and built-in components.
The renderer never evaluates code from a plan: imports, exports, `{}` expressions, and inline JSX are rejected.
A plan is prose plus components, and the file on disk stays the greppable, diffable source of truth.

## Read the guidance first

Run `big-plan guidance` before writing a plan.
It prints the principles for writing a plan a human loves to review, plus a starting template that already satisfies the linting rules below.
Reading it recently is required: `validate` and `render` fail with `GUIDANCE_REQUIRED` until guidance has been run from the same working directory within 24 hours.

## What a plan may contain

Standard Markdown plus GFM tables, task lists, footnotes, and literal autolinks all work.
Fenced code blocks with a supported declared language receive syntax highlighting; unknown and undeclared languages stay plain.
Components are flow-level JSX elements from the built-in [component registry](/components/): `BigDecision`, `Callout`, `CodeDiff`, `CodeSnippet`, `DatabaseTableSchema`, `FileTree`, `FileTreeDiff`, `GraphqlOperation`, `GrpcMethod`, `HttpEndpoint`, and `SmallDecisionSet`, plus scoped child components such as `Annotation`, `Option`, and `Score` that are valid only in the hierarchy declared by their parent.
Component attributes are strings (`title="Rollout"`) or bare shorthand booleans (`showLineNumbers`) where a component's schema allows them.

## What a plan may not contain

- `import` and `export` statements.
- `{expression}` syntax, in components or inline (including `{/* comments */}`).
- Inline (text-level) JSX; components must stand alone at flow level.
- Unknown component names, unknown attributes, spread attributes, expression-valued attributes, and duplicate attributes.
- Four-space indented code blocks; MDX treats indented text as paragraphs, so always use fenced code blocks.
- HTML comments and angle-bracket `<url>` autolinks.

Because `<` and `{` begin MDX syntax, write them in code spans or fences when you need them literally in prose.

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

`plan-lede` requires a plan that opens with a level-one title to state its thesis in prose before the first section heading, so the reader is oriented before structure begins.
Any flow content after the title satisfies it; a title followed directly by another heading is the finding.

`lede-style` requires that lede to read as a declarative subtitle describing the delivered outcome.
A lede opening with a self-referential phrase such as "I propose", "We will", "This plan", or "This document" is flagged; prose mentioning those phrases later in a sentence is not.

`section-vocabulary` keeps section names in Big Plan's opinionated review vocabulary.
A heading reading exactly "Desired outcome", "Desired outcomes", or "Definition of done" is flagged with the preferred heading "Acceptance criteria".
Prose mentioning those phrases, and headings that merely contain them, are never flagged.

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
