---
title: Install and update the skill
description: Install Big Plan's thin agent skill shell and keep authoring rules fresh via the CLI.
---

Use the package-backed skill shell when a harness wants a discoverable `SKILL.md`.
The CLI remains the live instruction source every session.

## What lives where

| Surface                         | Content                                                                                             | Authority                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------- |
| `big-plan skill`                | When to use Big Plan, invoke the CLI, run mandatory guidance, and present the stable review address | Stable; rare edits                |
| `big-plan guidance`             | Plan-writing principles                                                                             | Changes with product quality work |
| `big-plan guidance <Component>` | Per-component usage judgment                                                                        | Changes with component design     |

Do not re-copy long guidance into chat memory, project `AGENTS.md`, or a hand-maintained skill fork as standing policy.
Run the CLI each session instead.

## Install or print the skill

Print the shell shipped with the installed package:

```sh
npx -y big-plan@latest skill
```

Write it to a harness path only when the human asks, or during first-time setup:

```sh
npx -y big-plan@latest skill write <path/to/SKILL.md>
```

Examples of harness destinations (paths vary by tool and user layout):

```sh
npx -y big-plan@latest skill write ~/.agents/skills/big-plan/SKILL.md
npx -y big-plan@latest skill write .agents/skills/big-plan/SKILL.md
```

`skill` never writes unless `write <path>` is explicit.
There is no silent overwrite of user skill directories.

## Session workflow (always)

1. Run `npx -y big-plan@latest guidance` and follow it.
2. Author MDX on disk.
3. `npx -y big-plan@latest validate <plan.mdx>` until clean.
4. `npx -y big-plan@latest review <plan.mdx>`.
5. Give the human the stable plan address the command prints; the session address is only for debugging.
6. Wait for the human to approve the plan in the live review.
7. When the mailbox returns an `approval` request, re-read `planPath`, verify its digest equals `pinnedSnapshot`, acknowledge without editing the plan, and begin execution in your own harness.
   A missing path, a missing file, or a digest mismatch is a hard stop: report it through the response by adding `hardStop` (one line naming what you found), and do not search for another copy.

Details for the review address live in [Start a review](/review/start-a-review/).
Authoring constraints live in [Writing plans](/authoring/).
Both still defer style judgment to `big-plan guidance`.

## How captain pushes updates to end users

1. **Authoring and product rules** change in the Big Plan repository (`assets/guidance/`, component `*.guidance.md`, CLI, lint).
2. A release publishes a new package version.
3. End users upgrade (`npx -y big-plan@latest`, dependency bump, or the built-in `big-plan update` for global installs).
4. The next `big-plan guidance` prints the new principles automatically.
5. **Skill reinstall** (`skill write`) is needed only when the thin shell contract itself changed.

### Failure modes

- **Pinned old version:** lockfiles and version pins keep old guidance; bump or use `@latest` when freshness matters.
- **Offline:** the installed binary still embeds matching skill text and guidance for that version.
- **Skill not installed in the harness:** agents can still run `npx -y big-plan@latest skill` and follow the printed workflow.
- **Stale copied skill:** a hand-edited fork can drift; re-print from the CLI and prefer the package as source of truth.

## Source of truth in the repository

The authored skill file is `assets/skill/SKILL.md`.
`scripts/gen-skill.mjs` embeds it into the package so `big-plan skill` cannot disagree with the published CLI version.
