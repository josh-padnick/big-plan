---
title: big-plan validate
description: Check that a plan compiles, renders, and passes every lint rule, without writing anything.
---

## Synopsis

```text
big-plan validate <input.mdx>
```

## Arguments

| Argument    | Required | Behaviour                                                         |
| ----------- | -------- | ----------------------------------------------------------------- |
| `input.mdx` | Yes      | The plan to check, resolved against the current working directory |

`validate` accepts no output argument and rejects a second positional argument.

## What it does

`validate` reads and checks the plan without choosing an output path, creating a directory, or writing a file.
It performs three checks:

1. The shared static-subset MDX and component compiler accepts the authored structure.
2. Big Plan renders the complete HTML document in memory, including React component presentation, Markdown transforms, shell composition, and serialization.
3. The authored plan passes every registered linting rule.

Lint is intentionally stricter than structural compilation.
`render` applies the same linting rules after derivation and before writing, so a plan that fails lint never becomes a review document; `compile` continues to accept legal Markdown that a quality rule flags.
See [Linting rules](/reference/lint-rules/) for every rule and its conservative matching boundaries.
Rendering the document in memory does not replace visual review: browser layout, readability, and whether the page matches author intent still require a human.

## Result

- `validated`: the absolute input path.
- `title`: the document title.
- `sections` and `components`: the validated counts.
- `help`: a reminder that lint checks only what is statically analyzable, so the rendered
  document still needs rereading against the `guidance` principles.

It writes no output.

## Errors

| Code                | Raised when                                                                                                                                        | Exit |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours                                                                         | 2    |
| `VALIDATION_ERROR`  | The input argument is missing, a second positional argument is present, an option is unknown, the MDX is invalid, or the plan fails authoring lint | 2    |
| `INPUT_NOT_FOUND`   | The input cannot be read; the message carries the resolved absolute path                                                                           | 1    |

## Troubleshooting

- **Only one diagnostic came back.** An MDX syntax error can stop parsing before component
  validation begins. Fix it and run again to see the rest.
- **It passed and the plan still reads badly.** Validation answers whether Big Plan can render
  the plan and whether it passes every statically analyzable rule. It answers nothing about
  whether the plan reads well.
- **A rule fired on something you believe is correct.** Every rule documents what it
  deliberately leaves alone; check [Lint rules](/reference/lint-rules/).

## Related

- [Fix a validation error](/authoring/fix-a-validation-error/) — every diagnostic, keyed to its edit.
- [Lint rules](/reference/lint-rules/) — the exhaustive matching boundaries.
