# Contributing to Big Plan

Thanks for contributing!
The workflow is intentionally light:

- **DCO sign-off.** Every commit must be signed off: `git commit -s`. This certifies the [Developer Certificate of Origin](https://developercertificate.org/).
- **Feature branches.** Branch off `main` and open a pull request back into `main`.
- **Small PRs.** Keep pull requests small and reviewable; prefer several self-contained increments over one large change.
- **Checks.** Run `bun run lint`, `bun run build`, and `bun run test` before opening a pull request; CI enforces the same checks on branches pushed to this repository.
- **License.** Big Plan is [MIT](LICENSE) licensed; contributions are accepted under the same license.

## Styling commits

CI replays every relevant single-parent commit and compares its Chrome screenshots with its parent.
The active styling files, fixtures, and captured states live in [.style-snapshots/config.json](.style-snapshots/config.json); the verifier unions that configuration with its mandatory coverage floor and every configuration revision in the verification range so a commit cannot narrow its own relevance.
Merge commits that resolve a configured styling conflict are rejected because their visual delta cannot be isolated from the merged branch; record the resolution in a single-parent styling commit instead.

End each affected commit subject with one visual contract:

- `[visual:empty]` declares that every configured screenshot remains pixel-identical.
- `[visual:approved]` declares an intentional visual change. The commit must add exactly one manifest under `.style-snapshots/manifests/` describing every changed styling file and capture, including property deltas for each and exact pixel evidence for each capture.

Run `bun run verify:style-history -- --base origin/main` before opening the pull request.
The verifier writes an evidence ledger and any before, after, and pixel-diff images to `test-results/style-history`; use that evidence to author an approved manifest, then rerun the command to verify it exactly.
The verifier's diagnostics own the manifest's enforced schema.

See [AGENTS.md](AGENTS.md) for architecture and engineering rules, and [README.md](README.md) for development commands.
