# Big Plan first alpha release — dry-run checklist (0.1.0-alpha.1)

Status key: `big277-release-plan` (plan) · `big277-release` (execution)
Release issue: **BIG-277** — "Cut the first alpha release 0.1.0-alpha.1 and launch"

## ⛔ Safety gate

This document is **Phase 1: the dry run only**. It takes **no irreversible or
outward-facing action** — no `git tag`, no `git push` of a tag, no `npm publish`,
no dist-tag promotion, no GitHub release. Those steps run **only in Phase 2**,
and only after firstmate relays the captain's **explicit go**. Every command
below is written so the captain can confirm it before anyone runs it.

## Authoritative source

The authoritative procedure is the repo's release runbook **[`RELEASING.md`](../../RELEASING.md)**
(this is the BIG-275 release-runbook deliverable; there is no separate BIG-275
document in the tree — `grep -rn BIG-275` returns nothing). This checklist frames
and instantiates that runbook for `0.1.0-alpha.1`; where they ever disagree,
`RELEASING.md` wins.

**The single most important fact:** Big Plan is **never published from a laptop.**
Publishing happens inside GitHub Actions (`.github/workflows/publish.yml`) via npm
**Trusted Publishing (OIDC) with provenance**, triggered by **pushing a `v*.*.*`
tag**. The only human `npm` command in the whole release is the `dist-tag`
promotion in step 6, and the only irreversible local act is creating and pushing
the tag in step 4.

---

## Release facts (confirm these first)

