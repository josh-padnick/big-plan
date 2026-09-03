<!--
Owns the executable npm release, promotion, and rollback procedure for Big Plan,
and the changelog discipline that release follows.
-->

# Releasing Big Plan

Big Plan releases are immutable npm versions published by GitHub Actions to the `next` dist-tag, then promoted by moving `latest` after the canary passes. Never run `npm publish` from a laptop and never add an npm write token to GitHub.

## One-time trust setup

Complete these settings before cutting the first tag. They are part of the release boundary, not optional hardening.

1. In GitHub, create an environment named `npm-release`.
2. Add a required reviewer, prevent self-review, disallow administrator bypass, and allow only deployment tags matching `v*.*.*`.
3. In the npm settings for `big-plan`, add a GitHub Actions trusted publisher with these exact values:
   - Organization or user: `josh-padnick`
   - Repository: `big-plan`
   - Workflow filename: `publish.yml`
   - Environment: `npm-release`
   - Allowed action: `npm publish`
4. Do not add `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or another npm write credential to GitHub. After the first OIDC publish succeeds, disallow token-based package publishing in npm and revoke obsolete automation tokens.

The workflow needs npm CLI 11.5.1 or newer and runs its publish job on a GitHub-hosted runner. Its `id-token: write` permission lets npm exchange GitHub's short-lived OIDC identity; `--provenance` links the public package to the tag commit and this workflow.

## Changelog

[CHANGELOG.md](CHANGELOG.md) is the release history a reader sees. It has one entry per published npm version, newest first.

**Who writes it.** The release engineer, once per release, as part of cutting it. Nobody adds an entry in a feature pull request: a per-pull-request changelog conflicts on every merge and produces a list of commits instead of a description of the release.

**How an entry is generated.** Start from the machine-generated raw material, then write the entry a first-time reader needs.

```sh
export VERSION="$(node -p "require('./package.json').version")"

# The previous release tag, empty when none exists yet.
export PREVIOUS_TAG="$(git describe --tags --abbrev=0 --match 'v*.*.*' 2>/dev/null || true)"

# `git log` needs a starting point either way; the root commit stands in for
# the first release.
git log --no-merges --format='%s' \
  "${PREVIOUS_TAG:-$(git rev-list --max-parents=0 HEAD)}..main"

# `previous_tag_name` must name a tag that exists, so send it only when there
# is one. Omitted, GitHub chooses the starting point itself.
if [ -n "$PREVIOUS_TAG" ]; then
  gh api "repos/josh-padnick/big-plan/releases/generate-notes" \
    -f tag_name="v${VERSION}" -f previous_tag_name="$PREVIOUS_TAG" --jq .body
else
  gh api "repos/josh-padnick/big-plan/releases/generate-notes" \
    -f tag_name="v${VERSION}" --jq .body
fi
```

`.github/release.yml` groups that generated list by pull-request label. Use it as the source of facts, not as the entry. The entry itself groups those changes by **theme and capability**, in the order a new reader meets them, and says what each one lets a person do. A raw commit or pull-request list is not an acceptable entry.

**Where the prose lives.** The changelog entry and the GitHub release body are the same text. Write it in `CHANGELOG.md`, then paste it into the release; do not maintain two narratives.

**Unreleased work.** The entry being assembled sits at the top under `## <version> — unreleased`. Cutting the release replaces `unreleased` with the release date.

### Generated files are never hand-edited

This is a house rule for the whole repository, and it applies to release artifacts too.

A file whose name carries `.generated.` is an output. Edit its authored input, run its generator (`bun run gen`), and commit both together; CI fails on drift. Hand-editing a generated file works exactly until the next generator run silently erases it.

`CHANGELOG.md` is not one of those files. It is authored prose written from generated raw material, which is why it lives outside the `.generated.` convention and why the generated notes above are input rather than output.

## Prereleases

A prerelease version such as `0.1.0-alpha.1` is published by exactly the same procedure. Only one thing about it needs stating, because getting it wrong is silent:

**A prerelease still has to be promoted to `latest`, or first-time users cannot install it.** `npx -y big-plan@latest` and `npm install -g big-plan` both resolve the `latest` dist-tag. That tag moves only in step 7 of the checklist below, never as a side effect of publishing: `publish.yml` always publishes with `--tag next`. Skip the promotion and `latest` stays on the previous release, so every documented install command keeps serving the old version while the release notes announce the new one. There is no warning; installs simply keep working and keep being wrong.

Two consequences of promoting a prerelease to `latest` are deliberate and worth knowing:

- `next` and `latest` then point at the same version. That is fine, and the next canary moves `next` off it again.
- A consumer who writes a semver **range** such as `^0.1.0` in a `package.json` will not match `0.1.0-alpha.1`, because ranges exclude prerelease versions unless the range itself names one. This does not affect Big Plan's documented paths, which use the `latest` dist-tag rather than a range.

