---
title: CLI reference
description: Reference the complete Big Plan command surface, defaults, results, and errors.
---

Big Plan exposes four commands through the `big-plan` executable: `guidance` for the plan-writing principles, `validate` for a no-write authoring check, `render` for the human-facing HTML document, and `compile` for the machine-facing plan model.
The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result serialization.

## Commands

```text
big-plan guidance [component]
big-plan validate <input.mdx>
big-plan render <input.mdx> [output.html]
big-plan compile <input.mdx> [output.json]
```

`guidance` optionally takes one component name.
For the other commands `<input.mdx>` is required.
`validate` accepts no output argument.
The output argument is optional for `render` and `compile`.

The equivalent package runner forms are:

```sh
npx big-plan guidance
npx big-plan validate <input.mdx>
npx big-plan render <input.mdx> [output.html]
npx big-plan compile <input.mdx> [output.json]
```

## Guidance and the acknowledgment gate

`guidance` prints the authoring principles for writing a plan a human loves to review.
It deliberately prescribes principles rather than a template, so each plan keeps the structure its content needs.
Running it also records a guidance acknowledgment for the current working directory.

With a component name, `big-plan guidance <Component>` prints that component's judgment-level usage guidance instead: when to reach for it and what belongs in it.
The component form records no acknowledgment, and an unknown name fails with the list of components that have guidance.

`validate` and `render` require a current acknowledgment and fail with a structured `GUIDANCE_REQUIRED` error until `guidance` has been run.
An acknowledgment is current when it was recorded for the same working directory within the last 24 hours against the guidance content the installed CLI ships.
Updating Big Plan to a release with changed guidance therefore re-locks both commands until `guidance` is read again.
`compile` is not gated, so machine tooling can compile a plan model without the authoring workflow.

Acknowledgment state lives outside the project: in `.big-plan/` under the user's home directory, falling back to a `big-plan/` directory under the system temporary directory when the home directory rejects writes, as workspace-scoped sandboxes commonly do.
Setting the `BIG_PLAN_STATE_DIR` environment variable pins state to exactly one directory, which test suites and sandboxed environments use to keep state isolated.

When no state location accepts writes at all, the gate degrades instead of blocking: `guidance` still prints the full guidance and notes that the acknowledgment could not be saved, and `validate` and `render` proceed while their results carry a warning that the acknowledgment could not be verified.
Filesystem restrictions therefore never lock an agent out of the plan workflow.

## Input and output paths

The CLI resolves the input path against the current working directory.
It reads the input as UTF-8 text.

When the output argument is omitted, `render` replaces the input filename extension with `.html` and `compile` replaces it with `.model.json`.
An input without an extension receives the suffix at the end.
The default output therefore sits next to the input.

When the output argument is present, the CLI resolves it against the current working directory.
It creates the output file's parent directories recursively before writing UTF-8 HTML or JSON.
Neither derived-output command permits the output to resolve to the input file, including through a symbolic link or hard link, so derived output cannot overwrite the canonical MDX source.

## Document metadata

All three commands choose the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the document's level-two sections.

## The compiled plan model

The JSON written by `compile` is Big Plan's **compiled plan model**: a structured representation intended for agents and tools.
`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes that representation as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with ids and text.
- `components`: every component instance in document order, each with its `component` name, source `line` and `column`, and its compiled `model` - the same typed model the renderer consumes, so structure can never drift from rendering.

Prose fields inside models (context paragraphs, option bodies) are HAST subtrees: plain JSON objects describing the markdown content.
Generated element ids inside models match the ids in the rendered HTML, so a tool can link a model entry to its rendered element.

## Validation and linting

`validate` reads and checks the plan without choosing an output path, creating a directory, or writing a file.
It performs three checks:

1. The shared static-subset MDX and component compiler accepts the authored structure.
2. Big Plan renders the complete HTML document in memory, including React component presentation, Markdown transforms, shell composition, and serialization.
3. The authored plan passes every registered linting rule.

Lint is intentionally stricter than structural compilation.
`render` applies the same linting rules after derivation and before writing, so a plan that fails lint never becomes a review document; `compile` continues to accept legal Markdown that a quality rule flags.
See [Authoring plans](/for-agents/authoring-plans/) for the linting rules and their conservative matching boundaries.
Rendering the document in memory does not replace visual review: browser layout, readability, and whether the page matches author intent still require a human.

## Successful results

On success, each command returns a structured result for `axi-sdk-js` to serialize.
`render` returns:

- `rendered`: the absolute output path.
- `title`: the rendered document title.
- `sections`: the number of rendered sections.
- `help`: an instruction to open the absolute output path in a browser.

`compile` returns:

- `compiled`: the absolute output path.
- `title`: the document title.
- `sections` and `components`: the counts collected.
- `help`: a description of what the JSON holds.

`validate` returns:

- `validated`: the absolute input path.
- `title`: the document title.
- `sections` and `components`: the validated counts.
- `help`: a reminder that lint checks only what is statically analyzable, so the rendered document still needs rereading against the `guidance` principles.

It writes no output.

`guidance` returns the guidance Markdown itself rather than a structured result.

## Errors

If the input argument is missing, any command raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and its command-specific usage line.

```text
Usage: big-plan validate <input.mdx>
Usage: big-plan render <input.mdx> [output.html]
Usage: big-plan compile <input.mdx> [output.json]
```

Any dash-prefixed token is rejected as an unknown option.
`validate` rejects a second positional argument; `render` and `compile` reject a third.
Both cases raise a structured `VALIDATION_ERROR`, include the command's usage line, and write no output.

If the input cannot be read, the command raises a structured `INPUT_NOT_FOUND` error with the resolved absolute input path and the same usage line.
The read error covers any failure to read the input file.

If the output would overwrite the input file, the command raises a structured `VALIDATION_ERROR` with the message `Output path would overwrite the input MDX file` and the command-specific usage line.
The input file is left unchanged.

If parsing or component validation fails, the command raises a structured `VALIDATION_ERROR` with `Cannot validate document with invalid MDX`, `Cannot render document with invalid MDX`, or `Cannot compile document with invalid MDX`, according to the command.
Its help entries contain every collected authoring diagnostic as `line:column message`, and no output file is written.

If authoring lint fails, `validate` and `render` raise `VALIDATION_ERROR` with `Plan failed authoring lint`.
Each help entry is `line:column [rule-id] message`.
`render` runs lint before writing, so a lint failure leaves no output file.

If guidance has not been acknowledged for the working directory, `validate` and `render` raise a structured `GUIDANCE_REQUIRED` error whose help entries name the `big-plan guidance` command and the acknowledgment window.

`axi-sdk-js` maps `VALIDATION_ERROR` to exit status `2`.
Successful validation exits `0`; operational or internal failures use `1`.

## Top-level help and version

The CLI configures top-level help that lists all four commands and the derived-output defaults.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.
