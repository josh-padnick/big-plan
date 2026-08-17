# Contributing to Big Plan

Thanks for contributing!
The workflow is intentionally light:

- **DCO sign-off and commit body.** Every commit must include a body and be signed off, certifying the [Developer Certificate of Origin](https://developercertificate.org/).
  `bun install` wires committed `prepare-commit-msg` and `commit-msg` hooks (`.githooks/`, see `scripts/git-hooks/`) into the checkout's effective Git hook path.
  Together they add the trailer and a fallback body automatically when either is missing from command-line and editor-authored messages, so plain `git commit -m "..."` already complies; no need to pass `-s` by hand.
- **Feature branches.** Branch off `main` and open a pull request back into `main`.
- **Small PRs.** Keep pull requests small and reviewable; prefer several self-contained increments over one large change.
- **Checks.** Run `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e` before opening a pull request; CI enforces the same checks on branches pushed to this repository.
- **License.** Big Plan is [MIT](LICENSE) licensed; contributions are accepted under the same license.

## Do not overwrite merged work

A pull request must not remove work that is already on `main`.
CI runs a merge guard on every push (`scripts/merge-guard/check.mjs`, also available as `bun run check:merge-guard`).
The guard enforces two rules.

1. The merge result may differ from `main` only in files that the branch's own non-merge commits touch.
2. A file that `main` changed after the branch's fork point must not sit at its fork-point content in the merge result.

Rule 1 finds a file that changes with no commit on the branch to explain the change.
Rule 2 finds a file that the branch edited and then put back, so the change from `main` is thrown away.
Both losses happen most often when a contributor merges `main` into a long-lived branch and resolves the conflicts by hand.
A bad resolution keeps the branch's older version, so a landed feature disappears and Git records no deletion.
When a comparison the guard needs cannot run, the guard reports `unresolved` and fails instead of passing.

When the guard fails, it names each file, the rule that found it, the commit on `main` that owns it, and the number of lines at risk.
Repair the branch in one of two ways.

1. **Restore the work.** Run the `git checkout main -- <paths>` command that the failure prints, then commit the result.
2. **Declare the removal.** Remove the work on purpose and record the decision in a commit trailer on the branch.
   The same trailer clears a finding from either rule:

   ```text
   Overwrites-main: <path> [<path> ...]
   ```

   Put the reason in the commit body, and name the pull request or commit whose work you remove.
   Any commit on the branch may carry the trailer, and a branch may carry several.
   Paths must be exact and repository-relative; the guard accepts no wildcards, so each removal stays visible to a reviewer.
   The failure message prints a ready `git commit --allow-empty` command with the correct trailer lines.

The guard is deliberately narrow to keep false alarms near zero.
The file header in `scripts/merge-guard/check.mjs` states what the guard does not catch, and it records the measured evidence behind both rules and behind the rejected detectors.

### The stale-copy warning

One loss shape gets past the guard: a branch that writes stale file bytes as ordinary fresh commits, which is how PR #117 overwrote five days of `main`.
CI therefore also runs `scripts/merge-guard/warn-stale-copy.mjs` (also available as `bun run warn:stale-copy`).
It counts the lines that the branch's landing tree drops from `main`, then names the `main` commits that wrote them.

**This check never fails the build.** It exits 0 on every outcome, including its own internal failure, which it reports on a visible line.
It is a warning because the measure cannot tell a stale copy from an honest large refactor: both delete `main` lines in bulk, and neither leaves any other trace.

The warning speaks when at least 10 files each drop 5 or more `main` lines and the branch drops 500 or more such lines in total.
Replayed over 109 real merges in this repository, that fires 13 times and catches both known loss events.
The file header records the full measurements and the thresholds that were tried and rejected.

When you see the warning:

- If the branch rewrites that code on purpose, ignore it.
- If the branch copied files from a stale branch or an old worktree, rebase and redo the change on top of the current `main`.
- To silence one path on purpose, declare it with the same `Overwrites-main` trailer the blocking guard honours.

**A human adjudicates every warning.** The captain decided on 2026-08-17 that firstmate reviews each one and determines whether an overwrite is really happening; no agent acts on it automatically.
Silence is therefore not a promise that no work was lost. It only means the branch stayed under the thresholds.

## Styling changes

There is no pixel-history CI gate and no visual contract in commit subjects.
Visual quality is established by human review of the rendered review document plus the ordinary checks above.

When you change anything a reader sees:

- Pick values from the scales in [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md) rather than inventing new ones.
- Render an affected example, such as `node bin/big-plan.mjs render examples/all-components.mdx`, and read the result in both light and dark appearances at desktop and phone widths before opening the pull request. For colour-theme work, exercise every affected theme.
- Keep `bun run lint` green: the stylesheet-contract and design-system checks enforce the CSS escape-hatch rules and the declaration ratchet.
- Describe the intended visual change in the pull request so a reviewer knows what to look at.

See [AGENTS.md](AGENTS.md) for architecture, [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md) for the design scales a visual change picks from, [_internal/ENGINEERING_PRACTICES.md](_internal/ENGINEERING_PRACTICES.md) for engineering practices, and [README.md](README.md) for development commands.

Wireframe changes must also pass the rendered geometry fence in `test/wireframe-quality.spec.ts`.
That browser check renders the proof and form-factor showcase documents at their declared device sizes and rejects cramped panes, overlapping regions, dead layout bands, and device-shell mismatches.
Run it alone with `bun run test:e2e -- test/wireframe-quality.spec.ts`.
