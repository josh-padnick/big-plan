---
title: Concepts and security
description: Why Big Plan works the way it does, what it guarantees about your plan file, and how to report a vulnerability.
---

These pages explain rather than instruct. Nothing here is a step you follow; where a concept
implies an action, it links to the page that owns it.

Four ideas carry most of Big Plan's design:

- **A plan is compiled, not templated.** One validation-and-translation path produces JSON, an
  HTML review document, or portable Markdown, which is why they can never disagree.
- **The plan file on disk is authoritative, and exactly one code path writes it.** An agent
  edit and a reviewer's revert cannot silently overwrite each other.
- **A rendered plan is inert.** Plan-authored code never executes, so a plan cannot introduce
  script into its own document.
- **Loopback is not an authentication boundary.** Every request to the review runtime is
  authorised on its own merits rather than on where it came from.

## Section guide

| Read this                                               | When                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| [How Big Plan works](/concepts/how-it-works/)           | You want the compilation model and what each command publishes |
| [One writer owns the plan](/concepts/one-writer/)       | You want to know what can and cannot overwrite your plan file  |
| [Trust boundaries](/concepts/trust-boundaries/)         | You are assessing the local review runtime                     |
| [Rendered plans are inert](/concepts/inert-documents/)  | You are deciding whether to open a plan someone sent you       |
| [Reporting a vulnerability](/concepts/security-policy/) | You found something and need the private channel               |
| [Supply chain and releases](/concepts/supply-chain/)    | You need to verify a published tarball                         |

## Next

[How Big Plan works](/concepts/how-it-works/) — why a plan is compiled before it is rendered.
