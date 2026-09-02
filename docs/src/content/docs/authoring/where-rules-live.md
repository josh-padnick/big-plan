---
title: Where each rule lives
description: Which surface owns which kind of authoring rule, so you only ever look in one place.
---

Big Plan keeps one home per fact. A rule you have to judge is never also stated by a
validator, and a rule a validator enforces is never also copied into guidance.

## The map

Big Plan keeps one home per fact:

| Kind of rule                           | Lives in                                | Why there                                                                            |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Anything you have to judge             | `big-plan guidance`                     | It is gated, so every authoring session reads it                                     |
| Judgment specific to one component     | `big-plan guidance <Component>`         | Authored beside that component, so it cannot drift from what the component enforces  |
| Judgment specific to one slide type    | `big-plan guidance Slide`               | Generated from the shared type records, so matching and writing advice stay attached |
| Anything the compiler or lint enforces | The diagnostic itself                   | It reaches you at the moment of failure, with your file in hand                      |
| Exhaustive matching boundaries         | [Linting rules](/reference/lint-rules/) | Too long for a gated document, and needed only when a diagnostic surprises you       |
| Per-component attributes and shapes    | [Components](/components/)              | Reference you look up, not principles you internalize                                |

Guidance stays short on purpose.
A gated document only works while it is short enough to actually be read, so it carries judgment plus a pointer, never a second copy of what a validator already says precisely and at the right moment.

## How the validator answers you

Use `big-plan validate <input.mdx>` as the correction loop while authoring.
It reads the plan, renders the complete HTML document in memory, builds the machine plan model in the same pass, and applies every linting rule, without writing an output file.

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

Validation answers whether Big Plan can render the plan and whether it passes every statically analyzable rule.
It answers nothing about whether the plan reads well; `big-plan guidance` owns that bar.

## Extending the contract

Guidance is generated, not edited in place.

- A new principle is authored in `assets/guidance/plan-guidance.md`, or in `src/components/<component>/<component>.guidance.md` when it belongs to one component.
- A slide type's matching boundary and specific guidance live together in its one file under `src/plan-vocabulary/slide-types/definitions/`; the [`Slide` reference](/components/slide/#growing-the-catalog) owns the contribution path.
- `scripts/gen-guidance.mjs` embeds the principles, component guidance, and generated slide catalog into the CLI and derives a version hash from their content, which is what expires prior acknowledgments.
- A new statically checkable rule is a module under `src/lint/rules/`, registered in `src/lint/lint-plan.ts`, and documented in [Linting rules](/reference/lint-rules/).

Before adding a rule, decide which rung it belongs on.
A statically analyzable authoring-quality check over structurally valid input belongs in lint, where it blocks precisely and says so once.
Structural acceptance - unknown components, required children, and attribute shapes - stays in the component compilers so every command rejects it.
A judgment a reader has to make belongs in guidance, and nowhere else.

## Next

[Fix a validation error](/authoring/fix-a-validation-error/) — every diagnostic, keyed to the
edit that clears it.
