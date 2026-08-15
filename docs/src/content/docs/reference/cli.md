---
title: CLI reference
description: Reference the complete Big Plan command surface, defaults, results, and errors.
---

Big Plan exposes seven product commands through the `big-plan` executable: `guidance` for the plan-writing principles, `skill` for the agent skill shell, `validate` for a no-write authoring check, `render` for the human-facing HTML document, `compile` for the machine-facing plan model, `review` for local commenting, and `agent` for the local coding-agent exchange.
The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result serialization.
`axi-sdk-js` also reserves a built-in `update` command for optional package self-update of global installs.

## Commands

```text
big-plan guidance [component]
big-plan skill [write <path>]
big-plan validate <input.mdx>
big-plan render <input.mdx> [output.html]
big-plan compile <input.mdx> [output.json]
big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>]
big-plan agent <input.mdx>
big-plan agent next <input.mdx> [--wait] [--agent <token>]
big-plan agent note <input.mdx> "<progress>" --agent <token>
big-plan agent respond <input.mdx> <response.json> --agent <token>
big-plan update [--check]
```

`guidance` optionally takes one component name.
`skill` with no arguments prints the skill shell; `skill write <path>` writes it only when that action is explicit.
For the plan-file commands `<input.mdx>` is required.
`validate` accepts no output argument.
The output argument is optional for `render` and `compile`.
`update` is the optional `axi-sdk-js` built-in rather than a Big Plan product command.

The equivalent package runner forms are:

```sh
npx big-plan guidance
npx big-plan skill
npx big-plan skill write <path/to/SKILL.md>
npx big-plan validate <input.mdx>
npx big-plan render <input.mdx> [output.html]
npx big-plan compile <input.mdx> [output.json]
npx big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>]
npx big-plan agent <input.mdx>
npx big-plan agent next <input.mdx> --wait [--agent <token>]
npx big-plan agent note <input.mdx> "<progress>" --agent <token>
npx big-plan agent respond <input.mdx> <response.json> --agent <token>
npx big-plan update --check
```

## Guidance and the acknowledgment gate

`guidance` prints the authoring principles for writing a plan a human loves to review.
It deliberately prescribes principles rather than a template, so each plan keeps the structure its content needs.
Running it also records a guidance acknowledgment for the current working directory.

With a component name, `big-plan guidance <Component>` prints that component's judgment-level usage guidance instead: when to reach for it and what belongs in it.
`big-plan guidance Slide` returns every registered slide type and its matching, authoring, component-pairing, and cardinality guidance in one call for the whole plan.
The component form records no acknowledgment, and an unknown name fails with the list of components that have guidance.

`validate`, `render`, and `review` require a current acknowledgment and fail with a structured `GUIDANCE_REQUIRED` error until `guidance` has been run.
An acknowledgment is current when it was recorded for the same working directory within the last 24 hours against the guidance content the installed CLI ships.
Updating Big Plan to a release with changed guidance therefore re-locks all three commands until `guidance` is read again.
`compile`, `skill`, and `agent` are not gated, so machine tooling, skill install, and an already-live agent loop can run without the authoring workflow.

Acknowledgment state lives outside the project: in `.big-plan/` under the user's home directory, falling back to a `big-plan/` directory under the system temporary directory when the home directory rejects writes, as workspace-scoped sandboxes commonly do.
Setting the `BIG_PLAN_STATE_DIR` environment variable pins state to exactly one directory, which test suites and sandboxed environments use to keep state isolated.

When no state location accepts writes at all, the gate degrades instead of blocking: `guidance` still prints the full guidance and notes that the acknowledgment could not be saved, and `validate`, `render`, and `review` proceed while their results carry a warning that the acknowledgment could not be verified.
Filesystem restrictions therefore never lock an agent out of the plan workflow.

## Skill shell

`skill` prints the thin agent skill document embedded in the package (authored at `assets/skill/SKILL.md` and generated into the CLI).
The shell tells agents when to use Big Plan, how to invoke the CLI, and that they must run `big-plan guidance` for live authoring rules.
It does not duplicate plan-writing principles; those stay in `guidance` so package upgrades refresh authoring policy without editing installed skill files.

With no arguments, `skill` returns the Markdown skill text (including harness-oriented frontmatter) and writes nothing.
`skill write <path>` creates parent directories as needed and writes that text to the resolved path.
Write is the only mutation path; unknown options and unknown actions fail with `VALIDATION_ERROR` and leave the filesystem unchanged.
Overwriting an existing file at that path is allowed only because `write` was explicit.

After a package upgrade, new guidance is available immediately via `big-plan guidance`.
Re-run `skill write` only when the thin shell itself changed.
Prefer `npx big-plan@latest` for always-current one-off runs; see [Use the skill](/for-agents/use-the-skill/) for the full update-propagation story.

## Optional global update

`big-plan update --check` reports the installed and latest published versions without installing anything.
Running `big-plan update` without `--check` is opt-in mutation: for a recognized global npm or pnpm install, the built-in updater runs the matching global package-manager upgrade.
Use it only when a global upgrade is wanted; prefer `npx big-plan@latest` for always-current one-off runs.

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

