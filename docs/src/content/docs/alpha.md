---
title: Big Plan is in alpha
description: What alpha means for Big Plan - what is stable, what is not, and what to expect from an upgrade.
---

Big Plan works, and it is used daily. It is also **alpha**, and that word should mean something
specific rather than vague.

## What alpha means here

**There is no compatibility contract yet.** Commands, the plan document format, the
machine-readable JSON, and the rendered output may all change together as the product finds its
cleanest model. An explicit milestone will establish that contract; until then, prefer the
cleanest shape over preserving an earlier one.

In practice:

| What can change                                     | How you would notice                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| Command names, arguments, and options               | A command you scripted stops accepting an argument                         |
| The plan format                                     | A plan that validated yesterday reports a diagnostic today                 |
| The compiled JSON                                   | A tool reading `big-plan compile` output finds a renamed field             |
| The rendered document's markup and classes          | Custom styling on top of an exported document breaks                       |
| Guidance, and therefore what a good plan looks like | `big-plan guidance` prints new principles, and re-locks the gated commands |

## What is not going to change

- **Your plan file stays yours.** It is on your disk, it is the source of truth, and exactly one
  code path writes it. See [One writer owns the plan](/concepts/one-writer/).
- **Nothing leaves your machine.** No account, no service, no outbound requests from a rendered
  document.
- **A plan never executes.** Plan-authored code is rejected at compile time rather than run. See
  [Rendered plans are inert](/security/inert-documents/).

Those three are the product, not features of this release.

## What to expect from an upgrade

Only the latest published version receives fixes; there are no backports. The fix for a reported
issue is to upgrade.

- `npx -y big-plan@latest` always runs the current release, which is the recommended way to use
  it during alpha.
- A pinned version keeps working, including its guidance, offline.
- After an upgrade, `big-plan guidance` may print new principles. That expires the acknowledgment
  and re-locks `validate`, `render`, and `review` until it is read again — deliberately, so a
  plan is never written against rules its author has not seen.

## Should you use it?

**Yes, if** you want better plan review now and can live with a command or a format shifting
under you between versions.

**Not yet, if** you need a stable format to build tooling on, or you cannot absorb a breaking
change on your own schedule.

## Reporting problems

Ordinary bugs and ideas go to [the issue
tracker](https://github.com/josh-padnick/big-plan/issues). Security issues go through the private
channel described in [Reporting a vulnerability](/security/reporting/) — never a public issue.

## Next

[Install Big Plan](/intro/installation/) — Node.js 22, one command, nothing installed globally.
