---
title: Reporting a vulnerability
description: How to report a security issue in Big Plan privately, what is supported, and what happens next.
---

This page is the canonical security policy for Big Plan.
The repository's [`SECURITY.md`](https://github.com/josh-padnick/big-plan/blob/main/SECURITY.md)
points here rather than repeating it, so there is one source of truth.

## Reporting a vulnerability

Report security issues privately through GitHub, not in a public issue:

1. Open [the repository's security advisories page](https://github.com/josh-padnick/big-plan/security/advisories/new).
2. Describe what an attacker can do, the version you tested, and the smallest reproduction you have.
3. Include the platform and Node.js version if the issue depends on either.

Please do not open a public issue, pull request, or discussion for a suspected vulnerability, and please do not post a working exploit publicly before a fix ships.

:::caution[Private reporting is still being switched on]
GitHub's private vulnerability reporting is not yet enabled for this repository, so the advisory link above returns a 404 until the maintainer turns it on.
If that happens, **do not describe the issue in a public issue, pull request, or discussion.** Ask the maintainer to enable private vulnerability reporting, saying only that you have a security report and nothing about what it is, and send the details once the form opens.
:::

**Do not report** issues that require an attacker who already runs code as you on your own machine.
Big Plan's local runtime is explicitly not a boundary against that; see [Trust boundaries](/concepts/trust-boundaries/).

## Response process

Big Plan is a small project, so it makes no service-level promise about response times.
Reports are answered on a best-effort basis:

- **Acknowledgement.** We reply to confirm we have the report.
- **Assessment.** We come back with an initial severity judgement and a fix plan, or an explanation of why we do not consider the report a vulnerability.
- **Fix and disclosure.** Fixes ship as soon as they are ready, and public disclosure is coordinated with the reporter. The reporter is credited in the advisory unless they ask otherwise.

Reports are handled through GitHub Security Advisories, so the advisory thread is where updates land.

## Supported versions

Big Plan is pre-1.0 and has [no compatibility contract yet](https://github.com/josh-padnick/big-plan/blob/main/AGENTS.md).
Only the latest published version on npm receives security fixes.
There are no backports to earlier versions; the fix for a reported issue is to upgrade.

## Scope

**In scope:** anything that lets a plan, a web page, or a remote party read or write your files, reach the review runtime's API, or execute code through Big Plan.

A defect in Node.js, npm, or a third-party dependency **is in scope when Big Plan's use of it gives you a way to exploit Big Plan**. Report it here, and report it upstream too. The question is not where the flawed code lives; it is whether there is a path to it through Big Plan.

**Out of scope:** an upstream defect with no Big-Plan-specific path to exploit it — report those to the upstream project; attacks that require an attacker already executing code as you locally; and issues that need physical access to your machine.

## Related

- [Trust boundaries](/concepts/trust-boundaries/) — what the local runtime is and is not.
- [Supply chain and releases](/concepts/supply-chain/) — how to verify a published tarball.
