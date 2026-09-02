---
title: For agents
description: Everything a coding agent needs to operate Big Plan - setup, the session loop, the CLI contract, and the Markdown endpoints.
---

This page is written for coding agents, not people. It carries operational steps, exact
commands, and machine-readable endpoints, with none of the context a human reader wants.

If you are a human, [How it works](/review/) covers the same ground for you. Reading on anyway
is a fine way to audit exactly what your agent is told.

## Read these docs as Markdown

Every page on this site is published twice: as HTML for humans, and as clean Markdown for you.
**Do not scrape the HTML pages.**

| Endpoint                           | What it returns                                                                                                | Fetch it when                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`/llms.txt`](/llms.txt)           | A curated map of every page, grouped by section, with one-line descriptions and links to each page's `.md` URL | You want to discover what documentation exists           |
| Any page path + `.md`              | That single page as raw Markdown                                                                               | You need specific pages and want to spend minimal tokens |
| [`/llms-full.txt`](/llms-full.txt) | The complete documentation concatenated into one Markdown document                                             | You want everything in one request                       |

Replace a page's trailing slash with `.md`:

```text
https://bigplan.dev/intro/installation/      ->  https://bigplan.dev/intro/installation.md
https://bigplan.dev/reference/error-codes/   ->  https://bigplan.dev/reference/error-codes.md
https://bigplan.dev/authoring/slide-types/   ->  https://bigplan.dev/authoring/slide-types.md
```

Each `.md` response starts with frontmatter carrying `title`, `description`, and `canonical`,
followed by a clean Markdown projection that removes presentation-only MDX. Fetch
[`/llms.txt`](/llms.txt) once to see the map, fetch the `.md` URLs your task needs, and fall
back to [`/llms-full.txt`](/llms-full.txt) only when you genuinely need the whole corpus.

## Guidance is the live instruction source

`big-plan guidance` prints the plan-writing principles, and it is the **only** place they live.
It changes with the product, so run it each session rather than copying it into chat memory,
project `AGENTS.md`, or a hand-maintained skill fork.

| Surface                         | Content                                                                     | Authority                         |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `big-plan skill`                | When to use Big Plan, how to invoke the CLI, and that you must run guidance | Stable; rare edits                |
| `big-plan guidance`             | Plan-writing principles                                                     | Changes with product quality work |
| `big-plan guidance <Component>` | Per-component usage judgment                                                | Changes with component design     |
| `big-plan guidance Slide`       | The complete slide-type catalog, in one call                                | Changes with the catalog          |

Reading `guidance` records an acknowledgment **for the current working directory**, valid for 24
hours against the guidance content your installed CLI ships. `validate`, `render`, and `review`
fail with `GUIDANCE_REQUIRED` until it has been read. `compile`, `skill`, and `agent` are not
gated, so machine tooling and an already-live loop keep working.

## Set Big Plan up for your human

Do this once, when asked. Big Plan needs Node.js 22 or newer.

1. **Confirm the CLI runs.** This installs nothing globally and is the primary convention:

   ```sh
   npx -y big-plan@latest --version
   ```

   If your human explicitly prefers a global install: `npm install -g big-plan@latest`.

2. **Install the skill shell** into the harness path your human uses:

   ```sh
   npx -y big-plan@latest skill                       # print it
   npx -y big-plan@latest skill write <path/to/SKILL.md>   # install it
   ```

   `skill write` creates missing parent directories and writes to the exact path you give.
   It is the only mutation path, and there is no silent overwrite — inspect an existing
   destination before replacing it.

3. **Add the workflow rule** to the project's agent instructions file (`AGENTS.md`,
   `CLAUDE.md`, or equivalent) so future sessions keep it:

   ```text
   Before implementing a feature: run `npx -y big-plan@latest guidance` and follow
   it, write your implementation plan to plan.mdx, run
   `npx -y big-plan@latest validate plan.mdx` until clean, start the live review
   with `npx -y big-plan@latest review plan.mdx`, and give the human the stable
   127.0.0.1 plan address printed by the command. Do not implement until the plan
   is approved. Prefer the Big Plan skill shell
   (`npx -y big-plan@latest skill`) when the harness supports skills; do not
   re-copy long guidance into this file.
   ```

4. **Report back**: the CLI version, where you wrote the skill, where you added the rule, and
   offer to start a live review for the first plan.

## The session loop

1. `npx -y big-plan@latest guidance` — and follow it. Also run `guidance Slide` once, and
   `guidance <Component>` before reaching for a component you have not used.
2. Author the plan as MDX on disk. See [Write a plan](/authoring/) for what the format accepts.
3. `npx -y big-plan@latest validate <plan.mdx>` until clean.
4. `npx -y big-plan@latest review <plan.mdx>`.
5. Give your human the **stable** plan address the command prints — the `review:` line. The
   `direct:` line is for debugging only.
6. Wait for approval. Do not start implementing.
7. When the mailbox returns an `approval` request, re-read `planPath`, verify its digest equals
   `pinnedSnapshot`, acknowledge **without editing the plan**, and begin execution.
   A missing path, a missing file, or a digest mismatch is a **hard stop**: report it through
   the response by adding `hardStop` — one line naming what you found — and do not search for
   another copy.

