# How to write a plan a human loves to review

You are writing for one reader: a human deciding whether to let you build.
They read top to bottom, orienting first and verifying second, and every sentence costs them time.
Get to the point, and stay there.

## 1. Name the outcome, then state the thesis

The title names what will exist after execution, in a punchy noun phrase of at most eight words.
Write "Ship the official Big Plan skill", never "Skill implementation plan" or a title so long it reads as a sentence.
Follow the title immediately with a lede: exactly one concise sentence that describes the plan, reading as the document's subtitle.
Big Plan renders that first paragraph as the subtitle, so keep it as short as it can be while still carrying the thesis.
State the thesis declaratively, in plain language.
Never open the lede with "I propose", "This plan", or any other words about the document or its author; describe the delivered future, not the act of proposing it.
Never use a concept the reader has not met yet; a coined phrase like a hyphen-chained workflow name belongs after the section that introduces it, if anywhere.

## 2. Open with a quick summary

Put a `QuickSummary` component directly after the lede, before any section: the plan's key points, stated as concisely as possible.
Its `What`, `How`, and `OpenQuestions` sections tell a stopping reader what will change, how it will work, and what they must answer, with risks folded into the questions that resolve them.
It enforces its own shape - short bullet lists within hard caps - and `big-plan guidance QuickSummary` explains how to use it well.
Everything after the quick summary is elaboration; nothing essential may appear for the first time in a later section.

## 3. Choose the structure this plan needs

There is no canonical section list; use the sections this plan needs, and only those.
Order them by the reader's questions: what is true today, what the delivered result will be like, how it works in detail, and how you will both know it is done.
Keep orientation ahead of detail; if a section would make the reader ask "why am I reading this now?", it is in the wrong place.
Fold "why X rather than Y" justifications into the surrounding story or a decision component, never into free-floating essay sections.
Present delivery logistics, such as PR sequencing, as supporting decisions rather than headlines.

## 4. Be terse

Write as tersely as the content allows.
Prefer one precise sentence over three cautious ones, and cut anything that restates another section, narrates your process, or exists to look thorough.
Keep paragraphs short; a reviewer should never lose the argument inside a wall of text.

## 5. Say "Acceptance criteria"

Name the verification contract "Acceptance criteria".
Avoid vaguer labels such as "Desired outcome" or "Definition of done".
Place it near the end, after the reader understands the approach, and make every criterion independently checkable.

## 6. Use components where they beat prose

Big Plan ships components that present specific kinds of information better than paragraphs can:

- `QuickSummary` for the key points a reviewer reads first.
- `Decision` for a tradeoff read option by option; `ComplexDecision` for a full criteria matrix; `SimpleDecisionSet` for quick calls.
- `CodeDiff` and `CodeSnippet` for concrete code the reviewer should see.
- `FileTree` and `FileTreeDiff` for layout and placement changes.
- `DatabaseTableSchema`, `HttpEndpoint`, `GraphqlOperation`, and `GrpcMethod` for structured contracts.
- `Callout` to make one decision, warning, or note impossible to miss.

A decision buried in prose is a decision the reviewer cannot easily accept or reject.
Before using a component, run `big-plan guidance <Component>` (for example `big-plan guidance ComplexDecision`) for how to use it well.

## 7. Validate, render, and reread

Run `big-plan validate <plan.mdx>` and fix every diagnostic until it passes.
Lint catches what is statically analyzable; it cannot judge writing.
Render the plan, then reread the rendered document exactly as the human will, top to bottom.
If any section reads awkwardly, or the opening does not orient you, revise before presenting it.
