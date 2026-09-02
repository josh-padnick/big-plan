---
title: big-plan render
description: Write a self-contained HTML review document from a plan.
---

## Synopsis

```text
big-plan render <input.mdx> [output.html]
```

## Arguments

| Argument | Required | Behaviour |
| --- | --- | --- |
| `input.mdx` | Yes | The plan to render, resolved against the current working directory and read as UTF-8 |
| `output.html` | No | Where to write. Defaults to the input path with its extension replaced by `.html`, so the output sits next to the input |

## Options

`render` accepts no options. Any dash-prefixed argument is rejected as an unknown option, and a
third positional argument is rejected.

## Paths

The CLI resolves the input path against the current working directory.
It reads the input as UTF-8 text.

When the output argument is omitted, `render` replaces the input filename extension with `.html` and `compile` replaces it with `.model.json`.
An input without an extension receives the suffix at the end.
The default output therefore sits next to the input.

When the output argument is present, the CLI resolves it against the current working directory.
It creates the output file's parent directories recursively before writing UTF-8 HTML or JSON.
Neither derived-output command permits the output to resolve to the input file, including through a symbolic link or hard link, so derived output cannot overwrite the canonical MDX source.

## Document metadata

`validate`, `render`, and `compile` choose the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the document's level-two sections.

## Result

- `rendered`: the absolute output path.
- `title`: the rendered document title.
- `sections`: the number of rendered sections.
- `help`: an instruction to open the absolute output path in a browser.

## What it writes

One self-contained HTML file with embedded styles, fonts, and branding. It makes no external
requests, and it stays fully readable with JavaScript disabled. Plan-authored code never
executes: imports, exports, expressions, and inline JSX are compile errors rather than
evaluated content.

`render` applies the same linting rules as `validate` after derivation and before writing, so a
plan that fails lint never becomes a review document.

If an approval is in force beside the plan and pins the exact source being rendered, the
document carries the approved stamp; hovering it shows when it was approved and which version
it pinned. An unapproved, revoked, or stale plan renders no stamp at all.

## Errors

| Code | Raised when | Exit |
| --- | --- | --- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours | 2 |
| `VALIDATION_ERROR` | The input argument is missing, a third positional argument is present, the output would overwrite the input, the MDX is invalid, or the plan fails authoring lint | 2 |
| `INPUT_NOT_FOUND` | The input cannot be read; the message carries the resolved absolute path | 1 |

An invalid document never renders partially, and no output file is written in any of these
cases.

## Troubleshooting

- **It wrote nothing and exited 2.** Read the `help` entries; they carry every diagnostic.
  Fix them all and run again, because rendering is all-or-nothing.
- **You expected a live review, not a file.** `render` writes a static document with no
  commenting and no agent exchange. Use [`review`](/reference/commands/review/) for that.
- **The page looks wrong even though the command succeeded.** Rendering in memory is not visual
  review; browser layout and readability still need a human. Reread the rendered document.
- **The output would overwrite the plan.** Neither derived-output command permits that,
  including through a symbolic or hard link. Choose another output path.

## Related

- [Your first review](/intro/first-review/) — the end-to-end walkthrough.
- [Fix a validation error](/authoring/fix-a-validation-error/) — every diagnostic, keyed to its edit.
