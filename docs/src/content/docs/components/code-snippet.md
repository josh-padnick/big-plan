---
title: CodeSnippet
description: A planned block for annotated code excerpts with a file association, real line numbers, and line-anchored notes.
---

`CodeSnippet` is for code a reviewer must inspect line by line: a file association, real line numbers starting from the file's actual line, and `Annotation` cards anchored to the lines they explain.
Plain samples should stay plain fences, which already ship syntax highlighting and a copy control; `CodeSnippet` earns its place through exactly the three things a fence cannot express.

:::caution[In progress]
`CodeSnippet` is a planned contract, not an available block yet.
The current renderer rejects it as an unknown block.
:::

:::note[📸 Screenshot placeholder]
An annotated snippet with the file header, file-absolute gutter, a tinted anchor line, and its annotation card.
:::

## Usage

````mdx
<CodeSnippet file="src/render/markdown/convert.ts" startLine="42" showLineNumbers>

```ts
const convertMarkdown = async ({ source, fallbackTitle }) => {
  const tree = await parseStaticMdx({ source, diagnostics });
  rehypeRenderBlocks({ diagnostics })(tree);
  rehypeSlug()(tree);
  return { tree, outline: collectOutline(tree) };
};
```

<Annotation lines="44">
  The registry runs before every other transform so no MDX node can reach the
  serializer.
</Annotation>

<Annotation lines="45-46">
  Slug allocation must follow block rendering, because typed blocks may
  introduce new heading ids.
</Annotation>

</CodeSnippet>
````

## Attributes

| Attribute         | Type                     | Required           | Behavior                                                                                                                                    |
| ----------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`            | string                   | No                 | File the excerpt belongs to; renders the header path and enables the copy-path action.                                                      |
| `startLine`       | string, positive integer | No (default `"1"`) | The file line the first fenced line corresponds to; the gutter and all annotation anchors use this file-absolute numbering.                 |
| `showLineNumbers` | bare boolean             | No                 | Renders the line-number gutter; required whenever `startLine` is set, since invisible numbering would make annotation anchors unverifiable. |

## Annotations

`Annotation` takes one required `lines` attribute: a single file-absolute line (`"47"`) or a strictly ascending inclusive range (`"47-52"`).
Every referenced line must fall inside the snippet's range, and the body is ordinary markdown.
Cards render immediately after the last line of their range with a `Line N` / `Lines N-M` badge; anchor lines are accent-tinted with a gutter marker in both themes.
An `Annotation` outside a declaring parent stays an unknown block.

## Fence contract and diagnostics

The block takes exactly one fenced code block, plus zero or more `Annotation` blocks, and nothing else.
Every violation reports a positional diagnostic: a non-integer `startLine`, `startLine` without `showLineNumbers`, an out-of-range anchor (the message includes the valid range), and a bare snippet with no `file`, no `startLine`, and no annotations, which is rejected with a pointer to use a plain markdown fence.

## Copy behavior

The copy action copies only the raw fenced source: never annotations, never line numbers.
The line-number gutter is excluded from text selection, so copy-by-drag stays clean too.
