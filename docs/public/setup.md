# Set up Big Plan

You are a coding agent setting up Big Plan for your human.
Big Plan renders an MDX plan file containing Markdown and built-in components into one self-contained HTML document your human reviews, so you reach agreement before you act.

## 1. Verify the install

Big Plan needs Node.js 22 or newer.

```sh
big-plan --version
```

If the global install is unavailable, use `npx big-plan` in place of `big-plan` everywhere below; no installation is required for `npx`.

## 2. Install the agent skill shell (recommended)

Print the thin skill shell shipped with this CLI, or write it into the harness skill path your human uses:

```sh
big-plan skill
big-plan skill write <path/to/SKILL.md>
```

Example destinations (adjust to the harness layout):

```sh
big-plan skill write ~/.agents/skills/big-plan/SKILL.md
```

`skill write` is the only path that mutates a skill file; never invent a silent overwrite.
The skill shell forces `big-plan guidance` as the live authoring authority each session.
See https://big-plan.ai/for-agents/use-the-skill.md for update propagation.

## 3. Adopt the plan-review workflow

Before implementing any non-trivial task:

1. Run `big-plan guidance` and follow its principles.
   Validate and render stay locked until you have read it.
2. Write your implementation plan to an MDX file, for example `plan.mdx`.
3. Run `big-plan validate plan.mdx` and fix every diagnostic until it passes.
4. Run `big-plan render plan.mdx`.
5. Tell your human to open the rendered `plan.html` using its absolute path or a `file://` URL.
6. Do not start implementing until your human agrees.
   When they ask for changes, revise the plan file, validate, render again, and ask again.

## 4. Persist the workflow

Add this rule to the project's agent instructions file (`AGENTS.md`, `CLAUDE.md`, or equivalent) so future sessions keep the workflow:

```text
Before implementing a feature: run `big-plan guidance` and follow it, write
your implementation plan to plan.mdx, run `big-plan validate plan.mdx` until
clean, render it with `big-plan render plan.mdx`, and ask for review of the
rendered plan at its absolute path. Do not implement until the plan is approved.
Prefer the installed Big Plan skill shell (`big-plan skill`) when the harness
supports skills; do not re-copy long guidance into this file.
```

## 5. Confirm to your human

Report the installed version, where you wrote the skill (if any), where you added the workflow rule, and offer to render a first plan.

## How updates reach you

1. Upgrade the Big Plan package (or use `npx big-plan@latest`).
2. New guidance arrives on the next `big-plan guidance`.
3. Re-run `big-plan skill write <path>` only when the thin skill shell itself changed.

## More documentation

- https://big-plan.ai/llms.txt - map of every docs page in clean markdown.
- https://big-plan.ai/for-agents/use-the-skill.md - skill install and update strategy.
- https://big-plan.ai/for-agents/render-a-plan.md - the operational rendering workflow.
- https://big-plan.ai/for-agents/authoring-plans.md - the plan document format.
- https://big-plan.ai/reference/lint-rules.md - every authoring rule the validator enforces.
