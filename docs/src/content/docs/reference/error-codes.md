---
title: Error codes
description: Every structured error Big Plan raises, which commands raise it, and what to do about it.
---

Every failure is a structured result rather than a stack trace. `axi-sdk-js` maps
`VALIDATION_ERROR` to exit status `2`; success exits `0`, and operational or internal failures
use `1`.

## The codes

| Code                 | Raised by                                          | What it means                                                                                                                   | What to do                                                                                                      |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GUIDANCE_REQUIRED`  | `validate`, `render`, `review`                     | No current guidance acknowledgment for this working directory                                                                   | Run [`big-plan guidance`](/reference/commands/guidance/) in that directory                                      |
| `VALIDATION_ERROR`   | `validate`, `render`, `compile`, `review`, `skill` | A missing or extra argument, an unknown option, an output that would overwrite the input, invalid MDX, or failed authoring lint | Read the `help` entries; they carry every diagnostic as `line:column message`, and lint entries add `[rule-id]` |
| `INVALID_INPUT`      | `review`, `agent`, `service`                       | A malformed option value, an unknown action, or invalid action arguments                                                        | The message carries the usage text for that command                                                             |
| `INPUT_NOT_FOUND`    | `validate`, `render`, `compile`, `review`          | The input file cannot be read                                                                                                   | Check the resolved absolute path in the message                                                                 |
| `NOT_PRIMARY`        | `agent note`, `agent respond`                      | The reviewer made another attached agent the primary for this review                                                            | Stop claiming; the message names the agent that holds the plan now                                              |
| `AGENT_DISCONNECTED` | `agent push`, `agent note`, `agent respond`        | The reviewer disconnected this agent                                                                                            | Terminal — end the session rather than retrying                                                                 |
| `SOURCE_MOVED`       | `agent respond`                                    | The plan no longer carries the revision the candidate started from                                                              | Take the work again from the current plan with `agent next`                                                     |

## Two situations that are not errors

`agent next` reports both of these as ordinary results with a zero exit, because the command
was well formed and there is simply no work to hand over:

- `role: "observer"` — another agent is the primary for this review.
- `role: "disconnected"` — the reviewer took this agent off the review. Terminal even with
  `--wait`.

A harness must branch on these as well as on the codes above. Watching only for `NOT_PRIMARY`
reads the observer result as ordinary "no work" and polls forever.

## What a diagnostic looks like

Structural problems are aggregated and positional:

```text
error: Cannot validate document with invalid MDX
help[3]: "3:1 ESM import/export statements are not supported",
         "5:14 Text expressions are not supported",
         "7:1 Unknown component \"Unknwon\""
```

Lint diagnostics name their own rule:

```text
2:1 [markdown-table-format] Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"
```

## Command-specific messages

If the input argument is missing, `validate`, `render`, `compile`, or `review` raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and its command-specific usage line.

```text
Usage: big-plan validate <input.mdx>
Usage: big-plan render <input.mdx> [output.html]
Usage: big-plan compile <input.mdx> [output.json]
Usage: big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
```

`validate`, `render`, `compile`, and `skill` reject any dash-prefixed command argument as an unknown option. `review` additionally accepts `--diff-preview`, `--idle-timeout <minutes>`, and `--takeover`; it defaults to no idle timeout, `--idle-timeout 0` is the same, and a nonzero timeout must be at least 1 minute.
`validate` and `review` reject a second positional argument; `render` and `compile` reject a third.
Both cases raise a structured `VALIDATION_ERROR`, include the command's usage line, and write no output.
An empty, non-numeric, negative, nonzero sub-minute, or overflowing `review --idle-timeout` value raises a structured `INVALID_INPUT` error.

`agent` rejects an unknown action or invalid action arguments with
`INVALID_INPUT` and its complete multi-line usage text.

`agent note` and `agent respond` raise `NOT_PRIMARY` when the reviewer has made another attached agent the primary for this review, and `AGENT_DISCONNECTED` when the reviewer has disconnected this one.
The message names the agent that holds the plan now, or says the reviewer disconnected this one, and both help entries say to stop the loop rather than retry.
It carries no usage text, because the command was well formed; a harness branches on the code to end a displaced loop cleanly instead of churning.
`agent next` reports the same two situations as ordinary results rather than errors - `role: "observer"` and `role: "disconnected"` - so a harness must branch on those too.

If the input for `validate`, `render`, `compile`, or `review` cannot be read, the command raises a structured `INPUT_NOT_FOUND` error with the resolved absolute input path and the same usage line.
The read error covers any failure to read the input file.

If the output would overwrite the input file, the command raises a structured `VALIDATION_ERROR` with the message `Output path would overwrite the input MDX file` and the command-specific usage line.
The input file is left unchanged.

If parsing or component validation fails, the command raises a structured `VALIDATION_ERROR` with `Cannot validate document with invalid MDX`, `Cannot render document with invalid MDX`, `Cannot compile document with invalid MDX`, or `Cannot review a document with invalid MDX`, according to the command.
Its help entries contain every collected authoring diagnostic as `line:column message`, and no output file is written.

If authoring lint fails, `validate`, `render`, and `review` raise `VALIDATION_ERROR` with `Plan failed authoring lint`.
Each help entry is `line:column [rule-id] message`.
`render` runs lint before writing, and `review` runs it before opening a port.

If guidance has not been acknowledged for the working directory, `validate`, `render`, and `review` raise a structured `GUIDANCE_REQUIRED` error whose help entries name the `big-plan guidance` command and the acknowledgment window.

`axi-sdk-js` maps `VALIDATION_ERROR` to exit status `2`.
Successful validation exits `0`; operational or internal failures use `1`.

## Related

- [Fix a validation error](/authoring/fix-a-validation-error/) — each diagnostic keyed to its edit.
- [Lint rules](/reference/lint-rules/) — every rule's exact boundary.
