---
title: Use the skill
description: Install Big Plan's thin agent skill shell and keep authoring rules fresh via the CLI.
---

Use the package-backed skill shell when a harness wants a discoverable `SKILL.md`.
The CLI remains the live instruction source every session.

## What lives where

| Surface                         | Content                                                                                              | Authority                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `big-plan skill`                | Thin shell: when to use Big Plan, how to invoke the CLI, mandatory guidance step, present HTML paths | Stable; rare edits                |
| `big-plan guidance`             | Plan-writing principles                                                                              | Changes with product quality work |
| `big-plan guidance <Component>` | Per-component usage judgment                                                                         | Changes with component design     |

Do not re-copy long guidance into chat memory, project `AGENTS.md`, or a hand-maintained skill fork as standing policy.
Run the CLI each session instead.

## Install or print the skill

Print the shell shipped with the installed package:

```sh
npx big-plan@latest skill
```

Write it to a harness path only when the human asks, or during first-time setup:

```sh
npx big-plan@latest skill write <path/to/SKILL.md>
```

Examples of harness destinations (paths vary by tool and user layout):

```sh
npx big-plan@latest skill write ~/.agents/skills/big-plan/SKILL.md
npx big-plan@latest skill write .agents/skills/big-plan/SKILL.md
```

`skill` never writes unless `write <path>` is explicit.
There is no silent overwrite of user skill directories.

## Session workflow (always)

1. Run `npx big-plan@latest guidance` and follow it.
2. Author MDX on disk.
3. `npx big-plan@latest validate <plan.mdx>` until clean.
4. `npx big-plan@latest render <plan.mdx>`.
5. Give the human the absolute path or `file://` URL of the HTML review document.
6. Wait for plan acceptance before implementation.

Details for render presentation live in [Render a plan](/for-agents/render-a-plan/).
Authoring constraints live in [Authoring plans](/for-agents/authoring-plans/).
Both still defer style judgment to `big-plan guidance`.

## How captain pushes updates to end users

1. **Authoring and product rules** change in the Big Plan repository (`assets/guidance/`, component `*.guidance.md`, CLI, lint).
2. A release publishes a new package version.
3. End users upgrade (`npx big-plan@latest`, dependency bump, or the built-in `big-plan update` for global installs).
4. The next `big-plan guidance` prints the new principles automatically.
5. **Skill reinstall** (`skill write`) is needed only when the thin shell contract itself changed.

### Failure modes

- **Pinned old version:** lockfiles and version pins keep old guidance; bump or use `@latest` when freshness matters.
- **Offline:** the installed binary still embeds matching skill text and guidance for that version.
- **Skill not installed in the harness:** agents can still run `npx big-plan@latest skill` and follow the printed workflow.
- **Stale copied skill:** a hand-edited fork can drift; re-print from the CLI and prefer the package as source of truth.

## Source of truth in the repository

The authored skill file is `assets/skill/SKILL.md`.
`scripts/gen-skill.mjs` embeds it into the package so `big-plan skill` cannot disagree with the published CLI version.