For a portable artifact instead of a live review,
`npx -y big-plan@latest render plan.mdx` writes a self-contained `plan.html` next to the source.
Give the human that absolute path or a `file://` URL. It does not replace the live review.

## Answering reviewer feedback

Your human runs `big-plan agent <plan.mdx>` and starts one of the pasteable commands it returns.
From there:

```sh
npx -y big-plan@latest agent next plan.mdx --wait
```

It hands back the oldest pending request, its prior conversation, a validated response template,
`candidate_plan` — **this claim's own copy of the plan, and the only repository file you edit** —
and ready-to-run `note_command`, `respond_command`, and `next_command` strings.

**Run the returned command strings unchanged.** They carry the `--agent` and `--connection`
tokens back, which is what lets the reviewer see one agent across a whole conversation instead of
a new one at every command.

Then:

- `agent note plan.mdx "<progress>" --agent <token>` as each meaningful step begins. After 75
  seconds of silence the reviewer's thread reads **No progress for \_N_m**.
- Edit `candidate_plan`, never the plan path. Validate it until it renders and passes lint.
- `agent respond plan.mdx <response.json> --agent <token>` to publish. It re-proves the claim,
  requires the plan to still carry the revision your candidate started from, and swaps it in with
  one atomic rename.
- Run the `next` command `respond` returns, unchanged. A bare `agent next` after publishing mints
  a new identity and attaches you as an observer of the turn you just finished.

`agent push --prompt "<their words>"` or `--about "<your words>"` opens a thread without waiting
to be asked. Exactly one of the two is required, because the stored origin decides whose words
the review presents.

**Keep the connector in the foreground.** It hands its work item back on stdout and ends when the
process that started it ends; backgrounding or detaching it breaks that handoff.

## When the reviewer moves you aside

One agent answers a review at a time. The first connector is the **primary**; every later one
attaches as an **observer** that can read the plan and do nothing else. The same situation
reaches you as an error from some commands and an ordinary result from another — **branch on
both**, or your loop polls forever.

| What you get           | From                            | What to do                                            |
| ---------------------- | ------------------------------- | ----------------------------------------------------- |
| `role: "observer"`     | `agent next`                    | Without `--wait`, exit. With `--wait`, keep asking    |
| `NOT_PRIMARY`          | `agent note`, `agent respond`   | Stop claiming; the message names who holds the plan   |
| `role: "disconnected"` | `agent next`                    | Terminal, even with `--wait`. Stop the loop           |
| `AGENT_DISCONNECTED`   | `agent push`, `note`, `respond` | Terminal. Stop rather than retrying                   |
| `SOURCE_MOVED`         | `agent respond`                 | The plan moved. Take the work again with `agent next` |

Displaced or disconnected, your unpublished edits stay in your own copy and the reviewer's
comments are untouched. The disconnect is a message, not a kill: you are told at your next
command and end your own session there.

## Declare who you are

Export any of these before your first command. They are optional and independent — declare only
what you can answer, and the reviewer is shown exactly those.

| Variable                     | What it declares                                      | Limit       |
| ---------------------------- | ----------------------------------------------------- | ----------- |
| `BIG_PLAN_AGENT_MODEL`       | Your API's own canonical model id, e.g. `grok-4.6`    | 80 chars    |
| `BIG_PLAN_AGENT_EFFORT`      | How hard the model was told to think, e.g. `high`     | 24 chars    |
| `BIG_PLAN_AGENT_CLIENT`      | Which tool is connected, e.g. `grok-cli 0.2.99`       | 80 chars    |
| `BIG_PLAN_AGENT_SESSION_URL` | Your own conversation address                         | 2,048 chars |
| `BIG_PLAN_AGENT_SESSION`     | That conversation's opaque id, when it has no address | 120 chars   |

## The CLI contract

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
big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>]
big-plan agent note <input.mdx> "<progress>" --agent <token>
big-plan agent respond <input.mdx> <response.json> --agent <token>
```

Every failure is a structured result, not a stack trace. `VALIDATION_ERROR` exits `2`; success
exits `0`; operational failures use `1`. [Error codes](/reference/error-codes/) is the full
table, and [Reference](/reference/) has one page per command with its own troubleshooting.

## How updates reach you

1. Use `npx -y big-plan@latest`, or upgrade an explicitly chosen project or global install.
2. New guidance arrives on the next `big-plan guidance`. Nothing else is needed.
3. Re-run `skill write <path>` only when the thin skill shell itself changed.

Failure modes worth knowing: a lockfile or version pin keeps old guidance, so bump or use
`@latest` when freshness matters; offline, the installed binary still embeds matching skill text
and guidance for that version; and a hand-edited skill fork drifts, so re-print from the CLI and
prefer the package as the source of truth.

The authored skill file is `assets/skill/SKILL.md` in the repository, embedded into the package
by `scripts/gen-skill.mjs` so `big-plan skill` cannot disagree with the published CLI version.

## Related

- [Write a plan](/authoring/) — what the plan format accepts, and every diagnostic keyed to its fix.
- [Reference](/reference/) — one page per command.
- [/setup.md](/setup.md) — this page's setup section at a stable address, for the install prompt.
