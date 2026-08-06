<!--
Records the 2026-08-05 preservation and content audit of three formerly local-only branches.
This is evidence for a branch-retirement decision; it does not propose merging the old histories.
-->

# Preserved branch audit

Audit date: 2026-08-05  
Main audited: `origin/main` at `980df22dccb8005ee62a14169482ba93f6c02d49`

**Retirement path.** This is a temporary planning artifact under the AGENTS.md documentation map, not a maintained document.
Once its recovery tracks are filed as GitHub issues, delete this file and let the issues carry the work.
The preserved remote refs, not this snapshot, are what must survive.

## Preservation

Each branch was pushed without rebasing, merging, squashing, amending, or modifying its worktree. A direct `git ls-remote --heads origin` read after each push returned:

| Remote ref                             | Preserved head                             |
| -------------------------------------- | ------------------------------------------ |
| `refs/heads/fm/bp-desktop-width-fix`   | `88816cc76c79e2fde6bee4c7b45a699e52caa992` |
| `refs/heads/fm/bp-formfactors-sol`     | `3301b85515121ea5201c6f5e7a4d92238df5e39b` |
| `refs/heads/fm/bp-wireframe-hierarchy` | `a56876c29751854e459616a0ac0e4c375340039c` |

## Evidence model

SHA and aggregate-diff comparisons are intentionally not used as proof because the branches predate current main and their work later moved through squash commits. The main-side anchors are:

- `f4eff9c4` / PR 37, which squashed the deck-collapse commits and names their subjects in its commit message.
- `1d9b1e8c` / PR 53, which has the same parent (`854997dc`) as the hierarchy lane's consolidated wireframe commit `1fce07b0` and replaces it with a larger CLEAR-quality implementation.
- `1c1fe5b2` / PR 36, which supplies shared maximize behavior to several figure families, but not to `Wireframe`.
- `711869c1` / PR 48, which supplies in-place `FlowDiagram` feedback, but not plan-wide or Wireframe feedback transport.
- `b14d38f3` / PR 45, which supplies stable plan identity for current persisted viewer state, but not stable per-block comment addresses.

Current-tree evidence was checked in the affected authored files. In particular, main contains the 48rem desktop containment, 45.5rem prose measure, figure/card widths, two-line queue rows, form-factor device model, table shrink-wrapping, code-snippet spacing, and quiet branding-bar title. Main does not contain `src/review/`, `src/cli/review/`, `assets/review/`, `block-identity.ts`, a Wireframe maximize toolbar, Wireframe element-comment targets, or the Wireframe engagement/scroll state.

## `fm/bp-desktop-width-fix`

Unique history: 57 commits (54 single-parent commits and 3 merges).

