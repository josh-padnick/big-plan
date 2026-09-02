---
title: The compiled plan model
description: The JSON contract big-plan compile writes, field by field.
---

The JSON written by `compile` is Big Plan's **compiled plan model**: a structured representation intended for agents and tools.
`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes that representation as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with `id`, structural `name`, h2 `title`, and optional registered `type`.
- `components`: every component instance in document order, each with its `component` name, source `line` and `column`, its `blockId`, and its compiled `model` - the same typed model the renderer consumes, so structure can never drift from rendering.
  `blockId` is the address a reviewer's comment on that component resolves to, so a tool holding the model already holds the anchor feedback arrives against.
  It is absent for a component the reader cannot point at on its own: one rendered privately inside another component's markup, or one that is a slide scope rather than a block.

Prose fields inside models (context paragraphs, option bodies) are HAST subtrees: plain JSON objects describing the markdown content.
Generated element ids inside models match the ids in the rendered HTML, so a tool can link a model entry to its rendered element.

## An example payload

```json
{
  "title": "Retire the inline capture retry",
  "sections": [
    {
      "id": "captures-retry-inline-and-block-the-request",
      "name": "Status quo",
      "title": "Captures retry inline and block the request",
      "type": "status-quo"
    },
    {
      "id": "a-failed-capture-recovers-without-a-blocked-request",
      "name": "Acceptance criteria",
      "title": "A failed capture recovers without a blocked request",
      "type": "acceptance-criteria"
    }
  ],
  "components": [
    {
      "component": "QuickDecision",
      "line": 42,
      "column": 1,
      "blockId": "b7f2c1a9",
      "model": {
        "question": "Ship behind a feature flag?",
        "options": [{ "title": "Yes", "recommended": true }, { "title": "No" }]
      }
    }
  ]
}
```

`blockId` is the address a reviewer's comment on that component resolves to, so a tool holding
the model already holds the anchor feedback arrives against.

## Why compile renders too

Machine delivery publishes the collected component models, and each model carries the block
address its rendered root was given. A block address only exists over a finished deck, so the
document is rendered and then discarded. That is also why the address is absent for a component
the reader cannot point at on its own.

## Related

- [`big-plan compile`](/reference/commands/compile/) — the command that writes it.
- [How Big Plan works](/concepts/how-it-works/) — why every delivery agrees.
