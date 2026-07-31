---
title: Authoring plans
description: What a Big Plan document is, how the guidance gate works, and where each kind of authoring rule actually lives.
---

Big Plan documents are MDX files containing Markdown and built-in components.
The renderer never evaluates code from a plan: imports, exports, `{}` expressions, and inline JSX are rejected.
A plan is prose plus components, and the file on disk stays the greppable, diffable source of truth.

This page describes the system, not how to write well.
Everything a plan author has to judge - the title, the structure, the deck shape, terseness, when a component beats prose - is owned by `big-plan guidance` and stated there once.

## Guidance is the canonical source

Run `big-plan guidance` before writing a plan.
It prints the principles for writing a plan a human loves to review, and it is the only place those principles live.
Reading it recently is required: `validate` and `render` fail with `GUIDANCE_REQUIRED` until guidance has been run from the same working directory within 24 hours.

The acknowledgment is recorded per directory and expires after 24 hours, or immediately when the guidance content itself changes, so a stale reading never unlocks a changed contract.
`compile` stays open, because it produces machine-readable output rather than a document a human will read.

Run `big-plan guidance <Component>` for one component's usage guidance, which is authored beside that component rather than in the shared principles.

## Where each kind of rule lives

Big Plan keeps one home per fact:

| Kind of rule                           | Lives in                                | Why there                                                                           |
| -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| Anything you have to judge             | `big-plan guidance`                     | It is gated, so every authoring session reads it                                    |
| Judgment specific to one component     | `big-plan guidance <Component>`         | Authored beside that component, so it cannot drift from what the component enforces |
| Anything the compiler or lint enforces | The diagnostic itself                   | It reaches you at the moment of failure, with your file in hand                     |
| Exhaustive matching boundaries         | [Linting rules](/reference/lint-rules/) | Too long for a gated document, and needed only when a diagnostic surprises you      |
| Per-component attributes and shapes    | [Components](/components/)              | Reference you look up, not principles you internalize                               |

Guidance stays short on purpose.
A gated document only works while it is short enough to actually be read, so it carries judgment plus a pointer, never a second copy of what a validator already says precisely and at the right moment.

## What a plan may contain

Standard Markdown plus GFM tables, task lists, footnotes, and literal autolinks all work.
Fenced code blocks with a supported declared language receive syntax highlighting; unknown and undeclared languages stay plain.
Components are flow-level JSX elements from the built-in [component registry](/components/), plus scoped child components such as `Annotation`, `Column`, `Entry`, `Option`, and `Score` that are valid only in the hierarchy declared by their parent.
Component attributes are strings (`title="Rollout"`) or bare shorthand booleans (`showLineNumbers`) where a component's schema allows them.

## What a plan may not contain

- `import` and `export` statements.
- `{expression}` syntax, in components or inline (including `{/* comments */}`).
- Inline (text-level) JSX; components must stand alone at flow level.
- Unknown component names, unknown attributes, spread attributes, expression-valued attributes, and duplicate attributes.
- Four-space indented code blocks; MDX treats indented text as paragraphs, so always use fenced code blocks.
- HTML comments and angle-bracket `<url>` autolinks.

Because `<` and `{` begin MDX syntax, write them in code spans or fences when you need them literally in prose.

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
- `scripts/gen-guidance.mjs` embeds both into the CLI and derives a version hash from their content, which is what expires prior acknowledgments.
- A new statically checkable rule is a module under `src/lint/rules/`, registered in `src/lint/lint-plan.ts`, and documented in [Linting rules](/reference/lint-rules/).

Before adding a rule, decide which rung it belongs on.
A statically analyzable authoring-quality check over structurally valid input belongs in lint, where it blocks precisely and says so once.
Structural acceptance - unknown components, required children, and attribute shapes - stays in the component compilers so every command rejects it.
A judgment a reader has to make belongs in guidance, and nowhere else.