| Commit     | Classification | Main-side evidence                                                                                                                                                               |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ba883490` | LANDED         | Deck collapse is in `f4eff9c4`; that squash names this subject.                                                                                                                  |
| `6bb417b5` | LANDED         | Outside collapse chrome and hover behavior are in `f4eff9c4`.                                                                                                                    |
| `66526b79` | LANDED         | Stable hover travel to the outside control is in `f4eff9c4`.                                                                                                                     |
| `5927d628` | OBSOLETE       | The temporary vertical-slice design note was replaced by the shipped Wireframe code and product docs in `1d9b1e8c`; `plans/wireframe-vertical-slice.md` is intentionally absent. |
| `d1a745b8` | LANDED         | Declarative `Wireframe`, compilation, rendering, examples, and tests ship in `1d9b1e8c`.                                                                                         |
| `3345e745` | LANDED         | Collapse-control alignment and compact collapsed chrome are in `f4eff9c4`.                                                                                                       |
| `1db0c60f` | LANDED         | The product-shell vocabulary and bounded authoring contracts ship in `1d9b1e8c`.                                                                                                 |
| `f2f1f6b8` | OBSOLETE       | Its artboard/open-question notes were resolved into the device model, guidance, and geometry tests in `1d9b1e8c`.                                                                |
| `97817576` | LANDED         | Uniform collapsed headers and quiet icon treatment are in `f4eff9c4`.                                                                                                            |
| `5103f58d` | LANDED         | Patrick Hand, its generator, embedded font CSS, and licensing files ship in `1d9b1e8c`.                                                                                          |
| `fbb8d52f` | LANDED         | The durable licensing record is present at `assets/fonts/README.md`; the temporary design-note half was superseded.                                                              |
| `abdac539` | LANDED         | The merge reconciled collapse and Wireframe viewer code; main carries both through `f4eff9c4` and `1d9b1e8c`.                                                                    |
| `70a1b365` | LANDED         | Form controls, Stepper/Step, Connector, and their contracts ship in `1d9b1e8c`.                                                                                                  |
| `a300ae26` | LANDED         | Main's workflow-builder example still has 11 screens and describes them as ten desktop plus one mobile.                                                                          |
| `0cae1745` | OBSOLETE       | The temporary width-question note was resolved by PR 53's width and geometry contracts.                                                                                          |
| `19acb07f` | LANDED         | Device-native framing and route/chrome validation ship in `1d9b1e8c`.                                                                                                            |
| `8fafdd9e` | LANDED         | Main's desktop AppShell keeps its navigation full-height.                                                                                                                        |
| `bb192829` | LANDED         | Desktop-native AppShell and phone `BottomBar` ship in `1d9b1e8c`.                                                                                                                |
| `5ad2cf78` | LANDED         | Device-honesty guidance is present and strengthened in current Wireframe guidance.                                                                                               |
| `350452b4` | LANDED         | Device-form-factor behavior is covered by PR 53's unit and rendered-geometry tests.                                                                                              |
| `99525f61` | LANDED         | The Harbor multi-device showcase ships as `examples/wireframe-form-factors.mdx`, later refined by PR 53.                                                                         |
| `e84af45c` | LANDED         | Semantic `main`/`rail` span behavior and denser device layouts ship in current Wireframe code.                                                                                   |
| `aafb6098` | LANDED         | Form-factor visual rules are present and strengthened in current guidance.                                                                                                       |
| `ada47d71` | LANDED         | Main/rail layout coverage was absorbed into PR 53's larger contract and geometry suites.                                                                                         |
| `e881a5b0` | LANDED         | The refined Harbor desktop/phone content is represented by the current PR 53 showcase.                                                                                           |
| `92197bf5` | LANDED         | Semantic `list` panes ship alongside `main` and `rail`; current CSS gives the list a bounded master-column role.                                                                 |
| `9957bf87` | LANDED         | The durable hierarchy/CRAP principles are present in current plan and Wireframe guidance.                                                                                        |
| `2484cfe6` | LANDED         | `list`/`main`/`rail` behavior is covered by current definition and geometry tests.                                                                                               |
| `f5ed1c80` | LANDED         | Harbor's master-detail/workspace-density scenario remains in the current showcase, with later improvements.                                                                      |
| `7c968c2b` | LANDED         | Reference-pattern and product-only artboard-copy rules ship in current guidance/lint.                                                                                            |
| `deb621ae` | LANDED         | Desktop panes, selected rows, message timelines, and in-prototype navigation ship in current code.                                                                               |
| `ada8bab3` | LANDED         | Whole-row mobile navigation, message timeline, and light bottom navigation ship in current code.                                                                                 |
| `82bad20c` | LANDED         | Its durable primitives (`Table`, `Breadcrumbs`, `Center`, toned state, plain-by-default regions) ship in PR 53; its temporary borrowed-margin technique was later removed.       |
| `51eefada` | LANDED         | Current `view.tsx` explicitly renders every queue item as a truncating title line plus metadata line, with matching CSS.                                                         |
| `ed1ae479` | LANDED         | Current Wireframe CSS has the exact centered/end-aligned button and badge rules.                                                                                                 |
| `c674b5da` | OBSOLETE       | Its separate `Rail` component was replaced by the cleaner semantic `span="rail"` model consolidated into PR 53; the dominant-form/secondary-rail outcome remains.                |
| `cb5e8737` | LANDED         | Main uses the 72rem content column and constrains prose inside it; the margin-borrowing mechanism is absent.                                                                     |
| `0b1d414b` | LANDED         | Callouts share the standard prose measure in current `prose.css`.                                                                                                                |
| `588e5e8d` | LANDED         | Current prose measurement applies throughout the article with explicit table/Wireframe exceptions.                                                                               |
| `f8708400` | LANDED         | The Wireframe margin escape is absent and current render tests guard containment.                                                                                                |
| `3c81bb56` | LANDED         | Main has shared `--measure`, `--card-measure`, and wide-figure card sizing; tables remain the breakout.                                                                          |
| `708e5f1b` | LANDED         | Main has a separate `--card-figure` step for Wireframe-bearing slides.                                                                                                           |
| `19d5cb0f` | LANDED         | Current `global.css` sets `--measure: 45.5rem` and aligns prose-like chrome to it.                                                                                               |
| `c93248c0` | LANDED         | Current TOC part headers sit outside the grouped-entry rule/inset.                                                                                                               |
| `83cef51f` | LANDED         | Current grouped TOC links use the 14px (`pl-3.5`) indent.                                                                                                                        |
| `af3f4006` | LANDED         | Current desktop Contents header has the bottom rule and padding.                                                                                                                 |
| `efb87bef` | LANDED         | Current Wireframe view names a screen only when `model.screens.length > 1`.                                                                                                      |
| `57067763` | LANDED         | Current TableOfContents rows use `w-fit max-w-full` and max-content text columns.                                                                                                |
| `f5f2b9dc` | LANDED         | Current Markdown tables use `width: max-content` without `min-width: 100%`.                                                                                                      |
| `69374853` | LANDED         | Current CodeSnippet body owns vertical padding and line content has the wider horizontal inset.                                                                                  |
| `cc62950c` | LANDED         | Current table wrappers use `w-fit max-w-full`, retaining horizontal overflow for wide tables.                                                                                    |
| `e1211624` | LANDED         | Current shell renders escaped, muted, truncated `data-plan-title` chrome with tests.                                                                                             |
| `72cfe0b6` | LANDED         | The form-factor merge's substantive tree is in `1d9b1e8c`.                                                                                                                       |
| `abed25c1` | LANDED         | The layout/Wireframe conflict resolutions were consolidated and then shipped by `1d9b1e8c`.                                                                                      |
| `0f58bc0b` | LANDED         | PR 53 ships the consolidated `device` model, semantic spans, examples, viewer fit, and docs.                                                                                     |
| `4c652933` | LANDED         | Captain form-factor polish (segmented modes, disabled state, phone/settings refinements) is present and further strengthened by PR 53.                                           |
| `88816cc7` | LANDED         | Current CSS has the exact 48rem desktop review cap and current tests guard containment.                                                                                          |

Recommendation: **safe to retire after the captain confirms the remote preservation is sufficient**. There is no substantive `NOT LANDED` commit. The three `OBSOLETE` records are temporary notes or superseded primitives, not recoverable product value.

## `fm/bp-formfactors-sol`

Unique history: 36 commits (35 single-parent commits and 1 merge).

| Commit     | Classification | Main-side evidence                                                                                                                               |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ba883490` | LANDED         | Deck collapse is in `f4eff9c4`; that squash names this subject.                                                                                  |
| `6bb417b5` | LANDED         | Outside collapse chrome and hover behavior are in `f4eff9c4`.                                                                                    |
| `66526b79` | LANDED         | Stable hover travel to the outside control is in `f4eff9c4`.                                                                                     |
| `5927d628` | OBSOLETE       | PR 53 replaced the temporary vertical-slice design note with shipped code and docs.                                                              |
| `d1a745b8` | LANDED         | Declarative Wireframe compilation/rendering ships in `1d9b1e8c`.                                                                                 |
| `3345e745` | LANDED         | Collapse-control alignment and compact collapsed chrome are in `f4eff9c4`.                                                                       |
| `1db0c60f` | LANDED         | The product-shell vocabulary and authoring contracts ship in PR 53.                                                                              |
| `f2f1f6b8` | OBSOLETE       | Its open questions were resolved by PR 53's device model and tests.                                                                              |
| `97817576` | LANDED         | Uniform collapsed headers and icon treatment are in `f4eff9c4`.                                                                                  |
| `5103f58d` | LANDED         | The bundled hand-drawn font and generator ship in PR 53.                                                                                         |
| `fbb8d52f` | LANDED         | The durable font licensing record is on main; the design-note half was superseded.                                                               |
| `abdac539` | LANDED         | Main carries both sides of the integration through `f4eff9c4` and `1d9b1e8c`.                                                                    |
| `70a1b365` | LANDED         | Forms, wizards, and flow connectors ship in PR 53.                                                                                               |
| `a300ae26` | LANDED         | Main's workflow example still represents 11 screens.                                                                                             |
| `0cae1745` | OBSOLETE       | PR 53 resolved the temporary width investigation into product contracts.                                                                         |
| `19acb07f` | LANDED         | Native device frames and route/chrome validation ship in PR 53.                                                                                  |
| `8fafdd9e` | LANDED         | Current desktop navigation runs full height.                                                                                                     |
| `bb192829` | LANDED         | Desktop AppShell and phone BottomBar ship in PR 53.                                                                                              |
| `5ad2cf78` | LANDED         | Device-honesty guidance is present and strengthened on main.                                                                                     |
| `350452b4` | LANDED         | Form-factor behavior is covered by current unit and geometry tests.                                                                              |
| `99525f61` | LANDED         | The multi-device Harbor showcase ships on main.                                                                                                  |
| `e84af45c` | LANDED         | Semantic main/rail spans and denser form-factor layouts ship on main.                                                                            |
| `aafb6098` | LANDED         | Current guidance carries the form-factor visual rules.                                                                                           |
| `ada47d71` | LANDED         | Main/rail layout coverage was absorbed into PR 53's larger suites.                                                                               |
| `e881a5b0` | LANDED         | PR 53's current showcase represents the refined desktop and phone layouts.                                                                       |
| `92197bf5` | LANDED         | Semantic list spans ship on main.                                                                                                                |
| `9957bf87` | LANDED         | Durable hierarchy/CRAP guidance ships on main.                                                                                                   |
| `2484cfe6` | LANDED         | Current tests cover list/main/rail geometry and behavior.                                                                                        |
| `f5ed1c80` | LANDED         | Harbor master-detail density remains in the current showcase.                                                                                    |
| `7c968c2b` | LANDED         | Reference-pattern and product-copy rules ship on main.                                                                                           |
| `deb621ae` | LANDED         | Desktop panes, selected rows, messages, and internal navigation ship on main.                                                                    |
| `ada8bab3` | LANDED         | Mobile timeline, whole-row opens, and bottom navigation ship on main.                                                                            |
| `51eefada` | LANDED         | Current queue rows have the explicit two-line truncating structure.                                                                              |
| `0efa5c10` | LANDED         | `SegmentedControl`, disabled form fields, resilient phone groupings, and their contracts are present and evolved in PR 53.                       |
| `0a32e504` | LANDED         | Current phone CSS/guidance has 16px body text, 44px controls, section roles, safe navigation, and grouped danger treatment.                      |
| `3301b855` | LANDED         | PR 53 preserves proportional device layouts, selected-row alignment, prose/figure sizing, and fixed device geometry with stronger quality tests. |

