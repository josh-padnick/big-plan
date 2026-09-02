---
title: Write and validate a plan
description: The authoring loop a coding agent runs each session, from guidance to a live review.
---

**Goal.** A plan file on disk that validates cleanly and is serving in a live review your human
can open.

## Before you start

Confirm Node.js 22 or newer:

```sh
node --version
```

## Steps

1. **Read the guidance.** Before writing the plan:

   ```sh
   npx -y big-plan@latest guidance
   ```

   It prints the plan-writing principles and unlocks `validate`, `render`, and `review` for the
   working directory for 24 hours. All three fail with `GUIDANCE_REQUIRED` until it has been
   run. Run `npx -y big-plan@latest guidance Slide` once as well, for the complete slide-type
   catalog, and `guidance <Component>` before reaching for a component you have not used.

2. **Write the plan to an MDX file**, for example `plan.mdx`. See
   [Anatomy of a plan](/authoring/anatomy-of-a-plan/) for the shape and
   [Writing plans](/authoring/) for what the format accepts.

3. **Validate until clean.** This is the correction loop, not a final check:

   ```sh
   npx -y big-plan@latest validate plan.mdx
   ```

   Fix every diagnostic. Rendering and review enforce the same linting rules, so validate until
   clean before handing anything to a human.

4. **Start the live review.**

   ```sh
   npx -y big-plan@latest review plan.mdx
   ```

5. **Give your human the stable plan address** the command printed — the `review:` line. The
   `direct:` line is the session address and is for debugging only.

6. **Do not start implementing until your human agrees.** When they ask for changes, revise the
   plan file, validate again, and continue the live review.

## A portable file instead

When a live review is not what is wanted, `npx -y big-plan@latest render plan.mdx` writes a
self-contained `plan.html` next to the source. Give the human that path as a full absolute path
or a `file://` URL. Pass a second argument to choose the location; parent directories are
created for you. This does not replace the live-review workflow.

## Verify

- `validate` returns `validated:` with a title and non-zero section count.
- `review` returns `custody: activated` and keeps running in the foreground.

## If it goes wrong

| What you see                                | What to do                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GUIDANCE_REQUIRED`                         | Run `guidance` from the same working directory you run the gated command in                                     |
| `Cannot validate document with invalid MDX` | Every recoverable problem is in the `help` entries as `line:column message`; fix them in one pass               |
| Only one diagnostic came back               | An MDX syntax error stopped parsing before component validation; fix it and run again                           |
| `Plan failed authoring lint`                | Each entry is `line:column [rule-id] message`; see [Fix a validation error](/authoring/fix-a-validation-error/) |
| `custody: held`                             | A live runtime already serves this plan; give your human the address it printed                                 |

## Next

[Answer reviewer feedback](/for-agents/answer-feedback/) — the exchange loop, once a human
starts commenting.
