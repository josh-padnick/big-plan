# Contributing to Big Plan

Thanks for contributing!
The workflow is intentionally light:

- **DCO sign-off.** Every commit must be signed off: `git commit -s`. This certifies the [Developer Certificate of Origin](https://developercertificate.org/).
- **Feature branches.** Branch off `main` and open a pull request back into `main`.
- **Small PRs.** Keep pull requests small and reviewable; prefer several self-contained increments over one large change.
- **Checks.** Run `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e` before opening a pull request; CI enforces the same checks on branches pushed to this repository.
- **License.** Big Plan is [MIT](LICENSE) licensed; contributions are accepted under the same license.

## Styling commits

CI replays every relevant single-parent commit and compares its pinned Chromium screenshots with its parent.
Because replay installs and executes historical revisions, it runs only in the disposable GitHub-hosted `style-history` job with read-only repository permissions and no persisted checkout credential; do not run the history verifier on a persistent development or CI host.
The active styling files, fixtures, and captured states live in [.style-snapshots/config.json](.style-snapshots/config.json); the verifier unions that configuration with its mandatory coverage floor and every configuration revision in the verification range so a commit cannot narrow its own relevance.
The current capture policy uses `examples/all-components.mdx` as a complete fixture: component captures are selected from the changed component owner's path, while global inputs and the final tip capture every owned region plus a tiled full-document capture. A component capture may match multiple instances; each instance is captured at its own bounds. Keep the full-document target even when adding a new component target because it is the cross-component and layout safety net.
The style-history job uses the Playwright-pinned Chromium, fixed device scale and viewport settings, deterministic color/compositor flags, and the repository's bundled font set. Every capture manifest records the browser, platform, and font-set fingerprint. CI is the pixel-authority environment; local runs with another fingerprint are advisory-only.
CI persists successful verification receipts under `test-results/style-history-receipts`. Receipts are keyed by parent and commit tree hashes and include the capture-policy fingerprint and environment fingerprint, so descendant commit-hash rewrites can reuse an unchanged prefix while any policy, tree, or environment change forces re-verification. Verification reports all commit failures from one run together. A one-channel antialiasing tolerance is the final backstop only; its absorbed pixel count is recorded in the evidence ledger.
Capture definitions present at the merge base are immutable; extend coverage with new capture keys so earlier commits keep their original rendering contract.
Merge commits that resolve a configured styling conflict are rejected because their visual delta cannot be isolated from the merged branch; record the resolution in a single-parent styling commit instead.

End each affected commit subject with one visual contract:

- `[visual:empty]` declares that every configured screenshot remains pixel-identical.
- `[visual:approved]` declares an intentional visual change. The commit must add exactly one manifest under `.style-snapshots/manifests/` describing every changed styling file and capture, including property deltas for each and exact pixel evidence for each capture. Missing evidence is an error even when a clipped or incomplete capture reports zero pixels; there is no legacy allowlist. If an older approved commit in a replay range lacks its manifest, repair that history entry (or regenerate its manifest on the branch being verified) before merging the capture-policy change.

When GitHub squash-merges a stack, keep the visual contract suffix on each affected source commit entry in the squash body.
The verifier reads the approved manifests that survive the squash and checks that they cover every changed capture in the final commit.

Push the branch and use the `style-history` job's uploaded artifact to inspect its evidence ledger and any before, after, and pixel-diff images.
Use that evidence to author an approved manifest, then push the commit so the isolated job can verify it exactly.
The verifier's diagnostics own the manifest's enforced schema.

See [AGENTS.md](AGENTS.md) for architecture, [ENGINEERING_PRACTICES.md](ENGINEERING_PRACTICES.md) for engineering practices, and [README.md](README.md) for development commands.

Wireframe changes must also pass the rendered geometry fence in `test/wireframe-quality.spec.ts`.
That browser check renders the proof and form-factor showcase documents at their declared device sizes and rejects cramped panes, overlapping regions, dead layout bands, and device-shell mismatches.
Run it alone with `bun run test:e2e -- test/wireframe-quality.spec.ts`.
