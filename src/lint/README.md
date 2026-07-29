# Authoring lint local map

Start with the root [agent guide](../../AGENTS.md) and the
[renderer local map](../render/README.md).
This directory owns checks for any aspect of an authored plan that can be
statically analyzed.
Those checks run as part of `big-plan validate` and `big-plan render`.

## Where lint fits

Big Plan has two validation layers:

1. The renderer's shared compilation path checks whether the MDX is structurally
   valid and whether every built-in component can compile and render.
2. This directory statically analyzes valid source for additional requirements
   that do not belong to structural compilation.

Lint is not limited to Markdown formatting or presentation.
Rules may enforce any statically analyzable property of a plan, including
content, consistency, conventions, and review quality.
The first rule happens to detect a Markdown table-formatting mistake; it is one
example of the collection rather than the boundary of what lint may check.

The validate command runs those layers in order:

```text
plan.mdx
  -> validateDocument()  structural compilation and in-memory HTML delivery
  -> lintPlan()          authoring rules
  -> validation summary or aggregated lint diagnostics
```

Structural compilation must succeed before lint runs.
`big-plan render` applies the same rules after derivation and before writing,
so a lint finding blocks the review document without changing component
semantics; `big-plan compile` does not call `lintPlan()`.
The integration points are
[`src/cli/validate/command.ts`](../cli/validate/command.ts),
[`src/cli/render/command.ts`](../cli/render/command.ts), and their shared
diagnostic formatting in
[`src/cli/_shared/authoring-lint.ts`](../cli/_shared/authoring-lint.ts).

## Directory responsibilities

| File or folder                   | Responsibility                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `lint-plan.ts`                   | Public deep-module interface. It parses the source once, runs the ordered rule registry, and attaches rule IDs. |
| `types.ts`                       | Private rule and finding contracts plus the public diagnostic shape.                                            |
| `rules/`                         | One focused module per authoring rule.                                                                          |
| `rules/markdown-table-format.ts` | Detects strong Markdown-table intent when a missing or malformed delimiter made GFM parse the rows as prose.    |
| `rules/plan-lede.ts`             | Requires orientation prose between a plan's level-one title and its first section heading.                      |
| `rules/lede-length.ts`           | Keeps the lede within the word budget of a subtitle rather than an opening body paragraph.                      |
| `rules/lede-style.ts`            | Requires that lede to open declaratively rather than with a self-referential phrase like "This plan".           |
| `rules/section-vocabulary.ts`    | Keeps whole-heading section names in Big Plan's opinionated review vocabulary.                                  |
| `rules/title-length.ts`          | Keeps the leading level-one title a punchy noun phrase within word and character budgets.                       |
| `lint-plan.test.ts`              | Exercises the public interface, source positions, diagnostic order, and conservative near misses.               |

`src/lint` is an independent bottom-tier layer in `eslint.config.mjs`.
It must stay framework-free and may not import the renderer, components, or
CLI.
The CLI may call its public interface, but lint never calls upward.

## Rule contract

Every rule implements `PlanLintRule`:

```ts
type PlanLintRule = {
  readonly id: string;
  readonly check: (input: {
    readonly markdown: string;
    readonly tree: Node;
  }) => ReadonlyArray<PlanLintFinding>;
};
```

Rules receive the original source and one shared mdast parse produced with the
same Markdown extensions Big Plan supports.
Use the tree to determine semantic context and the source when exact authored
text or columns matter.
Return findings without a rule ID; `lintPlan()` adds the registered rule's ID
and preserves registry and finding order.

A diagnostic must point to the source location the author should edit and
explain the correction in actionable language.
The validate command formats it as:

```text
line:column [rule-id] message
```

## Adding a rule

1. Add one kebab-case module under `rules/` with a stable kebab-case rule ID.
2. Keep detection and diagnostics in that module; do not add rule logic to the
   CLI.
3. Register the rule in `RULES` in `lint-plan.ts`.
4. Add focused tests through `lintPlan()` for findings, positions, document
   order, and realistic near misses that must remain accepted.
5. Document user-visible behavior in the authoring guide when it changes the
   contract agents need to follow.

Authoring lint should be conservative.
A rule needs a clear, statically testable contract because a false positive
makes a valid plan impossible to validate.
Prefer an objective check with explicit non-findings over a subjective style
opinion.

## The first rule: Markdown table format

GFM recognizes a table only when the header is followed by a valid delimiter
row.
Without that delimiter, the parser produces ordinary paragraph nodes, even
though the rendered plan no longer looks like the table the author intended.
`markdown-table-format` catches that silent presentation failure.

The rule inspects paragraph source for two consecutive outer-pipe rows, which
is the strong table-intent signal.
It ignores valid GFM table nodes, fenced code, blockquotes, complete inline-code
examples, isolated rows, and ordinary prose containing pipes.
Escaped pipes stay inside their cells; pipes preceded by an even run of
backslashes remain separators.

For example:

```md
| Change | Effect |
| Cache responses | Faster reads |
```

produces a diagnostic on the second row with a valid two-column delimiter
example.
