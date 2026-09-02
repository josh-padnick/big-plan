---
title: big-plan skill
description: Print the thin agent skill shell, or write it to a harness path when you ask explicitly.
---

## Synopsis

```text
big-plan skill [write <path>]
```

## Arguments

| Argument       | Required | Behaviour                                                                        |
| -------------- | -------- | -------------------------------------------------------------------------------- |
| `write <path>` | No       | Write the skill text to the resolved path, creating parent directories as needed |

With no arguments, `skill` returns the Markdown skill text, including harness-oriented
frontmatter, and writes nothing.

## What it does

`skill` prints the thin agent skill document embedded in the package (authored at `assets/skill/SKILL.md` and generated into the CLI).
The shell tells agents when to use Big Plan, how to invoke the CLI, and that they must run `big-plan guidance` for live authoring rules.
It does not duplicate plan-writing principles; those stay in `guidance` so package upgrades refresh authoring policy without editing installed skill files.

With no arguments, `skill` returns the Markdown skill text (including harness-oriented frontmatter) and writes nothing.
`skill write <path>` creates parent directories as needed and writes that text to the resolved path.
Write is the only mutation path; unknown options and unknown actions fail with `VALIDATION_ERROR` and leave the filesystem unchanged.
Overwriting an existing file at that path is allowed only because `write` was explicit.

After a package upgrade, new guidance is available immediately via `big-plan guidance`.
Re-run `skill write` only when the thin shell itself changed.
Prefer `npx -y big-plan@latest` for always-current one-off runs; see [Use the skill](/for-agents/use-the-skill/) for the full update-propagation story.

## Result

`skill` with no arguments returns the skill Markdown itself. `skill write` returns:

- `written`: the absolute output path.
- `help`: a reminder that authoring rules still come from `guidance`, and when to re-run
  `skill write`.

## Errors

| Code               | Raised when                                                              | Exit |
| ------------------ | ------------------------------------------------------------------------ | ---- |
| `VALIDATION_ERROR` | An unknown option or an unknown action; the filesystem is left unchanged | 2    |

`skill` is not gated, so it runs without a guidance acknowledgment.

## Troubleshooting

- **It overwrote a file.** Overwriting at that path is allowed only because `write` was
  explicit. Inspect a destination before replacing it; there is no silent overwrite of a skill
  directory.
- **The skill text is older than the docs.** The shell is embedded in the package from
  `assets/skill/SKILL.md`, so it matches your installed CLI version. Upgrade, or use
  `npx -y big-plan@latest`.
- **You upgraded and wonder whether to reinstall.** New authoring guidance arrives through
  `big-plan guidance` immediately. Re-run `skill write` only when the thin shell itself changed.

## Related

- [Install and update the skill](/for-agents/use-the-skill/) — the full update-propagation story.
