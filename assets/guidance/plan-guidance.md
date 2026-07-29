# How to write a plan a human loves to review

You are writing for one reader: a human deciding whether to let you build.
They read top to bottom, orienting first and verifying second, and every sentence costs them time.
Get to the point, and stay there.

## 1. Name the outcome, then state the thesis

The title names what will exist after execution, in a punchy noun phrase of at most eight words.
Write "Ship the official Big Plan skill", never "Skill implementation plan" or a title so long it reads as a sentence.
Follow the title immediately with a lede: exactly one concise sentence, reading as the document's subtitle.
Prefer an imperative mission statement: "Create a version-controlled skill file and make it easily installable."
Big Plan renders that first paragraph as the subtitle, so keep it as short as it can be while still carrying the thesis.
Use plain language.
Never open the lede with "I propose", "This plan", or any other words about the document or its author; state the mission, not the act of proposing it.
Never use a concept the reader has not met yet; a coined phrase like a hyphen-chained workflow name belongs after the section that introduces it, if anywhere.

## 2. Open with a quick summary

Put a `QuickSummary` component directly after the lede, before any section: the plan's key points, stated as concisely as possible.
Its `Why`, `What`, and `How` sections tell a stopping reader the business value, the change, and the actions you will take.
It enforces its own shape - short bullet lists within hard caps - and `big-plan guidance QuickSummary` explains how to use it well.
Everything after the quick summary is elaboration; nothing essential may appear for the first time in a later section.

## 3. Place every statement at a deliberate abstraction level

A plan spans one abstraction chain, from product goal down to mechanism; climb it by asking "why does this matter?" and descend by asking "how?".
Each part of the plan owns a rung: the title and lede state the mission, `Why` the product goal, `What` the capability, `How` the actions, sections the design and mechanisms, and acceptance criteria the verification.
Place each fact on its rung on purpose: a sentence naming files, commands, or flags is mechanism-level and belongs in a design section, never in the lede or summary.
A principle is not a how: "keep the skill version-locked" states a virtue; "embed the skill text in the CLI" states an action.
The frame most worth the reviewer's attention is usually in the middle of the chain - a lifecycle, ownership, or policy question - not the loftiest goal and not the lowest mechanism.

## 4. Structure the plan as a deck of slides

A rendered plan reads as a deck: every section is one slide carrying one thought, stated mostly in bullets, at roughly one screen of content.
If a section needs a second screen, it holds a second thought; split it.
When one section genuinely owns several thoughts - an implementation with its pipeline and its change list - split it into h3 sub-slides instead: each h3 run renders as its own numbered frame under the section's header.
Group the slides with `Part` markers into about three acts - Context, The proposal, and Shipping & your review - adapting the names when this plan demands it.
Part 1 canonically holds "Status quo" and then "Success looks like": what is true today, and the outcome-level success a sponsor would repeat.
"Success looks like" states outcomes, not verification; the checkable contract stays in "Acceptance criteria" near the end.
Put a `Glance` directly after the `QuickSummary`: one row per section, so the reviewer sees the whole argument before reading any of it.
Open a dense slide with a context builder: one fully emphasized paragraph (`*like this*`) that renders as a muted line telling the reader what they are looking at.
When the slide carries a reader action - a decision, a question, something to verify - the context builder declares the action ("We need to decide where the skill ships."), not a description of the slide; purely orienting slides may stay descriptive.
Within an act, order slides by the reader's questions, keep orientation ahead of detail, and cut any slide that would make the reader ask "why am I reading this now?".
Fold "why X rather than Y" justifications into the surrounding story or a decision component, never into free-floating essay sections.
Present delivery logistics, such as PR sequencing, as supporting decisions rather than headlines.

## 5. Be terse

Write as tersely as the content allows.
Prefer one precise sentence over three cautious ones, and cut anything that restates another section, narrates your process, or exists to look thorough.
Keep paragraphs short; a reviewer should never lose the argument inside a wall of text.

## 6. Say "Acceptance criteria"

Name the verification contract "Acceptance criteria".
Avoid vaguer labels such as "Desired outcome" or "Definition of done".
Place it near the end, after the reader understands the approach, and make every criterion independently checkable.

## 7. Use components where they beat prose

Big Plan ships components that present specific kinds of information better than paragraphs can:

- `QuickSummary` for the key points a reviewer reads first.
- `Glance` for the plan in one look: one linked row per section, directly after the quick summary.
- `Part` to divide the slides into numbered acts.
- `Decision` for a tradeoff read option by option; `ComplexDecision` for a full criteria matrix; `SimpleDecisionSet` for quick calls.
- `FlowDiagram` for genuinely relational content - a flow, dependency, or fan-out - drawn as staged cards with directed connectors.
- `CodeDiff` and `CodeSnippet` for concrete code the reviewer should see.
- `FileTree` and `FileTreeDiff` for layout and placement changes.
- `DatabaseTableSchema`, `HttpEndpoint`, `GraphqlOperation`, and `GrpcMethod` for structured contracts.
- `Callout` to make one decision, warning, or note impossible to miss.

A decision buried in prose is a decision the reviewer cannot easily accept or reject.
Before using a component, run `big-plan guidance <Component>` (for example `big-plan guidance ComplexDecision`) for how to use it well.

## 8. Validate, render, and reread

Run `big-plan validate <plan.mdx>` and fix every diagnostic until it passes.
Lint catches what is statically analyzable; it cannot judge writing.
Render the plan, then reread the rendered document exactly as the human will, top to bottom.
If any section reads awkwardly, or the opening does not orient you, revise before presenting it.
