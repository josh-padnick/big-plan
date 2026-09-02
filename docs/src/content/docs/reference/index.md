---
title: Reference
description: Every Big Plan command, error code, lint rule, environment variable, and file, for looking up rather than reading.
---

This section is for looking things up. It instructs nowhere; where a page would tell you how
to do something, it links to the page in [Review a plan](/review/) or
[Write a plan](/authoring/) that owns that job.

## The command map

Big Plan exposes seven product commands through the `big-plan` executable, plus the local
review-link service and the package runner's built-in updater.

| Command | Reach for it when |
| --- | --- |
| [`guidance`](/reference/commands/guidance/) | You are about to write a plan, or a gated command told you no |
| [`skill`](/reference/commands/skill/) | A harness wants a discoverable `SKILL.md` |
| [`validate`](/reference/commands/validate/) | You want to know whether a plan is renderable and clean, writing nothing |
| [`render`](/reference/commands/render/) | You want one self-contained HTML document you can send by path |
| [`compile`](/reference/commands/compile/) | A tool needs the plan as machine-readable JSON |
| [`review`](/reference/commands/review/) | A person is going to read, comment on, and approve the plan |
| [`agent`](/reference/commands/agent/) | A coding-agent session is answering a live review |
| [`service`](/reference/commands/service/) | A saved review link stopped resolving |

The CLI uses `axi-sdk-js` for dispatch, help, version output, structured errors, and result
serialization, which is also where the built-in `update` command comes from.

## Every form

```text
big-plan guidance [component]
big-plan skill [write <path>]
big-plan validate <input.mdx>
big-plan render <input.mdx> [output.html]
big-plan compile <input.mdx> [output.json]
big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
big-plan service status|start|stop|restart
big-plan agent <input.mdx>
big-plan agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]
big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
big-plan update [--check]
```

`guidance` optionally takes one component name.
`skill` with no arguments prints the skill shell; `skill write <path>` writes it only when that action is explicit.
For the plan-file commands `<input.mdx>` is required.
`validate` accepts no output argument.
The output argument is optional for `render` and `compile`.
`service` takes one action and no plan file; with no action it reports status.
`update` is the optional `axi-sdk-js` built-in rather than a Big Plan product command.

The equivalent package runner forms are:

```sh
npx -y big-plan@latest guidance
npx -y big-plan@latest skill
npx -y big-plan@latest skill write <path/to/SKILL.md>
npx -y big-plan@latest validate <input.mdx>
npx -y big-plan@latest render <input.mdx> [output.html]
npx -y big-plan@latest compile <input.mdx> [output.json]
npx -y big-plan@latest review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
npx -y big-plan@latest service status
npx -y big-plan@latest agent <input.mdx>
npx -y big-plan@latest agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]
npx -y big-plan@latest agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
npx -y big-plan@latest agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
npx -y big-plan@latest agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
npx -y big-plan@latest update --check
```

## Section guide

| Read this | When |
| --- | --- |
| A command page above | You need one command's arguments, options, result, or errors |
| [Error codes](/reference/error-codes/) | You have a code and want to know what raises it |
| [Lint rules](/reference/lint-rules/) | A lint diagnostic surprised you and you want its exact boundary |
| [Configuration and state](/reference/configuration/) | You need an environment variable or a state directory |
| [The compiled plan model](/reference/plan-model/) | You are consuming `compile` output |
| [Files Big Plan writes](/reference/files/) | You want to know what appears on your disk |

## Top-level help and version

The CLI configures top-level help that lists the product commands and the derived-output defaults; `axi-sdk-js` appends the built-in update commands.
It also reads the package version for version output.
If that version cannot be read from the package metadata, version reporting is left unconfigured instead of crashing the CLI.

## Next

[Error codes](/reference/error-codes/) — every structured error in one table.