| Fact | Value | Where / how |
| --- | --- | --- |
| Package name | `big-plan` | `package.json` `name` |
| Version | `0.1.0-alpha.1` | `package.json` `version` — **already set on `origin/main`**, no change needed |
| Registry | `https://registry.npmjs.org` | `publish.yml` `registry-url`; default public registry |
| Publish dist-tag | `next` | `publish.yml`: `npm publish --access public --tag next --provenance` |
| Install dist-tag | `latest` | Promoted by hand in step 6; `npx -y big-plan@latest` resolves this |
| Publish mechanism | **GitHub Actions OIDC Trusted Publishing** | Job `publish-next` in `publish.yml`, environment `npm-release`, `id-token: write` |
| **npm publishing identity** | GitHub Actions **trusted publisher** bound to org/user **`josh-padnick`**, repo **`big-plan`**, workflow **`publish.yml`**, environment **`npm-release`** | `RELEASING.md` §"One-time trust setup". No `NPM_TOKEN` exists in the repo. **← captain: confirm this is the intended npm identity/package owner** |
| **npm promotion identity** | A **trusted maintainer** authenticated to npm **with 2FA** (the `big-plan` package owner — `josh-padnick`'s npm account), run from their own terminal | `RELEASING.md` step 7. **← captain: confirm this is the intended human npm account for the `dist-tag` move** |
| Tag format | `v0.1.0-alpha.1`, **annotated** (`git tag -a`) | `RELEASING.md` step 4. Runbook does **not** require a signed (`-s`) tag |
| GitHub release | Published **last**, after `latest` reports the version | `RELEASING.md` step 8 |
| Notes source | `CHANGELOG.md` `## 0.1.0-alpha.1` entry (already written; body = release body) | `RELEASING.md` §Changelog |

---

## Preconditions (runbook, all must hold before Phase 2)

- [ ] **Clean, current `main`.** Release is cut from `main` at a commit that is an
      ancestor of `origin/main` (the workflow's `verify` job enforces
      `git merge-base --is-ancestor $SHA origin/main`).
- [ ] **`package.json` version is exactly `0.1.0-alpha.1`** (confirmed on `origin/main`).
- [ ] **`CHANGELOG.md` heads with `## 0.1.0-alpha.1` dated today, not `unreleased`.**
      ⚠️ **Currently still `— unreleased`.** See "Release-readiness change" below.
- [ ] **CI green on the release `main` commit**: lint, build, unit tests, e2e.
- [ ] **No generated-source drift** (checked in step 2 below).
- [ ] **One-time trust setup done** (`RELEASING.md` §"One-time trust setup"):
      `npm-release` GitHub environment with a required reviewer, no self-review,
      no admin bypass, tags limited to `v*.*.*`; npm trusted publisher configured;
      **no npm write token in GitHub.** ← captain: confirm one-time setup is complete.
- [ ] **npm CLI ≥ 11.5.1** on the runner (asserted by `publish.yml`) and on the
      maintainer's promotion terminal.
- [ ] **2FA** available on the maintainer's npm account for the promotion step.

Set the version variable once and reuse it in every command:

```sh
export VERSION="$(node -p "require('./package.json').version")"   # -> 0.1.0-alpha.1
```

---

## Release-readiness change needed (small direct-PR at cut time)

Only **one** item is not release-ready, and per the runbook it is intentionally
done at cut time, not now:

- **`CHANGELOG.md`**: swap the heading `## 0.1.0-alpha.1 — unreleased` to
  `## 0.1.0-alpha.1 — YYYY-MM-DD` using the **actual release date**, merged through
  the normal protected-`main` PR process (`RELEASING.md` step 1).

I have **deliberately not pre-dated it** in this prep branch: the release date
depends on the captain's go, which may land on a different day, and a wrong date
is silent. The changelog **content** for `0.1.0-alpha.1` is already fully written
on `main`, so nothing else needs authoring. When the go arrives, the date swap is
the one-line PR to merge before tagging.

Everything else (version, notes, workflows, trust setup) is already in place.

---

## Phase 2 checklist — exact commands (DO NOT RUN until captain's go)

### 1. Land the version + dated changelog on `main`  *(reversible; normal PR)*

Merge the changelog date swap (above) via the normal protected-`main` PR flow, then:

```sh
git switch main
git pull --ff-only origin main
test "$(node -p "require('./package.json').version")" = "$VERSION"   # 0.1.0-alpha.1
grep -m1 "^## ${VERSION} " CHANGELOG.md                              # dated, not 'unreleased'
```

### 2. Confirm CI green + no generated drift  *(read-only)*

```sh
# CI must be green on this main commit (lint, build, unit, e2e).
bun run gen
git diff --exit-code -- '*.generated.ts' '*.generated.css'          # must be clean
```
(If `bun` is not on PATH: `export PATH="$HOME/.bun/bin:$PATH"`.)

### 3. ⛔ Create and push the annotated tag  *(FIRST IRREVERSIBLE STEP — captain gate)*

This push is what triggers `publish.yml`. Do it only on the captain's explicit go.

```sh
git switch main
git pull --ff-only origin main
test -z "$(git status --porcelain)"
test "$(node -p "require('./package.json').version")" = "$VERSION"
git tag -a "v${VERSION}" -m "big-plan ${VERSION}"
git push origin "v${VERSION}"
```

### 4. Approve and watch the publish workflow  *(publishes to `next`)*

- Open the **"Publish npm canary"** run for tag `v0.1.0-alpha.1`.
- In the `npm-release` environment approval, **verify the tag and commit first**,
  then approve. The workflow independently re-runs CI, then
  `npm publish --access public --tag next --provenance` via OIDC, then smoke-tests
  `guidance`, `validate`, and `render` in a clean environment.
- The run **must finish green** before continuing.

### 5. Verify the canary + public provenance  *(read-only)*

```sh
test "$(npm view big-plan@next version)" = "$VERSION"
npm view "big-plan@${VERSION}" dist.tarball dist.integrity
export PROVENANCE_DIR="$(mktemp -d)"
npm install --ignore-scripts --prefix "$PROVENANCE_DIR" "big-plan@${VERSION}"
npm audit signatures --prefix "$PROVENANCE_DIR"     # must report a verified provenance attestation
rm -rf "$PROVENANCE_DIR"
```
Also confirm the npm version page links the attestation to the expected GitHub
commit and `publish.yml` run.

### 6. ⛔ Promote to `latest`  *(SECOND IRREVERSIBLE STEP — makes it installable)*

From a **trusted maintainer terminal authenticated to npm with 2FA** (npm account
that owns `big-plan`). This moves a dist-tag; it does **not** publish again.
**Required** — until it runs, `npx -y big-plan@latest` still serves the old version.

```sh
npm dist-tag add "big-plan@${VERSION}" latest
test "$(npm view big-plan@latest version)" = "$VERSION"
npx -y big-plan@latest --version                    # first-time-user path resolves this version
```

### 7. ⛔ Publish the GitHub release  *(THIRD IRREVERSIBLE STEP — announcement, last)*

Only once `latest` reports `$VERSION` (a note published before promotion tells
readers to install a version `npm install` cannot yet reach):

```sh
export NOTES="$(mktemp)"
awk -v v="## ${VERSION} " 'index($0,v)==1{f=1;print;next} f&&/^## /{exit} f' \
  CHANGELOG.md > "$NOTES"
test -s "$NOTES"
gh release create "v${VERSION}" --title "big-plan ${VERSION}" --notes-file "$NOTES"
rm -f "$NOTES"
```
No release assets — the artifact is the npm package. (Use `gh-axi` for the GitHub op.)

**Do not promote (steps 6–7)** if CI, generated drift, the publish workflow,
provenance, or the canary smoke test is missing or red.

---

## 8. Post-publish clean-setup verification  *(ACCEPTANCE — required)*

Prove that a **brand-new user** can install and complete a first review using
**only the published package**, on an environment with **no prior Big Plan state**
(a pristine temp `HOME` on this Mini is acceptable **only** if it has no cached
Playwright browsers and no Big Plan state dirs; a fresh account is better).
**Capture a transcript/recording as evidence.**

Follow the [bigplan.dev](https://bigplan.dev) install + first-review path
(`docs/.../intro/installation.md`, `first-review.md`) verbatim:

```sh
# Isolated, state-free environment (no cached browsers / state dirs).
export CLEAN_ROOT="$(mktemp -d)"
export HOME="$CLEAN_ROOT/home"
export BIG_PLAN_STATE_DIR="$CLEAN_ROOT/state"
export NPM_CONFIG_CACHE="$CLEAN_ROOT/npm-cache"
export XDG_CACHE_HOME="$CLEAN_ROOT/cache"            # keep Playwright's browser cache local too
mkdir -p "$HOME" "$BIG_PLAN_STATE_DIR" "$CLEAN_ROOT/work" && cd "$CLEAN_ROOT/work"

# 1. Install with no prior state — resolves the promoted `latest`.
npx -y big-plan@latest --version                     # prints 0.1.0-alpha.1

# 2. Read guidance (required gate) and fetch the demo plan the docs use.
npx -y big-plan@latest guidance
curl -o plan.mdx https://bigplan.dev/demo/example-plan.md

# 3. Render + validate the plan from the published CLI.
npx -y big-plan@latest validate plan.mdx
npx -y big-plan@latest render plan.mdx plan.html && test -s plan.html

# 4. Mermaid browser install (clean-machine step from the README/install docs):
#    MermaidDiagram rendering provisions the pinned headless Chromium once.
bunx playwright@1.61.1 install chromium

# 5. Start a live first review and exercise the agent connect flow.
npx -y big-plan@latest review plan.mdx               # opens the local loopback review URL
#   In a second shell (same CLEAN_ROOT env), the agent connects to the exchange:
npx -y big-plan@latest agent plan.mdx                # agent connect flow: next / push / note / respond
```

**Success looks like:**
- `--version` prints `0.1.0-alpha.1` with **no prior state present**.
- `guidance` prints, and gated `validate`/`render`/`review` run after it.
- `render` writes a self-contained `plan.html` that opens with a full reading
  experience even with scripts disabled.
- A `MermaidDiagram`-bearing plan renders after the one-time Chromium install.
- `review` serves a loopback review; the **agent connects** and the reviewer can
  comment, answer decisions, and reach **Approve plan** — the full first-review
  loop from the docs.
- A **transcript/recording** of the above is saved as the acceptance evidence
  (save under `data/bp-big-alpha-release/` for the record).

---

## Rollback / kill switch  (`RELEASING.md` §"Kill switch and rollback")

If the release is bad, move `latest` back first, then deprecate the bad version —
**never unpublish.**

```sh
export LAST_GOOD="x.y.z"      # e.g. a prior good version if one exists
export BAD_VERSION="0.1.0-alpha.1"
npm dist-tag add "big-plan@${LAST_GOOD}" latest
npm deprecate "big-plan@${BAD_VERSION}" "Bad release; use big-plan@${LAST_GOOD}."
```
If caught while only on `next`, skip the `latest` move, deprecate it, and point
`next` at the intended canary: `npm dist-tag add "big-plan@${LAST_GOOD}" next`.

Note: this is the **first** release, so there is no prior good version to roll
back to. A bad `0.1.0-alpha.1` is deprecated in place and superseded by
`0.1.0-alpha.2`.

---

## Summary for the captain

- **Nothing outward-facing has been done.** This is the dry run only.
- **Version `0.1.0-alpha.1` is already set** on `main`; **release notes are already
  written** in `CHANGELOG.md`. The only pending release-readiness edit is the
  one-line changelog `unreleased → date` swap, to be merged at cut time.
- **Publishing is via GitHub Actions OIDC**, not a laptop `npm publish`. The only
  local irreversible acts are: **(3)** push tag `v0.1.0-alpha.1`, **(6)** `npm
  dist-tag add ... latest` (needs the maintainer's 2FA npm account), **(7)** `gh
  release create`.
- **npm identity to confirm:** trusted publisher `josh-padnick / big-plan /
  publish.yml / npm-release`; human promotion by the `big-plan` package owner
  (`josh-padnick`'s npm account) with 2FA.
- **Acceptance** includes a **clean-setup, state-free verification** of the
  published package through the full bigplan.dev install + first-review path
  (guidance → render → Mermaid Chromium install → live review + agent connect),
  with a captured transcript/recording.

**Awaiting the captain's explicit go before any Phase 2 step.**
