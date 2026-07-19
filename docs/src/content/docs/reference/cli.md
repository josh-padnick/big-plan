---
title: CLI reference
description: Reference the complete Big Plan command surface, defaults, results, and errors.
---

Big Plan exposes one rendering command through the `big-plan` executable.
The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result serialization.

## Command

```text
big-plan render <input.mdx> [output.html]
```

`<input.mdx>` is required.
`[output.html]` is optional.

The equivalent package runner form is:

```sh
npx big-plan render <input.mdx> [output.html]
```

## Input and output paths

The CLI resolves the input path against the current working directory.
It reads the input as UTF-8 text.

When the output argument is omitted, the CLI replaces the input filename extension with `.html`.
An input without an extension receives `.html` at the end.
The default output therefore sits next to the input.

When the output argument is present, the CLI resolves it against the current working directory.
It creates the output file's parent directories recursively before writing UTF-8 HTML.

## Document metadata

The renderer chooses the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the rendered document's level-two sections.

## Successful result

After writing the file, the command returns a structured result for `axi-sdk-js` to serialize.
The result contains:

- `rendered`: the absolute output path.
- `title`: the rendered document title.
- `sections`: the number of rendered sections.
- `help`: an instruction to open the absolute output path in a browser.

## Errors

If the input argument is missing, the command raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and the usage line.

```text
Usage: big-plan render <input.mdx> [output.html]
```

If the input cannot be read, the command raises a structured `INPUT_NOT_FOUND` error with the resolved absolute input path and the same usage line.
The read error covers any failure to read the input file.

If parsing or component validation fails, the command raises a structured `VALIDATION_ERROR` with the message `Cannot render document with invalid MDX`.
Its help entries contain every collected authoring diagnostic as `line:column message`, and no output file is written.

## Top-level help and version

The CLI configures top-level help that lists the render command and its default output behavior.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.
