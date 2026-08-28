<!--
Owns the executable npm release, promotion, and rollback procedure for Big Plan.
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

## Release checklist

Set the release version once and use it throughout these commands:

```sh
export VERSION="$(node -p "require('./package.json').version")"
```

1. Merge the version change through the normal protected-`main` pull-request process. Confirm `package.json` contains exactly `$VERSION`.
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

7. From a trusted maintainer terminal authenticated to npm with 2FA, promote the already-published bytes. This moves a dist-tag; it does not publish again:

   ```sh
   npm dist-tag add "big-plan@${VERSION}" latest
   test "$(npm view big-plan@latest version)" = "$VERSION"
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
