# PR 54 split report

Status: five draft PRs implemented. The final stack preserves every PR 54 source change and adds two root-fix bridges in the styling slice: the authorized capture-harness fix and the subsequently required Playwright flake fix.

## Chosen stack

All five drafts target `main` and must be reviewed and merged in numeric order. Each later branch descends from the prior branch, so its visible diff contracts to its own slice as predecessors land.

| Order | Draft                                                   | Branch                                         | Review surface                                                                                                     | Rendered plan                                                  |
| ----- | ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1     | [#56](https://github.com/josh-padnick/big-plan/pull/56) | `fm/bp-pr54-1-review-foundation`               | Stable plan/block/passage anchors, loopback review server, durable drafts, first integrated commenting journey     | `.big-plan/pr54-split/01-review-foundation.html`               |
| 2     | [#57](https://github.com/josh-padnick/big-plan/pull/57) | `fm/bp-pr54-2-agent-loop-diffs`                | Immutable agent exchange, CLI launchers, anchored responses, revision snapshots/reverts/diffs                      | `.big-plan/pr54-split/02-agent-loop-and-diffs.html`            |
| 3     | [#58](https://github.com/josh-padnick/big-plan/pull/58) | `fm/bp-pr54-3-commenting-workflow`             | Complete comment lifecycle, navigator, activity/connection truth, responsive and keyboard journeys                 | `.big-plan/pr54-split/03-commenting-workflow.html`             |
| 4     | [#59](https://github.com/josh-padnick/big-plan/pull/59) | `fm/bp-pr54-4-styling-and-causal-diffs`        | CSS ownership, Tailwind conversion, deterministic visual contract, causal revision chain, honest diff mapping      | `.big-plan/pr54-split/04-styling-and-causal-diffs.html`        |
| 5     | [#60](https://github.com/josh-padnick/big-plan/pull/60) | `fm/bp-pr54-5-persistence-and-revision-lenses` | Atomic persistence, recovery/concurrency/rebase hardening, browser workflow actions, all 18 typed component lenses | `.big-plan/pr54-split/05-persistence-and-revision-lenses.html` |

These boundaries follow the product dependency chain. Storage and stable identity make review possible; the exchange protocol makes it agent-backed; the commenting workflow makes it complete; visual and causal contracts make it truthful; persistence and typed lenses harden the completed system. Each decision keeps implementation, focused tests, and the UI behavior it proves together.

The source branch remains untouched:

`origin/fm/bp-commenting-round3 = 25de369a6f59370f5fe6d37675cc9d7ab5c2596e`

## Rendered review plans

The repository CLI guidance was acknowledged before validation and rendering. All five MDX sources validate. Each self-contained HTML document was opened in Chrome and checked for title, contents navigation, expected sections, reader controls, and zero horizontal overflow.

Absolute artifact directory:

`/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split`

The artifacts are committed on `fm/bp-pr54-split`, and every draft description links both the rendered HTML and MDX source.

## Independent green evidence

The GitHub `lint` job runs the complete branch contract: install, lint, build, generated-source drift, unit/style-history tests, Chromium install, and Playwright tests. The separate `style-history` job replays every styling commit from `main` using exact capture evidence. Macroscope reports independently.

| Slice |                             Unit tests | Browser tests | GitHub CI run                     |
| ----- | -------------------------------------: | ------------: | --------------------------------- |
| 1     |                                    944 |            52 | `30997775574`                     |
| 2     |                                    971 |            52 | `30998066366`                     |
| 3     |                                  1,019 |            66 | `30998398283`                     |
| 4     |                                  1,030 |            66 | `31000606152` |
| 5     | 1,061 plus 21 style-history unit tests |            91 | `31000610996` |

The equivalent commands also passed locally at every slice boundary:

- `bun run build`
- `bun run lint`
- `bun run test`
- `bun run test:e2e`

## Capture-harness findings and root fix

PR 54's own head is red on the style-history gate today.

### The two missing captures

The final configuration declares 34 captures, while the PR 54 harness produces 32. The missing files are:

- `components__expanded-thread-reply__desktop__light.png`
- `components__expanded-thread-reply__desktop__dark.png`

The capture action moved a draft into browser-local `sent` state and reloaded. The production runtime correctly owns sent comments in server bootstrap/disk state and ignores browser-local sent recovery state, so the reloaded document had no thread summary to expand. The harness therefore skipped both theme captures.

The bridge constructs a validated server bootstrap from the promoted draft, installs the session/token/bootstrap attributes before runtime initialization, and then reloads. The light and dark expanded-thread captures are now both present, with no production runtime change.

### The eight-pixel flake

Identical hosted runs also alternated between two hashes for `deck__document__desktop__dark.png`. Exact comparison found only eight changed pixels at two rounded-card corners. Layout coordinates, dimensions, text, fonts, and motion state were identical; each differing channel moved by only one value. This isolated CPU-specific Skia antialias rounding rather than product geometry or capture timing.

The harness now:

- launches Chromium with GPU disabled, Skia runtime CPU optimizations disabled, sRGB forced, and device scale fixed at one;
- uses reduced motion and disables animations/transitions for capture;
- crosses two animation frames before sampling;
- requires two consecutive settled screenshots to be byte-identical, trying up to six frames and failing loudly otherwise;
- retains exact zero-pixel comparison—there is no blanket tolerance, ignored region, or per-channel allowance.

The settling loop caught a genuine one-frame transition during investigation, proving that a fixed delay or single screenshot was insufficient.

Proof:

- Three complete local 34-capture matrices were byte-identical file-for-file.
- Two separately triggered hosted evidence ledgers were byte-identical.
- Both hosted ledgers have SHA-256 `2d7cc96758085f8691189d87a77d8459bf526ab3f9f2d758b5d1331149e40bbf`.

### Stable config history

PR 4 adds five new capture keys. The old verifier applied the head config to every historical pair, which would retroactively add captures to PRs 1–3 and invalidate already-approved manifests even when their pixels remained correct.

The bridge now uses each child commit's declared config for that commit/parent comparison while retaining the current deterministic harness. New keys therefore compare both sides of the commit that introduces them, and earlier evidence remains scoped to the contract that approved it. A new regression test proves a later capture-key addition cannot reinterpret an earlier approved manifest.

### Intentional visual evidence

The Tailwind and causal-diff slice is not pixel-empty: its hosted ledger records 28 changed captures and 1,035,563 changed pixels. PR 4 therefore carries exact `[visual:approved]` evidence instead of the earlier incorrect empty claim.

The persistence and typed-lens slice also changes rendered structure: its hosted ledger records 14 changed captures and 5,239,975 changed pixels. PR 5 carries a commit-scoped `[visual:approved]` manifest for those exact hashes and then removes that transient split evidence in a separate cleanup commit, so no split manifest remains in the final tree.

### Playwright locator flake

An earlier PR 4 CI run exposed a second pre-existing nondeterminism in `test/commenting-runtime.spec.ts`: the focus poll succeeded, then a separate `button.boundingBox()` call sometimes failed with “The thread action has no target.”

The locator is live, and focusing the toolbar control can trigger the review runtime to replace that toolbar node. The successful focus observation and later geometry lookup could therefore straddle the replacement gap. A `--repeat-each=10 --workers=5` stress run reproduced the exact failure. The bridge now captures and returns the non-null bounding box inside the same successful `expect.poll` iteration; there is no second lookup against a potentially replaced node. The focused journey passed three consecutive serial repeats, and the complete lint/Playwright job passed after the fix.

## Bridging changes

Capture-related bridge commits:

1. `9837f7590d64395b5fd5cc9e78372137b9779aed` — temporary split scaffolding in PR 1 (`test(style-history): pin deterministic raster frames [visual:empty]`). It makes earlier approved manifests reproducible while the historical slices are replayed. PR 4 removes this transient version.
2. `1529183a1fe9db44fdff7e66d191f7e4a7f7a136` — the final authorized capture bridge in PR 4 (`fix(style-history): make review captures deterministic and complete [visual:empty]`). It contains only the three style-history files for the server-bootstrap correction, deterministic-raster fix, and commit-scoped replay regression.
3. `f44cedcdf3f15d9e199c7b2cc1aef509c56dc851` — the subsequently required test-harness bridge in PR 4 (`fix(test): make live toolbar focus assertion atomic`). It contains only the Playwright locator-atomicity fix.

Approved visual manifests rotate one per slice as split-only review evidence. PR 5 deletes PR 4's manifest while adding its own exact evidence, then deletes its own manifest in the final cleanup commit. They do not remain in the final tree. Other narrow intermediate ordering bridges—identity reconciliation, selectors, generated assets, and milestone assertions—are reconciled to PR 54's own final implementations by PR 5.

## Adjusted completeness proof

PR 54 source head:

`25de369a6f59370f5fe6d37675cc9d7ab5c2596e`

PR 54 source tree:

`576fd746ea4195d896e816ff1c008e6ebb94a464`

Final split head:

`993f2ab5419896c1057635d003b95baa8e185cc3`

Final split tree:

`f363846f0ce713ee219a6ca536ac650ae81cdbd7`

The direct source-to-final diff changes exactly four bridge-owned files:

- `scripts/style-snapshots/capture.mjs`
- `scripts/style-snapshots/verify-history.mjs`
- `scripts/style-snapshots/verify-history.test.mjs`
- `test/commenting-runtime.spec.ts`

The direct source-to-final diff and the aggregate diff of the two final bridges have the same stable patch ID:

`db69f947a4828f3a5a8fa96a1f8a1821411e4615`

The individual stable patch IDs are:

- capture bridge: `c459518d9526949b97fba32ecf92d273d71cb198`
- Playwright bridge: `1710a8ba0e5cfb9ec293053c50f745ad6901957c`

Reverse-applying both final bridges to the final split tree writes:

`576fd746ea4195d896e816ff1c008e6ebb94a464`

That is exactly PR 54's tree, and a final `git diff --exit-code` between them is empty. Therefore:

**stack union minus the two listed final bridges equals PR 54 exactly.**

The capture fix remains its own clearly labeled three-file commit. Before the captain's subsequent instruction to root-fix the Playwright nondeterminism, it was the only net divergence; after complying with that standing engineering rule, the final split head diverges from PR 54 by exactly the capture bridge and the separately labeled one-file Playwright bridge—nothing else.

PR 54 remains open and is prominently marked superseded by #56, #57, #58, #59, and #60 in order.
