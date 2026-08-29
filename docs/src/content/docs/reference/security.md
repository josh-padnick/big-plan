---
title: Security
description: How to report a vulnerability in Big Plan, what is supported, and how the local review runtime and the published package are designed.
---

This page is the canonical security policy for Big Plan.
The repository's [`SECURITY.md`](https://github.com/josh-padnick/big-plan/blob/main/SECURITY.md) points here rather than repeating it, so there is one source of truth.

## Reporting a vulnerability

Report security issues privately through GitHub, not in a public issue:

1. Open [the repository's security advisories page](https://github.com/josh-padnick/big-plan/security/advisories/new).
2. Describe what an attacker can do, the version you tested, and the smallest reproduction you have.
3. Include the platform and Node.js version if the issue depends on either.

Please do not open a public issue, pull request, or discussion for a suspected vulnerability, and please do not post a working exploit publicly before a fix ships.

**Do not report** issues that require an attacker who already runs code as you on your own machine.
Big Plan's local runtime is explicitly not a boundary against that; see [Local review runtime](#local-review-runtime) below.

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

## Distribution and supply chain

Big Plan ships as the [`big-plan`](https://www.npmjs.com/package/big-plan) npm package and is normally run with `npx big-plan` or installed with `npm install -g big-plan`.
Two properties of that model are worth knowing:

- **An unversioned `npx` run may use a local package.** A machine that runs `npx big-plan` may execute a matching version already installed in the local project rather than fetch a release. Use `npm view big-plan dist-tags` to see which versions npm's `latest` and `next` channels currently select. Pin an exact version (`npx big-plan@0.0.1`) or install that version globally if your environment requires a fixed, reviewed release.
- **Releases are published with npm provenance, from CI only.** Publishing happens exclusively in the tagged-release GitHub Actions workflow, using npm Trusted Publishing over OIDC rather than a long-lived token. That workflow refuses to publish unless the tag equals the package version and points at a commit on `main`, and it runs the full lint, build, generated-file-drift, unit, and end-to-end suites first. Every release is published to the `next` dist-tag, then both `big-plan@next` and the exact published version are smoke-tested from a clean environment. The provenance attestation lets you verify a published tarball was built by that workflow from this repository:

  ```sh
  version="${BIG_PLAN_VERSION:?Set BIG_PLAN_VERSION to the exact version to verify}"
  audit_dir="$(mktemp -d)"
  npm --prefix "$audit_dir" install "big-plan@$version"
  npm --prefix "$audit_dir" audit signatures
  ```

Big Plan makes no outbound network requests to remote services. It reads and writes plan files and its own state directory on your machine, and the local review runtime communicates only over loopback.

## Rendered plans are inert

A rendered plan is one self-contained HTML file. Plan sources are MDX, but **plan-authored code never executes**: the compiler rejects ESM `import`/`export` statements, flow and text expressions, and inline JSX as compile errors rather than evaluating them. A plan cannot introduce script into its own rendered document.

The document embeds its own styles, fonts, and branding and makes no external requests, so opening one does not contact any server. It stays fully readable with JavaScript disabled.

Because arbitrary HTML is arbitrary script, `big-plan review` always renders the document in process from the authoritative MDX and never serves a pre-existing `.html` file.

## Local review runtime

`big-plan review` starts a local server. Loopback is deliberately **not** treated as an authentication boundary — any page your browser happens to be showing can reach `127.0.0.1`, and any process running as you can too — so every request is authorised on its own merits:

- The runtime binds explicitly to `127.0.0.1` on an ephemeral port. Never `0.0.0.0`, never a hostname. The saved-link service binds the same way on port `8790` by default; `BIG_PLAN_PORT` changes that port when the default collides with another local service.
- A per-session token is minted at start and injected into the one document the runtime serves. Every API request must carry it, in a header, so it stays out of browser history, referrers, and server logs.
- Requests whose `Host` header is not the runtime's or the local service's address are refused. That allow-list, not the socket address, is what defeats DNS rebinding.
- No CORS allowance is ever sent, and a foreign `Origin` or a `Sec-Fetch-Site` other than `same-origin` is refused outright. CORS hides a response; it does not stop a write, so it is not the control here.
- Routes and methods are a fixed allow-list. There is no general static-file route and no directory listing. The plan-picture route serves only supported picture types, requires the requested and real paths to stay inside the plan directory with no dot-prefixed segment, and enforces a size limit.

One local filesystem limit is accepted and documented rather than fixed: Node offers no file-open relative to an already-open directory handle, so someone who can already write inside your plan directory can swap an ancestor directory between path validation and file open. That attacker already has access to your local files, and the runtime listens only on loopback, so this is out of scope for a report.

## Writes to your plan

The authoritative plan source has exactly one writer. Agent edits go into a claim-scoped stage and publish only under a lock, only when the recorded holder, the claim generation, and the source's base digest all still hold, and only through a single atomic rename that a journal written beforehand can settle after a crash. A reviewer's revert crosses the same boundary and re-proves its digest, so a revision published in the meantime refuses the revert instead of disappearing under it.

## Scope

In scope: anything that lets a plan, a web page, or a remote party read or write your files, reach the review runtime's API, or execute code through Big Plan.

Out of scope: attacks that require an attacker already executing code as you locally; vulnerabilities in Node.js, npm, or third-party dependencies (report those upstream, though please tell us if Big Plan's use of one makes it exploitable); and issues that need physical access to your machine.
