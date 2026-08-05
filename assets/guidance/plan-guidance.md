# How to write a plan a human loves to review

You are writing for one reader: a human deciding whether to let you build.
They read top to bottom, orienting first and verifying second, and every sentence costs them time.
Get to the point, and stay there.

## 1. Name the outcome, then state the thesis

The title names what will exist after execution, in a punchy noun phrase: "Ship the official Big Plan skill", never "Skill implementation plan".
Follow it immediately with a lede: one concise sentence that Big Plan renders as the document's subtitle.
Prefer an imperative mission statement: "Create a version-controlled skill file and make it easily installable."
State the mission, never the act of proposing it, and never lean on a concept the reader has not met yet.
Lint holds both the title and the lede to their length and style budgets.

## 2. Open with a quick summary

Put a `QuickSummary` directly after the lede, before any section: the plan's key points, stated as concisely as possible.
Its `Why`, `What`, and `How` sections tell a stopping reader the business value, the change, and the actions you will take.
Run `big-plan guidance QuickSummary` before writing it: every component carries its own guidance, and the card's enforced shape and the altitude each facet speaks at are stated there rather than here.
Everything after the quick summary is elaboration; nothing essential may appear for the first time in a later section.

## 3. Place every statement at a deliberate abstraction level

A plan spans one abstraction chain, from product goal down to mechanism; climb it by asking "why does this matter?" and descend by asking "how?".
Each part of the plan owns a rung: the title and lede state the mission, `Why` the product goal, `What` the capability, `How` the actions, and sections the design and mechanisms; the verification contract states how success will be checked.
Place each fact on its rung on purpose: a sentence naming files, commands, or flags is mechanism-level and belongs in a design section, never in the lede or summary.
A principle is not a how: "keep the skill version-locked" states a virtue; "embed the skill text in the CLI" states an action.
The frame most worth the reviewer's attention is usually in the middle of the chain - a lifecycle, ownership, or policy question - not the loftiest goal and not the lowest mechanism.

## 4. Structure the plan as a deck of slides

A rendered plan reads as a deck: every section is one slide carrying one thought, stated mostly in bullets, at roughly one screen of content.
If a section needs a second screen, it holds a second thought; split it into h3 sub-slides, each of which renders as its own numbered frame.
Group the slides with `Part` markers into about three acts - Context, The proposal, and Shipping & your review - adapting the names when this plan demands it.
Part 1 canonically holds "Status quo" and then "Success looks like": what is true today, and the outcome-level success a sponsor would repeat.
Place the verification contract near the end and make every criterion independently checkable; "Acceptance criteria" and "Definition of done" both name it well.
"Desired outcome" is not that contract - it names the outcome-level result a sponsor would repeat, which is a higher rung and belongs earlier if the plan needs it.
Put a `TableOfContents` directly after the `QuickSummary`: one row per section, so the reviewer sees the whole argument before reading any of it.
Within an act, order slides by the reader's questions, keep orientation ahead of detail, and cut any slide that would make the reader ask "why am I reading this now?".
Fold "why X rather than Y" justifications into the surrounding story or a decision component, never into free-floating essay sections.

## 5. Lead with the title, and say it once

Every slide and sub-slide names its message before it shows anything; the reader has to know what they are looking at before they look at it.
An h2 is already the slide's headline, but an h3 renders only as a small kicker, so a sub-slide that leads with a figure needs an h4 title of its own.
Write that title as the message rather than the topic: "Escape unwinds one level at a time" beats "Dismissal".

A fully emphasized paragraph (`*like this*`) renders as the context builder - one muted orienting line - but only as the first block under the heading, so a title and a context builder are alternatives, never a sequence.
Keep it only when it adds what the heading does not already carry, and when the slide carries a reader action - a decision, a question, something to verify - let it declare that action ("We need to decide where the skill ships.").
Never let a subtitle or a figure's own label restate the heading above it.
Lint blocks both a figure that leads its slide and a subtitle or label that restates the heading.

## 6. Open a novel idea with the problem it solves

When a slide introduces a concept the reader has no model for - a coined noun, a new identity scheme, a new boundary - its first sentence says what breaks without it, before any mechanism.
Find that sentence by stepping one abstraction level up and asking what the plan cannot do until the concept exists.
Label the paragraph so the shape is visible at a glance:

**The problem.** A comment must survive the agent regenerating the document, so an address made of screen positions is worthless.

Definitions, schemas, and mechanisms follow that sentence; they never precede it.
No check can tell a novel concept from a familiar one, so this one is on your judgment.

## 7. Make a dense slide scannable

**Label the paragraphs.** Once a slide's prose runs past two paragraphs, open each with a bold run-in label naming its job - **The problem.**, **The model.**, **Where the two differ.** - so a reviewer can find the paragraph they need without reading the ones they do not.