Nothing else changes. Tags named `v0.1.0-alpha.1` match the `v*.*.*` filter that triggers `publish.yml` and that the `npm-release` environment allows, the workflow's tag-equals-package-version check is a string comparison, and the CLI's update notice compares prerelease identifiers by semver precedence rather than lexically.

## Before the launch tag

The tag must be cut from a tree with no ambiguous in-flight work, and the release checklist below assumes that is already true. [RELEASING-pr-hygiene.md](RELEASING-pr-hygiene.md) is the record that makes it true: every open pull request and every remote branch not merged into `main` carries a disposition there, with the evidence it rests on.

Confirm before step 1 that the record names no open decision and no live lane still outstanding. A branch nobody has ruled on is indistinguishable from one somebody is still working on, and the difference stops being recoverable once the tag is published.

## Release checklist

Set the release version once and use it throughout these commands:

```sh
export VERSION="$(node -p "require('./package.json').version")"
```

1. Merge the version change and the release's [changelog entry](#changelog) through the normal protected-`main` pull-request process. Confirm `package.json` contains exactly `$VERSION`, and that `CHANGELOG.md` heads with `## $VERSION` dated today rather than `unreleased`.
2. Confirm CI is green on that `main` commit, including lint, build, unit tests, and e2e tests.
3. Confirm generated-source drift is clean:

   ```sh
   bun run gen
   git diff --exit-code -- '*.generated.ts' '*.generated.css'
   ```

4. Start from a clean, current `main`, then create and push one annotated version tag:

   ```sh
   git switch main
   git pull --ff-only origin main
   test -z "$(git status --porcelain)"
   test "$(node -p "require('./package.json').version")" = "$VERSION"
   git tag -a "v${VERSION}" -m "big-plan ${VERSION}"
   git push origin "v${VERSION}"
   ```

5. Open the **Publish npm canary** workflow run for that tag. Approve the `npm-release` environment only after verifying the tag and commit. The workflow must finish green; it independently repeats CI, publishes `big-plan@$VERSION` to `next` through OIDC with provenance, and smoke-tests `guidance`, `validate`, and `render` in a clean environment.
6. Verify the canary and its public provenance on npm:

   ```sh
   test "$(npm view big-plan@next version)" = "$VERSION"
   npm view "big-plan@${VERSION}" dist.tarball dist.integrity
   export PROVENANCE_DIR="$(mktemp -d)"
   npm install --ignore-scripts --prefix "$PROVENANCE_DIR" "big-plan@${VERSION}"
   npm audit signatures --prefix "$PROVENANCE_DIR"
   rm -rf "$PROVENANCE_DIR"
   ```

   The audit must report a verified provenance attestation. The npm version page must link that attestation to the expected GitHub commit and `publish.yml` run.

7. From a trusted maintainer terminal authenticated to npm with 2FA, promote the already-published bytes. This moves a dist-tag; it does not publish again. It is required for every release, [prereleases included](#prereleases): until it runs, `npx -y big-plan@latest` still serves the previous version.

   ```sh
   npm dist-tag add "big-plan@${VERSION}" latest
   test "$(npm view big-plan@latest version)" = "$VERSION"

   # Prove the first-time-user path resolves this version, not the old one.
   npx -y big-plan@latest --version
   ```

8. Only once `latest` reports `$VERSION`, publish the GitHub release for `v${VERSION}` with that version's `CHANGELOG.md` entry as its body. The announcement comes last on purpose: a release note published before promotion tells readers to install a version that `npm install big-plan` still cannot reach.

   ```sh
   export NOTES="$(mktemp)"
   awk -v v="## ${VERSION} " 'index($0,v)==1{f=1;print;next} f&&/^## /{exit} f' \
     CHANGELOG.md > "$NOTES"
   test -s "$NOTES"
   gh release create "v${VERSION}" --title "big-plan ${VERSION}" --notes-file "$NOTES"
   rm -f "$NOTES"
   ```

Do not promote if CI, generated drift, the publish workflow, provenance, or the canary smoke test is missing or red.

## Kill switch and rollback

Move `latest` first so new installs stop receiving the bad version, then deprecate the bad immutable version. Never unpublish it.

```sh
export LAST_GOOD="x.y.z"
export BAD_VERSION="x.y.z"

npm dist-tag add "big-plan@${LAST_GOOD}" latest
npm deprecate "big-plan@${BAD_VERSION}" "Bad release; use big-plan@${LAST_GOOD}."

test "$(npm view big-plan@latest version)" = "$LAST_GOOD"
npm view "big-plan@${BAD_VERSION}" deprecated
```

If the bad release was caught while it was only on `next`, skip the `latest` move and deprecate it. Point `next` at the intended canary before testing another release:

```sh
npm dist-tag add "big-plan@${LAST_GOOD}" next
```
