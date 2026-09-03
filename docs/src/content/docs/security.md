---
title: Security
description: How Big Plan's local runtime is designed, what it does and does not protect against, and how to report a vulnerability.
---

Big Plan runs entirely on your machine. It makes no outbound requests to remote services, it
reads and writes plan files and its own state directory, and the local review runtime
communicates only over loopback.

This page is the canonical security policy. The repository's
[`SECURITY.md`](https://github.com/josh-padnick/big-plan/blob/main/SECURITY.md) points here
rather than repeating it.

## Reporting a vulnerability

Report security issues privately through GitHub, not in a public issue:

1. Open [the repository's security advisories
   page](https://github.com/josh-padnick/big-plan/security/advisories/new).
2. Describe what an attacker can do, the version you tested, and the smallest reproduction you
   have.
3. Include the platform and Node.js version if the issue depends on either.

Please do not open a public issue, pull request, or discussion for a suspected vulnerability, and
please do not post a working exploit publicly before a fix ships.

:::caution[Private reporting is still being switched on]
GitHub's private vulnerability reporting is not yet enabled for this repository, so the advisory
link above returns a 404 until the maintainer turns it on. If that happens, **do not describe the
issue in a public issue, pull request, or discussion.** Ask the maintainer to enable private
vulnerability reporting, saying only that you have a security report and nothing about what it
is, and send the details once the form opens.
:::

Reports are answered on a best-effort basis: we acknowledge, then come back with a severity
judgement and a fix plan or an explanation of why we do not consider it a vulnerability. Fixes
ship as soon as they are ready and disclosure is coordinated with the reporter, who is credited
unless they ask otherwise.

## Scope

**In scope:** anything that lets a plan, a web page, or a remote party read or write your files,
reach the review runtime's API, or execute code through Big Plan. A defect in Node.js, npm, or a
third-party dependency is in scope **when Big Plan's use of it gives you a way to exploit Big
Plan** — report it here and upstream too.

**Out of scope:** an upstream defect with no Big-Plan-specific path to exploit it; attacks that
require an attacker already executing code as you locally; and issues needing physical access.

**Do not report** issues that require an attacker who already runs code as you on your own
machine. Big Plan's local runtime is explicitly not a boundary against that.

## Rendered plans are inert

A rendered plan is one self-contained HTML file. Plan sources are MDX, but **plan-authored code
never executes**: the compiler rejects ESM `import`/`export` statements, flow and text
expressions, and inline JSX as compile errors rather than evaluating them. A plan cannot
introduce script into its own rendered document.

The document embeds its own styles, fonts, and branding and makes no external requests, so
opening one does not contact any server. It stays fully readable with JavaScript disabled.

Because arbitrary HTML is arbitrary script, `big-plan review` always renders the document in
process from the authoritative MDX and never serves a pre-existing `.html` file.

An invalid document never renders partially. Validation collects every recoverable problem and
fails with the complete list, because a silently degraded document would be worse than a failed
one: the entire product is trust in what the reviewer approves.

## The local review runtime

`big-plan review` starts a local server. Loopback is deliberately **not** treated as an
authentication boundary — any page your browser happens to be showing can reach `127.0.0.1`, and
any process running as you can too — so every request is authorised on its own merits:

- The runtime binds explicitly to `127.0.0.1` on an ephemeral port. Never `0.0.0.0`, never a
  hostname. The saved-link service binds the same way on port `8790` by default; `BIG_PLAN_PORT`
  changes it.
- A per-plan review token is injected into the one document the runtime serves. Every API request
  must carry it in a header, so it stays out of browser history, referrers, and server logs.
- Requests whose `Host` header is not the runtime's or the local service's address are refused.
  **That allow-list, not the socket address, is what defeats DNS rebinding.**
- No CORS allowance is ever sent, and a foreign `Origin` or a `Sec-Fetch-Site` other than
  `same-origin` is refused outright. CORS hides a response; it does not stop a write.
- Routes and methods are a fixed allow-list. There is no general static-file route and no
  directory listing. The plan-picture route serves only supported picture types, requires the
  requested and real paths to stay inside the plan directory with no dot-prefixed segment, and
  enforces a size limit.

Three read-only GET requests do not use the token: the document route, which renders the selected
MDX rather than serving arbitrary HTML; plan-picture requests, which accept only supported
picture types; and stored review-image requests, which use a validated content digest.

Reviewer and plan text remain plain, untrusted data in the browser and in the agent brief.
Sending a feedback package grants only the authority to consider the notes while revising the
named plan source.

## One writer owns the plan

The plan file on disk is authoritative, and exactly one code path may write it. An agent's edits
go into a claim-scoped stage rather than the plan itself. A stage publishes only under the
plan-mutation lock, only while the recorded lock holder, the claim generation, and the source's
base digest all still hold, and only through a single atomic rename, with a journal written
beforehand so an interrupted publish can be settled after a crash.

A reviewer's revert crosses that same boundary and re-proves the digest it was computed against.
That is why a revision an agent published while you were deciding refuses the revert instead of
disappearing under it.

**One local filesystem limit is accepted rather than fixed.** Node offers no file-open relative
to an already-open directory handle, so someone who can already write inside your plan directory
can swap an ancestor directory between the moment a path is validated and the moment it is
opened. Closing that race is not possible with the available primitives, and such an attacker
already has the access the check would protect, so Big Plan documents the limit instead of
pretending to remove it.

## Supply chain and releases

Big Plan ships as the [`big-plan`](https://www.npmjs.com/package/big-plan) npm package and is
normally run with `npx big-plan` or installed with `npm install -g big-plan`.

- **An unversioned `npx` run may use a local package.** A machine that runs `npx big-plan` may
  execute a matching version already installed in the local project rather than fetch a release.
  Pin an exact version (`npx big-plan@<version>`) if your environment requires a fixed, reviewed
  release.
- **Releases are published with npm provenance, from CI only.** Publishing happens exclusively in
  the tagged-release GitHub Actions workflow, using npm Trusted Publishing over OIDC rather than
  a long-lived token. That workflow refuses to publish unless the tag equals the package version
  and points at a commit on `main`, and it runs the full lint, build, drift, unit, and
  end-to-end suites first.

The provenance attestation lets you verify a published tarball was built by that workflow from
this repository:

```sh
version="${BIG_PLAN_VERSION:?Set BIG_PLAN_VERSION to the exact version to verify}"
audit_dir="$(mktemp -d)"
npm --prefix "$audit_dir" install "big-plan@$version"
npm --prefix "$audit_dir" audit signatures
```

`npm audit signatures` needs npm 9.5 or newer, and it verifies the whole installed dependency
graph in that directory rather than Big Plan alone — installing into an empty prefix first is
what keeps its answer about the release you meant to check.

## Supported versions

Big Plan is pre-1.0 and has [no compatibility contract yet](/alpha/). Only the latest published
version receives security fixes. There are no backports; the fix for a reported issue is to
upgrade.
