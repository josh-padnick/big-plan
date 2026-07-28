---
title: CLI reference
description: Reference the complete Big Plan command surface, defaults, results, and errors.
---

Big Plan exposes two commands through the `big-plan` executable: `render` for the human-facing HTML document, and `compile` for the machine-facing plan model.
The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result serialization.

## Commands

```text
big-plan render <input.mdx> [output.html] [--renderer vanilla|react]
big-plan compile <input.mdx> [output.json]
```

`<input.mdx>` is required.
The output argument is optional for both commands.

The equivalent package runner forms are:

```sh
npx big-plan render <input.mdx> [output.html] [--renderer vanilla|react]
npx big-plan compile <input.mdx> [output.json]
```

## Input and output paths

The CLI resolves the input path against the current working directory.
It reads the input as UTF-8 text.

`render` accepts an experimental `--renderer` flag (`vanilla`, the default, or `react`) selecting the implementation that renders plan components; both `--renderer react` and `--renderer=react` forms are accepted.
The React target is being ported component by component; components without a React port fall back to the vanilla renderer, and a ported component's output is test-pinned byte-identical between the two, so the flag never changes what a document looks like.

When the output argument is omitted, `render` replaces the input filename extension with `.html` and `compile` replaces it with `.model.json`.
An input without an extension receives the suffix at the end.
The default output therefore sits next to the input.

When the output argument is present, the CLI resolves it against the current working directory.
It creates the output file's parent directories recursively before writing UTF-8 HTML or JSON.
Neither command permits the output to resolve to the input file, including through a symbolic link or hard link, so derived output cannot overwrite the canonical MDX source.

## Document metadata

Both commands choose the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the document's level-two sections.

## The compiled plan model

`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes the validated plan model as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with ids and text.
- `components`: every component instance in document order, each with its `component` name, source `line` and `column`, and its compiled `model` - the same typed model the renderer consumes, so structure can never drift from rendering.

Prose fields inside models (context paragraphs, option bodies) are HAST subtrees: plain JSON objects describing the markdown content.
Generated element ids inside models match the ids in the rendered HTML, so a tool can link a model entry to its rendered element.

## Successful results

After writing the file, each command returns a structured result for `axi-sdk-js` to serialize.
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

## Errors

If the input argument is missing, either command raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and its command-specific usage line.

```text
Usage: big-plan render <input.mdx> [output.html] [--renderer vanilla|react]
Usage: big-plan compile <input.mdx> [output.json]
```

If `--renderer` has no value, `render` raises a structured `VALIDATION_ERROR` with the message `Missing value for --renderer`.
If its value is not `vanilla` or `react`, `render` instead reports `Unknown renderer "<value>" - expected vanilla or react`.
Both errors include the `render` usage line, and no output file is written.

If the input cannot be read, the command raises a structured `INPUT_NOT_FOUND` error with the resolved absolute input path and the same usage line.
The read error covers any failure to read the input file.

If the output would overwrite the input file, the command raises a structured `VALIDATION_ERROR` with the message `Output path would overwrite the input MDX file` and the command-specific usage line.
The input file is left unchanged.

If parsing or component validation fails, the command raises a structured `VALIDATION_ERROR` with `Cannot render document with invalid MDX` or `Cannot compile document with invalid MDX`, according to the command.
Its help entries contain every collected authoring diagnostic as `line:column message`, and no output file is written.

## Top-level help and version

The CLI configures top-level help that lists both commands and their default output behavior.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.
