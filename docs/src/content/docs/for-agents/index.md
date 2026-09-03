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
https://bigplan.dev/review/                  ->  https://bigplan.dev/review.md
https://bigplan.dev/components/              ->  https://bigplan.dev/components.md
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
hours against the guidance content your installed CLI ships. When acknowledgment state is
writable, `validate`, `render`, and `review` fail with `GUIDANCE_REQUIRED` until guidance has been
read. If no state directory is writable, they continue with a warning instead. `compile`, `skill`,
and `agent` are not gated, so machine tooling and an already-live loop keep working.

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
2. Author the plan as MDX on disk. See [Write a plan](/for-agents/#what-a-plan-may-contain) for what the format accepts.
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

## What a plan may contain

A plan is one MDX file: standard Markdown plus GFM tables, task lists, footnotes, and literal
autolinks, plus components from the built-in [registry](/components/) and their scoped children.
Component attributes are strings (`title="Rollout"`) or bare shorthand booleans
(`showLineNumbers`). A self-closing [`Slide`](/components/slide/) marker may sit directly above a
top-level h2 to apply one registered slide type.

**What a plan may not contain**, each a hard error rather than something evaluated:

- `import` and `export` statements.
- `{expression}` syntax, in components or inline, including `{/* comments */}`.
- Inline (text-level) JSX; components must stand alone at flow level.
- Unknown component names, unknown attributes, spread attributes, expression-valued attributes,
  and duplicate attributes.
- Four-space indented code blocks; MDX treats indented text as paragraphs, so always fence.
- HTML comments and angle-bracket `<url>` autolinks.

Because `<` and `{` begin MDX syntax, write them in code spans or fences when you need them
literally in prose.

### The shape a plan takes

Title (a punchy noun phrase, at most eight words) → lede (one declarative sentence, at most
thirty words) → `QuickSummary` (exactly one, with `Why`, `What`, and optionally `How`) →
`TableOfContents` (one `Entry` per section, in order) → `Part` markers dividing about three acts
→ one h2 per slide, each carrying one thought at roughly one screen → a verification contract
near the end.

Everything after the quick summary is elaboration; nothing essential should appear for the first
time in a later section. `big-plan guidance` owns the judgment behind every one of those choices.

## Slide types

Five registered types live at `src/plan-vocabulary/slide-types/definitions/`. Run
`big-plan guidance Slide` once before drafting for the complete catalog with its authoring
advice; that command ships with your installed CLI and is the version to trust.

| Type                  | Cardinality | Use it when                                                             |
| --------------------- | ----------- | ----------------------------------------------------------------------- |
| `status-quo`          | once        | The slide establishes what is true today, including what already works  |
| `desired-experience`  | once        | The plan adds a feature and the slide describes the lived change        |
| `desired-outcome`     | once        | The plan fixes, re-architects, or pays down debt, and states the result |
| `user-journey`        | repeatable  | The slide follows one person through one complete goal                  |
| `acceptance-criteria` | once        | The slide is the checkable contract proving the work is complete        |

`desired-experience` and `desired-outcome` may not both appear. A typed user journey must nest
inside a `Part` named as its container, must keep a distinct `name` and `toc` form, and must
carry either `Wireframe` mockups or a non-empty `wireframeReason` — never both. Typed coverage is
not a quality target: when no type fits, author an untyped slide.

## Fix a validation error

`big-plan validate <plan.mdx>` is the correction loop. Structural problems are aggregated and
positional; lint diagnostics name their own rule as `line:column [rule-id] message`. An MDX
syntax error can stop parsing before component validation begins, so fix that and run again to
see the rest.

### Error codes

| Code                 | Raised by                                          | What to do                                                            |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `GUIDANCE_REQUIRED`  | `validate`, `render`, `review`                     | Run `big-plan guidance` in that working directory                     |
| `VALIDATION_ERROR`   | `validate`, `render`, `compile`, `review`, `skill` | Read the `help` entries; every diagnostic is there. Exit 2            |
| `INVALID_INPUT`      | `review`, `agent`, `service`                       | A malformed option value or unknown action; the message carries usage |
| `INPUT_NOT_FOUND`    | `validate`, `render`, `compile`, `review`          | Check the resolved absolute path in the message                       |
| `NOT_PRIMARY`        | `agent note`, `agent respond`                      | Stop claiming; the reviewer moved the seat                            |
| `AGENT_DISCONNECTED` | `agent push`, `note`, `respond`                    | Terminal; end the session                                             |
| `SOURCE_MOVED`       | `agent respond`                                    | The plan moved; take the work again with `agent next`                 |

### Lint rules

Lint is a stricter layer applied once structural compilation succeeds. `render` applies it before
writing and `review` before opening a port, so a plan that fails lint never reaches a reviewer.
The rules cover the title and lede budgets, one `QuickSummary`, slide-type structure, grouping
past eight items, a title before any figure, no subtitle restating its heading, the table of
contents matching its sections, table delimiter rows, and two wireframe rules.

[Lint rules](/reference/lint-rules/) is the exhaustive reference, including what each rule
deliberately leaves alone.

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
big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
```

Every failure is a structured result, not a stack trace. `VALIDATION_ERROR` exits `2`; success
exits `0`; operational failures use `1`. [Error codes](/for-agents/#error-codes) is the full
table, and [Reference](/reference/commands/render/) has one page per command with its own troubleshooting.

## The compiled plan model

`big-plan compile` writes a structured representation for tools:

- `title`: the document title.
- `sections`: the level-two outline, each with `id`, structural `name`, h2 `title`, and optional
  registered `type`.
- `components`: every instance in document order, each with its `component` name, source `line`
  and `column`, its `blockId`, and its compiled `model` — the same typed model the renderer
  consumes.

`blockId` is the address a reviewer's comment on that component resolves to, so a tool holding
the model already holds the anchor feedback arrives against. It is absent for a component the
reader cannot point at on its own: one rendered privately inside another component's markup, or
a slide, which is a scope rather than a block.

Prose fields inside models are HAST subtrees, and generated element ids inside models match the
ids in the rendered HTML, so a tool can link a model entry to its rendered element.

`compile` is not gated and stays permissive about authoring lint, so machine tooling can run it
on a plan a quality rule would flag.

## Files Big Plan writes

Beside the plan, in a `.big-plan/` directory created for the reviewer only and ignored by version
control:

```text
.big-plan/
  review/<plan-id>/     Session identity, heartbeat, agent connections, staged comments,
                        recorded decision answers, acceptances, and the approval log.
  feedback/             Feedback packages, their Markdown briefs, and approval briefs.
```

The review id comes from the resolved source path, so staged comments survive the revision you
create in response to feedback.

Under the user's home directory, `~/.big-plan/` holds the guidance acknowledgment and, in
`service/`, one owner-only identity record per plan plus the token that authorizes stopping the
link service. No file there records whether a session is alive; that answer only ever comes from
the plan's own heartbeat. `BIG_PLAN_STATE_DIR` pins both to one directory.

Derived output — `<plan>.html` and `<plan>.model.json` — sits next to the input and is always
safe to delete.

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

- [Write a plan](/for-agents/#what-a-plan-may-contain) — what the plan format accepts, and every diagnostic keyed to its fix.
- [Reference](/reference/commands/render/) — one page per command.
- [/setup.md](/setup.md) — this page's setup section at a stable address, for the install prompt.
