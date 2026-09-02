---
title: Security
description: Big Plan's security model, what it does and does not protect against, and how to report a vulnerability privately.
---

Big Plan runs entirely on your machine. It makes no outbound network requests to remote
services, it reads and writes plan files and its own state directory, and the local review
runtime communicates only over loopback.

Three properties carry most of that:

- **A rendered plan is inert.** Plan-authored code never executes, so a plan cannot introduce
  script into its own document. Opening one contacts no server.
- **Loopback is deliberately not an authentication boundary.** Every request to the review
  runtime is authorised on its own merits — a per-plan token, a `Host` allow-list, and a fixed
  route-and-method allow-list — rather than on where it appears to come from.
- **The plan file has exactly one writer.** An agent's edit and your revert cannot silently
  overwrite each other.

## Section guide

| Read this                                              | When                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [Rendered plans are inert](/security/inert-documents/) | You are deciding whether to open a plan someone sent you |
| [Trust boundaries](/security/trust-boundaries/)        | You are assessing the local review runtime               |
| [Reporting a vulnerability](/security/reporting/)      | You found something and need the private channel         |
| [Supply chain and releases](/security/supply-chain/)   | You need to verify a published tarball                   |

Related, in [Concepts](/concepts/how-it-works/): [One writer owns the
plan](/concepts/one-writer/) explains why an agent cannot overwrite your work.

## Out of scope

Big Plan's local runtime is explicitly **not** a boundary against an attacker who already runs
code as you on your own machine. Do not report issues that require that.

## Next

[Reporting a vulnerability](/security/reporting/) — the private channel, and what happens next.
