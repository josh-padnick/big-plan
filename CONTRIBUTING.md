# Contributing to Big Plan

Thanks for contributing!
The workflow is intentionally light:

- **DCO sign-off and commit body.** Every commit must include a body and be signed off, certifying the [Developer Certificate of Origin](https://developercertificate.org/).
  `bun install` wires committed `prepare-commit-msg` and `commit-msg` hooks (`.githooks/`, see `scripts/git-hooks/`) into the checkout's effective Git hook path.
  Together they add the trailer and a fallback body automatically when either is missing from command-line and editor-authored messages, so plain `git commit -m "..."` already complies; no need to pass `-s` by hand.
- **Feature branches.** Branch off `main` and open a pull request back into `main`.
- **Small PRs.** Keep pull requests small and reviewable; prefer several self-contained increments over one large change.
- **Checks.** Run `bun run lint`, `bun run build`, `bun run test`, and `bun run test:e2e` before opening a pull request; CI enforces the same checks on branches pushed to this repository.
- **Merge gates.** A pull request merges only once its review is triaged and its validation is attested, both stated in comments that CI checks. See [Merge gates](#merge-gates).
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

## Merge gates

Two required status checks decide whether a pull request may merge.
They exist because PR #163 merged with seven reviewer findings that nobody had resolved, and no check noticed.
Both gates are statements a machine can verify, so the protocol cannot be forgotten rather than merely agreed to.

| Check                    | Passes when                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `review-triage`          | Exactly one accepted third-party review exists, every inline finding it raised is resolved, and a sign-off names the current head. |
| `validation-attestation` | The pull request states that the `no-mistakes` pipeline passed on the current head, or that it was deliberately skipped and why.   |

`.github/workflows/merge-gates.yml` runs the gates and `scripts/merge-gates/gates.mjs` decides them.
A failing gate prints exactly what is missing and the next action to take, so read the check before asking anyone.

### The comment formats

Post each marker as a plain line in a comment on the pull request conversation.
A line inside a code fence, a blockquote, an indented code block, or an HTML comment does not count, so that documentation, quoted replies, a pasted failure report, and a bot's hidden bookkeeping cannot satisfy a gate by accident.
Only text a human reading the pull request can see counts as a statement you are making.
Any account may write any of them: a human, firstmate, or the lane's own agent.

```text
review-triage: complete <head-sha>
no-mistakes: passed run <run-id> head <head-sha>
no-mistakes: overridden - <reason>
```

The sha may be a short one of seven or more hex digits, and it must name the pull request's current head.

### When to sign off

Sign off last, after every finding has a reply and after the final push.

1. Get one review.
   Any of CodeRabbit, Greptile, or Devin counts; the gate does not care which, so BIG-143's credit-based picker can choose freely.
   Exactly one, because one review per pull request is the budget, and a second review means one of the two was never triaged.
   A reviewer counts while it holds either a review it has not taken back or an unresolved inline thread, so dismissing a review drops that reviewer only once every finding it left is resolved.
2. Resolve every inline finding.
   Reply in the thread saying what you did: the commit that fixes it, or the reason you decline it.
   A thread is resolved, in this gate's sense, once a comment by somebody other than the reviewer exists in it.
   That is this repository's meaning of the word, not GitHub's: ticking GitHub's resolve checkbox resolves nothing here, and the reviewer replying to itself resolves nothing either.
   Hiding a comment changes nothing either - a hidden finding still gates, and a hidden reply does not resolve it - because anyone with write access can hide anything and GitHub does not record who did.
   The written reply is the record a later reader needs, so a finding you believe the reviewer withdrew still costs one reply saying so.
3. Run `no-mistakes` and post its attestation.
4. Post the `review-triage: complete <head-sha>` sign-off.

Any push moves the head and invalidates both the sign-off and the pipeline attestation, including a push that only fixes lint.
That is deliberate: the reviewer's findings were raised against code that no longer exists.
Re-triage, then re-post both markers naming the new head.

Draft pull requests are judged too, and a red gate on a draft mid-flow is expected.
The gate binds at merge, through branch protection.

### When no reviewer is available

When reviewer credits are gone, run the adversarial review yourself and attest to it.
The attestation stands in for the bot review, so it carries what a bot review carries: the commit it read, who read it, and what it found with each finding's disposition.

```text
adversarial-review: complete <head-sha> by <agent>
findings: <n>
1. <finding> - resolved: fixed|declined|deferred - <how, or why not>
2. <finding> - resolved: fixed|declined|deferred - <how, or why not>
```

The sha must be a commit on this pull request, and the number of findings declared must not exceed the number of disposition lines.
Post at most one accepted review per pull request: an attestation posted while a bot has already reviewed fails the gate.
Clear it by deleting the attestation comment, or by resolving the bot's findings and then dismissing its review - dismissal alone leaves the bot counted while any of its threads is unresolved.

### The override rule

`no-mistakes: overridden - <reason>` is the sanctioned path for work the pipeline genuinely does not apply to.
It passes the gate and says so loudly: the check's title reads `OVERRIDDEN`, and its body names the reason and the account that declared it.
The reason has to be one a reader can weigh: at least eight characters, so a shrug such as `n/a` is refused.
A refused override is named in the failing check, with the reason it was refused, rather than dropped silently.

An override with no sha stays in force for the rest of the pull request.
Add a trailing `head <sha>` to scope it to one commit instead, and a later push then requires a fresh statement.

### Re-running a gate

A gate re-runs by itself whenever the pull request changes: a push, a review, an inline comment, or a conversation comment, including an edited or deleted one.
Writing the missing comment is therefore enough to turn a gate green; no push is needed.

One exception: a pull request from a fork.
The events that carry a push, a review, or an inline comment run the pull request's own copy of the gate, and running fork-authored code on the self-hosted runner is what the policy at the top of `.github/workflows/ci.yml` forbids, so the job skips them.
A fork pull request therefore gets no gate report from its own pushes, its two required checks never report, and the merge stays blocked - the safe direction.
A maintainer judges one deliberately by running the Merge gates workflow from the Actions tab with the pull request number.

A conversation comment runs the workflow file from `main`, not from the pull request's branch, so a change to the gate itself only governs conversation comments once it merges.
Pushes, reviews, and inline review comments run the branch's own copy.
To judge a pull request by hand, run the workflow from the Actions tab with the pull request number, or run it locally:

```sh
GH_TOKEN=$(gh auth token) bun run check:merge-gates <pr-number> --repo=josh-padnick/big-plan --dry-run
```

`--dry-run` prints the verdicts without publishing the check runs.

## Styling changes

There is no pixel-history CI gate and no visual contract in commit subjects.
Visual quality is established by human review of the rendered review document plus the ordinary checks above.

When you change anything a reader sees:

- Pick values from the scales in [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md) rather than inventing new ones.
- Render an affected example, such as `node bin/big-plan.mjs render examples/all-components.mdx`, and read the result in both light and dark appearances at desktop and phone widths before opening the pull request. For colour-theme work, exercise every affected theme.
- Keep `bun run lint` green: the stylesheet-contract and design-system checks enforce the CSS escape-hatch rules and the declaration ratchet, and the palette check enforces every colour theme's ramp completeness and contrast floor.
- Describe the intended visual change in the pull request so a reviewer knows what to look at.

See [AGENTS.md](AGENTS.md) for architecture, [_internal/DESIGN_PRINCIPLES.md](_internal/DESIGN_PRINCIPLES.md) for the design scales a visual change picks from, [_internal/ENGINEERING_PRACTICES.md](_internal/ENGINEERING_PRACTICES.md) for engineering practices, and [README.md](README.md) for development commands.

Wireframe changes must also pass the rendered geometry fence in `test/wireframe-quality.spec.ts`.
That browser check renders the proof and form-factor showcase documents at their declared device sizes and rejects cramped panes, overlapping regions, dead layout bands, and device-shell mismatches.
Run it alone with `bun run test:e2e -- test/wireframe-quality.spec.ts`.
