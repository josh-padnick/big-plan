---
title: CodeSnippet
description: A component for annotated code excerpts with a file association, real line numbers, and line-anchored notes.
---

`CodeSnippet` shows an excerpt of existing code a reviewer must inspect line by line: a file association, real line numbers starting from the file's actual line, and `Annotation` cards anchored to the lines they explain.

## When to use it

Use `CodeSnippet` when the code under review already exists and the reviewer needs to see it in place - with its real file path and file-absolute line numbers - rather than as an anonymous sample.

### When not to use it

- Plain samples - a fenced code block already ships syntax highlighting and a copy control; `CodeSnippet` earns its place only through the file association, real line numbers, and anchored notes a fence cannot express
- Proposed changes - showing an edit is [`CodeDiff`](/components/code-diff/)'s job

## Use cases

- Walk the reviewer through the exact lines a plan builds on, in their real location in the file
- Explain load-bearing lines with annotations anchored to their file-absolute numbers

## How it looks

:::note[📸 Screenshot placeholder]
An annotated snippet with the file header, file-absolute gutter, a tinted anchor line, and its annotation card.
:::

## Usage

````mdx
<CodeSnippet file="src/render/markdown/convert.ts" startLine="42" showLineNumbers>

```ts
const convertMarkdown = async ({ source, fallbackTitle }) => {
  const tree = await parseStaticMdx({ source, diagnostics });
  rehypeRenderComponents({ diagnostics })(tree);
  rehypeSlug()(tree);
  return { tree, outline: collectOutline(tree) };
};
```

<Annotation lines="44">
  The registry runs before every other transform so no MDX node can reach the
  serializer.
</Annotation>

<Annotation lines="45-46">
  Slug allocation must follow component rendering, because components may
  introduce new heading ids.
</Annotation>

</CodeSnippet>
````

## Authoring

### Attributes

| Attribute         | Type                     | Required           | Behavior                                                                                                                                    |
| ----------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`            | string                   | No                 | File the excerpt belongs to; renders the header path and enables the copy-path action.                                                      |
| `startLine`       | string, positive integer | No (default `"1"`) | The file line the first fenced line corresponds to; the gutter and all annotation anchors use this file-absolute numbering.                 |
| `showLineNumbers` | bare boolean             | No                 | Renders the line-number gutter; required whenever `startLine` is set, since invisible numbering would make annotation anchors unverifiable. |

### Children

The component takes exactly one fenced code block, plus zero or more `Annotation` components, and nothing else.

Every violation reports a positional diagnostic:

- A non-integer `startLine`
- `startLine` without `showLineNumbers`
- An annotation anchor outside the snippet's range (the message includes the valid range)
- A bare snippet with no `file`, no `startLine`, and no annotations, which is rejected with a pointer to use a plain markdown fence

### Annotation

Nest `Annotation` directly inside `CodeSnippet` to anchor a markdown note to specific lines.

| Attribute | Type   | Required | Behavior                                                                                                                                              |
| --------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lines`   | string | Yes      | A single file-absolute line (`"47"`) or a strictly ascending inclusive range (`"47-52"`); every referenced line must fall inside the snippet's range. |

The body is ordinary markdown - though not headings, footnotes, or nested components - and must not be empty; an `Annotation` outside a declaring parent stays an unknown component.

An annotation renders as a prose card immediately after the last line of its range, with a `Line N` / `Lines N-M` badge; anchor lines are accent-tinted with a gutter marker in both themes.

## Copy behavior

The copy action copies only the raw fenced source: never annotations, never line numbers.
The line-number gutter is excluded from text selection, so copy-by-drag stays clean too.
