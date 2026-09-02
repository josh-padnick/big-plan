---
title: big-plan compile
description: Write the validated plan as machine-readable JSON for agents and tools.
---

## Synopsis

```text
big-plan compile <input.mdx> [output.json]
```

## Arguments

| Argument | Required | Behaviour |
| --- | --- | --- |
| `input.mdx` | Yes | The plan to compile |
| `output.json` | No | Where to write. Defaults to the input path with its extension replaced by `.model.json` |

## Options

`compile` accepts no options, rejects any dash-prefixed argument, and rejects a third
positional argument.

## Result

- `compiled`: the absolute output path.
- `title`: the document title.
- `sections` and `components`: the counts collected.
- `help`: a description of what the JSON holds.

## What it writes

The JSON written by `compile` is Big Plan's **compiled plan model**: a structured representation intended for agents and tools.
`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes that representation as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with `id`, structural `name`, h2 `title`, and optional registered `type`.
- `components`: every component instance in document order, each with its `component` name, source `line` and `column`, its `blockId`, and its compiled `model` - the same typed model the renderer consumes, so structure can never drift from rendering.
  `blockId` is the address a reviewer's comment on that component resolves to, so a tool holding the model already holds the anchor feedback arrives against.
  It is absent for a component the reader cannot point at on its own: one rendered privately inside another component's markup, or one that is a slide scope rather than a block.

Prose fields inside models (context paragraphs, option bodies) are HAST subtrees: plain JSON objects describing the markdown content.
Generated element ids inside models match the ids in the rendered HTML, so a tool can link a model entry to its rendered element.

## Errors

| Code | Raised when | Exit |
| --- | --- | --- |
| `VALIDATION_ERROR` | The input argument is missing, a third positional argument is present, the output would overwrite the input, or the MDX is invalid | 2 |
| `INPUT_NOT_FOUND` | The input cannot be read | 1 |

`compile` is **not** gated, so machine tooling can run it without a guidance acknowledgment.
It is also the one command that stays permissive about authoring lint: it continues to accept
legal Markdown that a quality rule flags.

## Troubleshooting

- **A component you expected has no `blockId`.** That address exists only where the component's
  root became a block a reader can point at. A component rendered privately inside another
  component's markup, and a slide — which is a scope rather than a block — each publish a model
  with no address.
- **`compile` succeeds where `render` fails.** Expected. `render` applies authoring lint;
  `compile` does not.
- **You want the ids to match the HTML.** They do: generated element ids inside models match the
  ids in the rendered document, so a tool can link a model entry to its rendered element.

## Related

- [The compiled plan model](/reference/plan-model/) — the field-by-field contract.
- [How Big Plan works](/concepts/how-it-works/) — why every command agrees.
