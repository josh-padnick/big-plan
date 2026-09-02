---
title: Supply chain and releases
description: How Big Plan is published, and how to verify that a tarball came from this repository.
---

Big Plan ships as the [`big-plan`](https://www.npmjs.com/package/big-plan) npm package and is normally run with `npx big-plan` or installed with `npm install -g big-plan`.
Two properties of that model are worth knowing:

- **An unversioned `npx` run may use a local package.** A machine that runs `npx big-plan` may execute a matching version already installed in the local project rather than fetch a release. Use `npm view big-plan dist-tags` to see which versions npm's `latest` and `next` channels currently select. Pin an exact version (`npx big-plan@<version>`) or install that version globally if your environment requires a fixed, reviewed release.
- **Releases are published with npm provenance, from CI only.** Publishing happens exclusively in the tagged-release GitHub Actions workflow, using npm Trusted Publishing over OIDC rather than a long-lived token. That workflow refuses to publish unless the tag equals the package version and points at a commit on `main`, and it runs the full lint, build, generated-file-drift, unit, and end-to-end suites first. Every release is published to the `next` dist-tag, then both `big-plan@next` and the exact published version are smoke-tested from a clean environment. The provenance attestation lets you verify a published tarball was built by that workflow from this repository:

  ```sh
  version="${BIG_PLAN_VERSION:?Set BIG_PLAN_VERSION to the exact version to verify}"
  audit_dir="$(mktemp -d)"
  npm --prefix "$audit_dir" install "big-plan@$version"
  npm --prefix "$audit_dir" audit signatures
  ```

  `npm audit signatures` needs npm 9.5 or newer, and it verifies the registry signatures and provenance attestations of the **whole installed dependency graph** in that directory, not Big Plan alone. Installing into an empty prefix first is what keeps its answer about the release you meant to check. See [npm's documentation on viewing package provenance](https://docs.npmjs.com/viewing-package-provenance/).

Big Plan makes no outbound network requests to remote services. It reads and writes plan files and its own state directory on your machine, and the local review runtime communicates only over loopback.

## Related

- [Reporting a vulnerability](/concepts/security-policy/) — if you find a problem here.
- [Install Big Plan](/intro/installation/) — the install paths this describes.
