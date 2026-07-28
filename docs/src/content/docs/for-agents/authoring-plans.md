---
title: Authoring plans
description: The static-subset MDX format Big Plan renders, what it rejects, and how validation errors guide you to a fix.
---

Big Plan documents are MDX files, but only a deliberately static subset of MDX is accepted.
The renderer never evaluates code from a plan: no imports, no exports, no `{}` expressions, and no inline JSX.
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

## Validation is positional and aggregated when possible

An invalid document never renders partially.
After MDX parses, the renderer collects every recoverable problem and fails with the complete list, each entry carrying a `line:column` position:

```text
error: Cannot render document with invalid MDX
help[3]: "3:1 ESM import/export statements are not supported",
         "5:14 Text expressions are not supported",
         "7:1 Unknown component \"Unknwon\""
```

Agents authoring plans should treat this as the correction loop: render, read the positions, fix, render again.
An MDX syntax error can stop parsing before component validation begins, so that render may report only the parse error.
A silently degraded document would be worse than a failed one, because the entire product is trust in what the reviewer approves.