**Mark declarations.** When a plan declares many instances of one recurring kind of statement, mark each with a standardized bracket rather than inventing a fresh label every time: `**[REQUIREMENT]**`, `**[CONSTRAINT]**`, `**[PRINCIPLE]**`, `**[DECISION]**`, `**[NON-GOAL]**`.
Reserve markers for statements a reviewer can accept, reject, or hold you to; ordinary explanation stays prose.

**Group long collections.** Past about seven items, a flat list or table hides structure you already know.
Pick the dimension that helps the reviewer judge - importance, lifecycle stage, owner, audience, family - and group by it, introduced by a short bulleted legend saying what each group means:

- **Essential** - break one of these and the feature fails.
- **Experience** - break one and the feature still works, but it frustrates.

In a table, make that dimension the first column so rows sharing a group sit together.
Lint blocks a flat list or table past eight items.

## 8. Visual layout: Proximity, Alignment, Repetition, Contrast (CRAP)

Robin Williams's four basic principles (The Non-Designer's Design Book) govern how the rendered deck is read.
Apply them when authoring and when judging spacing after you render.

**Proximity.**
Related items sit close; unrelated items sit farther apart so groups form without boxes of explanation.
Title and lede form one unit; slide title and context builder (the fully emphasized first line) sit tight as one unit; sub-slides pack under their parent; leave more space before the next peer slide (for example after 2.1.6 before 2.2); keep related bullets together.

**Alignment.**
Every element has a clear visual connection to something else.
Favor a strong left edge in the reading column; kickers, titles, and body share one vertical rhythm; avoid arbitrary mid-column placement.

**Repetition.**
Repeat visual conventions so the deck feels one product: numbered kickers, Part bands, slide frames, sub-slide chrome, type scale, and muted context builders.
Consistency is unity.

**Contrast.**
Make different things clearly different so hierarchy is obvious at a glance.
Parts stand apart from slides; slides stand apart from sub-slides; titles stand apart from body; accent kickers stand apart from muted supporting lines.
Weak contrast is why a plan feels flat or confusing.

These principles apply to both the authored MDX structure and the product chrome Big Plan applies when it renders the deck.

## 9. Be terse

Write as tersely as the content allows.
Prefer one precise sentence over three cautious ones, and cut anything that restates another section, narrates your process, or exists to look thorough.
Keep paragraphs short; a reviewer should never lose the argument inside a wall of text.
When revising prose, keep related sentences in one paragraph; never leave a blank line between every sentence.

## 10. Use components where they beat prose

Big Plan ships components that present specific kinds of information better than paragraphs can:

- `QuickSummary` for the key points a reviewer reads first.
- `TableOfContents` for the plan in one look: one linked row per section, directly after the quick summary.
- `Part` to divide the slides into numbered acts.
- `Decision` for a tradeoff read option by option; `DecisionAnalysis` for a full criteria matrix; `QuickDecision` for quick calls.
- `FlowDiagram` for genuinely relational content - a flow, dependency, or fan-out - drawn as staged cards with directed connectors.
- `CodeDiff` and `CodeSnippet` for concrete code the reviewer should see.
- `FileTree` and `FileTreeDiff` for layout and placement changes.
- `DataTable` for a reference dataset the reviewer needs to sort, filter, or reshape.
- `DatabaseTableSchema`, `HttpEndpoint`, `GraphqlOperation`, and `GrpcMethod` for structured contracts.
- `Callout` to make one decision, warning, or note impossible to miss.

Draw every illustration with a component, never with ASCII art: a box-drawing sketch in a code fence breaks on a narrow screen, says nothing to a screen reader, and gives the reviewer nothing to point at.
Where no component fits the picture, embed a real image and caption what to notice in it.
A decision buried in prose is a decision the reviewer cannot easily accept or reject.
Before using a component, run `big-plan guidance <Component>` (for example `big-plan guidance DecisionAnalysis`) for how to use it well.
Every component's attributes and accepted shapes are at https://big-plan.ai/components/; look them up rather than guessing.

## 11. Validate, render, and reread

Run `big-plan validate <plan.mdx>` and fix every diagnostic until it passes; each one names its rule and its fix, which is why they are not repeated here.
What the parser rejects is at https://big-plan.ai/for-agents/authoring-plans/, and every lint rule's exact boundaries are at https://big-plan.ai/reference/lint-rules/.

Passing lint means the plan is renderable and statically clean; it says nothing about whether the plan reads well, and that is the only bar that matters.
Render the plan, then reread the rendered document exactly as the human will, top to bottom.
Judge what no check can: whether the opening orients you, whether any section reads awkwardly, whether a wide table or a long figure is genuinely pleasant to read.
Judge spacing with the CRAP principles above before you present.
Revise before presenting it.
