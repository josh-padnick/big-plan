---
title: Trust boundaries
description: What the local review runtime does and does not protect against, and why loopback is not one of its defences.
---

**The problem.** `big-plan review` starts a local server. It is tempting to treat `127.0.0.1`
as a boundary, and it is not one: any page your browser happens to be showing can reach
loopback, and any process running as you can too. So every request is authorised on its own
merits rather than on where it appears to come from.

## The controls

`big-plan review` starts a local server. Loopback is deliberately **not** treated as an authentication boundary — any page your browser happens to be showing can reach `127.0.0.1`, and any process running as you can too — so every request is authorised on its own merits:

- The runtime binds explicitly to `127.0.0.1` on an ephemeral port. Never `0.0.0.0`, never a hostname. The saved-link service binds the same way on port `8790` by default; `BIG_PLAN_PORT` changes that port when the default collides with another local service.
- A per-plan review token is injected into the one document the runtime serves. Every API request must carry it, in a header, so it stays out of browser history, referrers, and server logs.
- Requests whose `Host` header is not the runtime's or the local service's address are refused. That allow-list, not the socket address, is what defeats DNS rebinding.
- No CORS allowance is ever sent, and a foreign `Origin` or a `Sec-Fetch-Site` other than `same-origin` is refused outright. CORS hides a response; it does not stop a write, so it is not the control here.
- Routes and methods are a fixed allow-list. There is no general static-file route and no directory listing. The plan-picture route serves only supported picture types, requires the requested and real paths to stay inside the plan directory with no dot-prefixed segment, and enforces a size limit.

The authoritative plan source has exactly one writer, so an agent edit and a reviewer's revert cannot silently overwrite each other. How that is enforced, and one local filesystem limit Big Plan accepts rather than fixes, are described in [How Big Plan works](/architecture/#one-writer-owns-the-plan-source).

## How that plays out in the runtime

Loopback is not an authentication boundary.
The runtime binds only `127.0.0.1` on an ephemeral port and exposes a fixed route-and-method allow-list.
It checks the `Host` header on every request and refuses any value outside a short allow-list: its own address and the review-link service's, so the service hop can reach it while a rebound name still cannot.

The service that answers saved links is a separate process on its own stable loopback port, holding no review content. It forwards requests to this runtime by default, while `BIG_PLAN_PROXY=0` restores the redirect, without rewriting the browser's `Host`, `Origin`, or `Sec-Fetch-Site` headers. Either way every check below still happens here.
[`big-plan service`](/reference/commands/service/) owns what that process stores and how to stop it.

Three types of read-only GET request do not use the review token, `Origin`, or `Sec-Fetch-Site` checks:

- the document route `/`, which renders the selected MDX instead of serving arbitrary HTML;
- plan-picture requests, which accept only supported picture file types; and
- stored review-image requests at `/review-images/<digest>`, which use a validated content digest.

For a plan-picture request, both the requested path and its real path must stay in the plan's own directory.
Neither path can contain a dot-prefixed segment.
The opened target must be a regular file and must stay inside the image size limit.
The file-identity check is best effort.
An attacker who can already write in the reviewer's plan directory can replace an ancestor directory between path validation and file open.
The attacker can then make the plan-picture route open a file outside the plan directory.
The runtime accepts this limit because the attacker already has access to the reviewer's local files, and the server listens only on loopback.
For a stored review-image request, the metadata and picture must be regular files and must stay inside their explicit size limits.

All API routes require the review token in a request header.
They refuse a foreign `Origin` or a cross-site request.
The runtime also validates every agent response against its pending request and the computed snapshot diff.
It keeps requests, responses, heartbeats, and source snapshots in the owner-only ignored review store.

Reviewer and plan text remain plain, untrusted data in the browser and in the
agent brief. Sending a package grants only authority to consider the notes
while revising the named plan source.

## Scope

**In scope:** anything that lets a plan, a web page, or a remote party read or write your files, reach the review runtime's API, or execute code through Big Plan.

A defect in Node.js, npm, or a third-party dependency **is in scope when Big Plan's use of it gives you a way to exploit Big Plan**. Report it here, and report it upstream too. The question is not where the flawed code lives; it is whether there is a path to it through Big Plan.

**Out of scope:** an upstream defect with no Big-Plan-specific path to exploit it — report those to the upstream project; attacks that require an attacker already executing code as you locally; and issues that need physical access to your machine.

## Related

- [Reporting a vulnerability](/concepts/security-policy/) — the private channel.
- [One writer owns the plan](/concepts/one-writer/) — the one local filesystem limit Big Plan
  accepts rather than fixes.

## Next

[Rendered plans are inert](/concepts/inert-documents/) — why a plan cannot introduce script
into its own document.