Recommendation: **safe to retire after the captain confirms the remote preservation is sufficient**. There is no substantive `NOT LANDED` commit.

## `fm/bp-wireframe-hierarchy`

Unique history: 23 single-parent commits.

| Commit     | Classification | Main-side evidence or missing value                                                                                                                                                                                                                                                                  |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1fce07b0` | LANDED         | This consolidated Wireframe commit and `1d9b1e8c` share parent `854997dc`; PR 53 ships a larger replacement tree containing the component, docs, examples, font, spacing fixes, and tests.                                                                                                           |
| `bf07f453` | OBSOLETE       | PR 53 replaces this hierarchy/device pass with the stricter CLEAR device model, richer primitives, compile diagnostics, and geometry fence.                                                                                                                                                          |
| `7d45c421` | LANDED         | The tablet wallet composition is represented by the current tablet-specific layout and wallet example in PR 53.                                                                                                                                                                                      |
| `20d8481b` | LANDED         | Current tablet wallet CSS/example retain deliberate grouping and proximity, later strengthened by CLEAR.                                                                                                                                                                                             |
| `bafba89b` | LANDED         | Native desktop/tablet/phone form factors, true-size frames, device rules, and fit behavior ship in PR 53.                                                                                                                                                                                            |
| `cada3240` | NOT LANDED     | Main retains true-size fit and improved type, but `Wireframe` has no maximize button, full-size screen rail, Wireframe zoom controls, or arrow-key cycling. This remains valuable for inspecting dense prototypes, but must be ported onto current shared figure controls rather than cherry-picked. |
| `83451136` | NOT LANDED     | Main has stable plan identity (`b14d38f3`) but no stable per-block address model or `block-identity.ts`. Recovering it would add structural comment targets and source-line-aware code targets.                                                                                                      |
| `1b0c1c13` | NOT LANDED     | The `big-plan review` command, loopback server, authenticated session transport, draft UI, feedback package, and security checks are absent. This is substantial product-aligned work, but it predates current CLI/render seams and needs a fresh integration.                                       |
| `19fbfba2` | NOT LANDED     | Durable review drafts/runtime tests and the hardened store/package refinements are absent. PR 45 persists only current viewer preferences/drafts; it does not replace this review workflow.                                                                                                          |
| `a1da15a4` | NOT LANDED     | PR 53 carries the improved task-flow examples, but main lacks Wireframe screen/element review targets and the associated block-address integration. Recover only the review-target portion against current Wireframe code.                                                                           |
| `3f02f1d8` | NOT LANDED     | The exact narrow tablet goal-line stacking rule and regression test are absent. It is a small candidate worth rechecking visually against today's wallet example before reimplementation.                                                                                                            |
| `9537e34e` | OBSOLETE       | The child-wallet task-flow content was reworked again and is represented by PR 53's current wallet and CLEAR proof examples.                                                                                                                                                                         |
| `458600d0` | NOT LANDED     | PR 53 supersedes the desktop/phone example polish, but focused Wireframe screen/element commenting, maximize behavior, and its runtime/evidence are absent. Recover the interaction design, not the stale example diff or committed preview screenshots.                                             |
| `eef7ca25` | NOT LANDED     | Main Wireframe has no maximized screen list, focus-on-open, or wraparound arrow-key cycling. This fix belongs with a future Wireframe maximize port.                                                                                                                                                 |
| `1303a359` | NOT LANDED     | The comment-near-selection action and focused review UI are absent. Its 224px desktop-nav choice was superseded by PR 53's bounded 64–180px rail guidance, so only the comment interaction should be harvested.                                                                                      |
| `7730db0d` | NOT LANDED     | PR 48 has a newer FlowDiagram-local feedback system, but main does not unify it with Wireframe or plan feedback. Recovering this means designing one current feedback handoff, not restoring the old shared script.                                                                                  |
| `8e4cc505` | NOT LANDED     | Wireframe comment-mode chrome, element selection, and cross-figure review styling are absent. PR 48 covers only the diagram side.                                                                                                                                                                    |
| `4dc55978` | NOT LANDED     | Minimized Wireframe comment chrome and its containment regression are absent because Wireframe has no such review mode on main.                                                                                                                                                                      |
| `11fd12f5` | NOT LANDED     | Wireframe-local feedback collection, review actions, and its refined diagram handoff are absent; main's diagram tray does not provide Wireframe feedback or plan transport.                                                                                                                          |
| `74b1d2f8` | NOT LANDED     | The Wireframe toolbar alignment and explicit “click to engage internal scrolling” behavior are absent. These remain useful interaction candidates for a dense embedded product canvas.                                                                                                               |
| `f1a8c075` | NOT LANDED     | Native page-wheel pass-through, explicit internal scroll ownership, and paint-stable maximize/restore scrolling are absent from Wireframe on main.                                                                                                                                                   |
| `f8b350c3` | NOT LANDED     | The non-deforming engagement shield/outline and pixel-stability regression are absent. Recover only with the engagement model they protect.                                                                                                                                                          |
| `a56876c2` | NOT LANDED     | The final selection boundary around the frame—not captions/toolbars—and its pixel evidence are absent. Recover only with the engagement model.                                                                                                                                                       |

Recommendation: **do not retire as “fully landed.”** Preserve it as a harvest source until the unlanded review work is either recovered or explicitly declined.

Recovery should not cherry-pick this branch. It predates PR 53's Wireframe contracts and current review/figure infrastructure. Recover it in three current-main tracks:

1. **Plan feedback transport:** start from `83451136`, `1b0c1c13`, and `19fbfba2`; redesign stable targets, local review serving, secure session transport, durable drafts, and the agent package against current CLI/render ownership.
2. **Wireframe review surface:** harvest `cada3240`, the review-target portion of `a1da15a4`, and `458600d0` through `a56876c2`; build Wireframe maximize/zoom, screen and element targets, local feedback, keyboard navigation, scroll ownership, and non-deforming selection on today's shared figure and feedback primitives. Treat PR 48 as the current diagram-side owner rather than reviving the old diagram script.
3. **Small visual follow-up:** re-render the current wallet example and decide whether `3f02f1d8`'s narrow goal-line stacking still fixes a real defect. If so, reimplement it with a focused current regression.

The preview PNGs and old generated modules are evidence, not recovery inputs. The durable value is the behavior and the tests that explain its edge cases.
