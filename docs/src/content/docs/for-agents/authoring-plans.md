---
title: Authoring plans
description: The MDX plan format Big Plan renders, what it rejects, and how validation errors guide you to a fix.
---

Big Plan documents are MDX files containing Markdown and built-in components.
The renderer never evaluates code from a plan: imports, exports, `{}` expressions, and inline JSX are rejected.
A plan is prose plus components, and the file on disk stays the greppable, diffable source of truth.

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
It reads the plan, exercises the complete in-memory HTML delivery path, builds the machine plan model in the same pass, and runs authoring lint without writing an output file.
Success reports the resolved title plus section and component counts.

Validation answers whether Big Plan can deliver the plan for a human and whether its authoring lint recognizes likely presentation mistakes.
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

## Authoring lint catches likely presentation mistakes

Lint rules are an additional, deliberately stricter layer used by `validate`.
The first rule, `markdown-table-format`, catches table-shaped outer-pipe rows whose delimiter row is missing or malformed:

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
`render` and `compile` remain permissive for Markdown that the parser treats as prose; use `validate` when you want the extra authoring check.
