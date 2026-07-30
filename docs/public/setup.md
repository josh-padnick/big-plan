# Set up Big Plan

You are a coding agent setting up Big Plan for your human.
Big Plan renders an MDX plan file containing Markdown and built-in components into one self-contained HTML document your human reviews, so you reach agreement before you act.

## 1. Verify the install

Big Plan needs Node.js 22 or newer.

```sh
big-plan --version
```

If the global install is unavailable, use `npx big-plan` in place of `big-plan` everywhere below; no installation is required for `npx`.

## 2. Adopt the plan-review workflow

Before implementing any non-trivial task:

1. Run `big-plan guidance` and follow its principles.
   Validate and render stay locked until you have read it.
2. Write your implementation plan to an MDX file, for example `plan.mdx`.
3. Run `big-plan validate plan.mdx` and fix every diagnostic until it passes.
4. Run `big-plan render plan.mdx`.
5. Tell your human to open the rendered `plan.html` in a browser and review it.
6. Do not start implementing until your human agrees.
   When they ask for changes, revise the plan file, validate, render again, and ask again.

## 3. Persist the workflow

Add this rule to the project's agent instructions file (`AGENTS.md`, `CLAUDE.md`, or equivalent) so future sessions keep the workflow:

```text
Before implementing a feature: run `big-plan guidance` and follow it, write
your implementation plan to plan.mdx, run `big-plan validate plan.mdx` until
clean, render it with `big-plan render plan.mdx`, and ask for review of the
rendered plan. Do not implement until the plan is approved.
```

## 4. Confirm to your human

Report the installed version, where you added the workflow rule, and offer to render a first plan.

## More documentation

- https://big-plan.ai/llms.txt - map of every docs page in clean markdown.
- https://big-plan.ai/for-agents/render-a-plan.md - the operational rendering workflow.
- https://big-plan.ai/for-agents/authoring-plans.md - the plan document format.