`validate`, `render`, and `compile` choose the document title from the MDX content.
The input filename without its extension is the fallback title.
The reported section count comes from the document's level-two sections.

## The compiled plan model

The JSON written by `compile` is Big Plan's **compiled plan model**: a structured representation intended for agents and tools.
`compile` validates the plan exactly as `render` does - every diagnostic hard-fails both commands identically - and writes that representation as pretty-printed JSON:

- `title`: the document title.
- `sections`: the level-two section outline with `id`, structural `name`, h2 `title`, and optional registered `type`.
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
See [Linting rules](/reference/lint-rules/) for every rule and its conservative matching boundaries.
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

`review` returns the loopback address, resolved plan path, session id, and
feedback directory, then keeps running until `Ctrl+C` or the configured idle
timeout. It owns the local session token, heartbeat, durable review state, and
source snapshots.

`agent <input.mdx>` reads the matching live session and returns the owner-only
prompt plus pasteable Codex and Claude launch commands. Big Plan does not call
a model provider itself. The launched coding-agent session uses:

- `agent next <input.mdx> --wait [--agent <token>]` to receive the oldest pending feedback,
  thread reply, or plan-wide chat question, its prior conversation, a validated
  response template, and the exact publish command;
- `agent note <input.mdx> "<progress>" --agent <token>` to keep the reviewer
  informed as each meaningful work step begins; and
- `agent respond <input.mdx> <response.json> --agent <token>` to publish one
  complete answer after the current MDX has rendered and passed lint.

`agent next` mints the `--agent` token when it hands out a request, and returns
it as `agent_token` together with ready-to-run `note_command` and
`respond_command` strings.
The returned `note_command` includes the progress text `"Working on the request"`, so running it unchanged records that update and renews the claim.
For later meaningful steps, use `agent note <input.mdx> "<progress>" --agent <token>` with a short, specific progress line.
If the agent process restarts while that request remains open, pass the returned token back with `agent next <input.mdx> --agent <token>` to resume the same pickup.
Run the returned `note_command` and `respond_command` strings unchanged.
The token is what proves this agent process holds the request, so a second
agent working the same review cannot narrate over or answer another agent's
work.
Only one request on a plan may hold a live claim, so a second agent waits rather than editing the plan in parallel.
Without `--wait`, `agent next` reports that no work is available while another claim is live.
With `--wait`, it continues once the holder answers or its lease lapses.
This serialization prevents ordinary concurrent unfenced plan writers; a lapsed lease during a long edit can still interleave plan writes until write fencing exists.
When a lapsed lease is taken over, the reviewer is warned that the previous agent's partial plan edits may be present.

Set the `BIG_PLAN_AGENT_MODEL` environment variable before running `agent
next` or `agent note` to report which model is connected, for example `Grok
4.6`.
Use a non-empty model name of at most 80 characters.
`agent next` stores the reported name with the durable per-pickup claim, and `agent note` preserves or refreshes that claim identity.
The reviewer's browser reads the model from the live claim, so a waiting agent's heartbeat cannot relabel another agent's active request.

A `changed` outcome is accepted only when the result snapshot differs and every
named target belongs to the computed snapshot diff. Other outcomes are
`answered`, `warning`, `needs-input`, and `declined`; a warning makes no edit,
must carry a short scannable `summary` of the boundary it would cross,
and waits for explicit reviewer confirmation. **What changed** uses retained
premise, claim-time baseline, and result snapshots rather than DOM mutation.
The temporary development-only `review --diff-preview` flag seeds a synthetic
gallery answer through that same pipeline and marks the browser with a visible
preview banner.

`guidance` returns the guidance Markdown itself rather than a structured result.
`skill` with no arguments returns the skill Markdown the same way.
`skill write` returns:

- `written`: the absolute output path.
- `help`: a reminder that authoring rules still come from `guidance`, and when to re-run `skill write`.

## Errors

If the input argument is missing, `validate`, `render`, `compile`, or `review` raises a structured `VALIDATION_ERROR` with the message `Missing input MDX file` and its command-specific usage line.

```text
Usage: big-plan validate <input.mdx>
Usage: big-plan render <input.mdx> [output.html]
Usage: big-plan compile <input.mdx> [output.json]
Usage: big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>]
```

`validate`, `render`, `compile`, and `skill` reject any dash-prefixed command argument as an unknown option. `review` additionally accepts `--diff-preview` and `--idle-timeout <minutes>`; it defaults to 30 minutes, zero disables the idle timeout, and a nonzero timeout must be at least 1 minute.
`validate` and `review` reject a second positional argument; `render` and `compile` reject a third.
Both cases raise a structured `VALIDATION_ERROR`, include the command's usage line, and write no output.
An empty, non-numeric, negative, nonzero sub-minute, or overflowing `review --idle-timeout` value raises a structured `INVALID_INPUT` error.

`agent` rejects an unknown action or invalid action arguments with
`INVALID_INPUT` and its complete multi-line usage text.

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

## Top-level help and version

The CLI configures top-level help that lists the product commands and the derived-output defaults; `axi-sdk-js` appends the built-in update commands.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.
