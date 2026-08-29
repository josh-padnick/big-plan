# Set up Big Plan

You are a coding agent setting up Big Plan for your human.
Big Plan renders an MDX plan file containing Markdown and built-in components into one self-contained HTML document your human reviews, so you reach agreement before you act.

The prompt that sent you here is intentionally stable:

```text
Set up Big Plan for me: read https://big-plan.ai/setup.md and follow it.
```

## 1. Run the current CLI

Big Plan needs Node.js 22 or newer.
Run the current published CLI directly; this is the primary convention and installs nothing globally:

```sh
npx -y big-plan@latest --version
```

If your human explicitly prefers a global install, use this alternative:

```sh
npm install -g big-plan@latest
big-plan --version
```

The rest of this guide uses `npx -y big-plan@latest` so every command runs the current release without a global install.

## 2. Install the agent skill shell (recommended)

Print the thin skill shell shipped with this CLI, or write it into the harness skill path your human uses:

```sh
npx -y big-plan@latest skill
npx -y big-plan@latest skill write <path/to/SKILL.md>
```

Example destinations (adjust to the harness layout):

```sh
npx -y big-plan@latest skill write ~/.agents/skills/big-plan/SKILL.md
```

`skill write <path>` creates any missing parent directories, then writes the thin Big Plan skill shell to the exact file path you provide so your coding harness can load it. Because that explicit command accepts overwriting that one file, inspect an existing destination before replacing it; never invent a silent overwrite.
The skill shell forces `big-plan guidance` as the live authoring authority each session.
See https://big-plan.ai/for-agents/use-the-skill.md for update propagation.

## 3. Adopt the plan-review workflow

Before implementing any non-trivial task:

1. Run `npx -y big-plan@latest guidance` to learn how to write a plan humans love to review, then follow those principles.
   Validate, render, and review stay locked until you have read it.
2. Write your implementation plan to an MDX file, for example `plan.mdx`.
3. Run `npx -y big-plan@latest validate plan.mdx` to compile and lint the plan without writing an output file, and fix every diagnostic until it passes.
4. Run `npx -y big-plan@latest review plan.mdx` to start the local live review service.
5. Give your human the stable `http://127.0.0.1:<port>/plan/<plan-id>` plan address printed by the command.
6. Do not start implementing until your human agrees.
   When they ask for changes, revise the plan file, validate again, and continue the live review.

See [Reviewing a plan](https://big-plan.ai/reference/reviewing/) for the complete live-review workflow.

For a portable artifact instead, `npx -y big-plan@latest render plan.mdx` writes a self-contained `plan.html` document next to the source. You can share that file by its absolute path or a `file://` URL, but it does not replace the live-review workflow above.

## 4. Persist the workflow

Add this rule to the project's agent instructions file (`AGENTS.md`, `CLAUDE.md`, or equivalent) so future sessions keep the workflow:

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

## 5. Confirm to your human

Report the CLI version, where you wrote the skill (if any), where you added the workflow rule, and offer to start a live review for the first plan.

## How updates reach you

1. Use `npx -y big-plan@latest`, or upgrade an explicitly chosen project or global install.
2. New guidance arrives on the next `npx -y big-plan@latest guidance`.
3. Re-run `npx -y big-plan@latest skill write <path>` only when the thin skill shell itself changed.

## More documentation

- https://big-plan.ai/llms.txt - map of every docs page in clean markdown.
- https://big-plan.ai/for-agents/use-the-skill.md - skill install and update strategy.
- https://big-plan.ai/for-agents/render-a-plan.md - the operational rendering workflow.
- https://big-plan.ai/for-agents/authoring-plans.md - the plan document format.
- https://big-plan.ai/reference/lint-rules.md - every authoring rule the validator enforces.
