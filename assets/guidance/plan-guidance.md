# How to write a plan a human loves to review

You are writing for one reader: a human deciding whether to let you build.
They read top to bottom, orienting first and verifying second.
Every principle below serves that reading order.

## 1. Name the outcome, then state the thesis

The title names what will exist after execution, not the document.
Write "Add an official, installable skill to Big Plan", never "Skill implementation plan" or "Plan for shipping the skill".
Follow the title immediately with a lede: one or two sentences stating the thesis of the plan itself.
The lede answers "what are you proposing and why does it matter", not "what this document contains".

## 2. Orient before you specify

Order sections so each one answers the question a reviewer has at that moment:

1. What is true today, and why is it not enough? (status quo)
2. What will the delivered result be like? (recommendation)
3. How will it work in detail? (design)
4. What exactly will you do, in what order? (implementation phases)
5. How will we both know it is done? (acceptance criteria)
6. What could go wrong, and what are you deliberately not doing? (risks, scope)

Low-level detail placed before orientation forces the reader to hold facts they cannot yet evaluate.
If a section would make the reader ask "why am I reading this now?", it is in the wrong place.

## 3. Open with the status quo

Start the body with the current state: what exists, what hurts, and why change is warranted now.
Justifications such as "why X rather than Y" belong here or inside a decision component.
Never give a justification its own free-floating essay section later in the document.

## 4. Make the recommendation the vision

The recommendation section paints the big picture of how the delivered result will work end to end.
Delivery logistics, such as whether the work ships as a separate PR, belong inside the recommendation as supporting decisions, never as its headline.
A reader finishing this section should be able to describe the future state in their own words.

## 5. Say "Acceptance criteria"

Name the verification contract "Acceptance criteria".
Avoid vaguer labels such as "Desired outcome" or "Definition of done".
Place it near the end, after the reader understands the approach, and make every criterion independently checkable.

## 6. Use components where they beat prose

Big Plan ships components that present specific kinds of information better than paragraphs can:

- `BigDecision` for a weighty tradeoff with options and a recommendation; `SmallDecisionSet` for quick calls.
- `CodeDiff` and `CodeSnippet` for concrete code the reviewer should see.
- `FileTree` and `FileTreeDiff` for layout and placement changes.
- `DatabaseTableSchema`, `HttpEndpoint`, `GraphqlOperation`, and `GrpcMethod` for structured contracts.
- `Callout` to make one decision, warning, or note impossible to miss.

A decision buried in prose is a decision the reviewer cannot easily accept or reject.

## 7. Earn every section

Cut sections that restate other sections, narrate the writing process, or exist to look thorough.
Prefer one precise sentence over three cautious ones.
Keep paragraphs short; a reviewer should never lose the argument inside a wall of text.

## 8. Validate, render, and reread

Run `big-plan validate <plan.mdx>` and fix every diagnostic until it passes.
Lint catches what is statically analyzable; it cannot judge writing.
Render the plan, then reread the rendered document exactly as the human will, top to bottom.
If any section reads awkwardly, or the opening does not orient you, revise before presenting it.
