---
title: Answer the plan's decisions
description: Record a choice on a decision card and see what the review is still waiting for.
---

**Goal.** Every question the plan asks either answered or deliberately left open, with the
review's **Inputs** list agreeing.

## Before you start

- A live review with write custody. A read-only session — one whose plan a newer review took
  custody of — shows the cards but cannot record answers.
- A plan containing at least one `Decision`, `QuickDecision`, or `DecisionAnalysis` with
  `interaction="choose"`.

## How answering works

An open decision card - a `Decision`, a `QuickDecision`, or a `DecisionAnalysis` with `interaction="choose"` - can be answered during a live review.
A confirmed choice is saved with the review: it survives reload and runtime restarts, so the answer is still there when you come back to the page, and it stays saved until you change or clear it.
The answer stays inside the review session until approval writes it into the plan source and sends it to the agent; tell the agent through the feedback flow when you want it acted on before then.
The card's caption always states what is true right now: saving, saved with this review, or noted for this reading session only.
If a save fails, the card says the answer is not saved yet and retries automatically; keep the page open until it reports the answer saved.

The review runtime alone decides which answers are current.
It compiles the plan, accepts only decision and option ids the current plan asks, and records with each answer a digest of that decision's full compiled content.
An answer is served only while its decision still asks exactly that content, so editing the decision's own question, options, summaries, considerations, or context masks its answer, while an edit elsewhere in the plan leaves it alone.
A card whose stored answer stopped applying says so on the card itself and asks to be answered again.
Nothing is deleted: restoring the decision's exact content revives the original answer.
Choosing **Change** is not a reversible peek: it retracts the saved answer straight away, and the decision counts as unanswered until you confirm again.
So choose **Change** and confirm a different option to replace an answer, or **Change** and then **Clear answer** to leave the decision deliberately unanswered.

**Suggest another option** opens a composer that asks what your own words are for.
By default they are the decision: **Confirm choice** records them as the answer for this reading session, and they then stand as a **New option** until **Change** reopens the field with the text kept.
Unlike a chosen option, your own words are not saved with the review and do not come back after a reload.
Flip it to **Submit as comment** when the agent should act on the words instead: that side uses the review's own comment controls, so **Submit right away** decides whether the comment is sent immediately or staged with the rest of your feedback, and it reaches the agent as **Decision options feedback** with its thread beside the composer.
**Cancel** leaves the composer from either side, and the comment side needs a live review; a standalone document says so instead of submitting.

A read-only review page - one whose plan a newer review session took custody of - cannot record answers: every answering control is disabled, with a note beside it saying why.
A confirm made before the page has learned whether it may write is held rather than guessed at: it is saved once the session proves writable, and kept as a reading-session note when the session proves read-only.
Words recorded as the decision are a reading-session note either way, never a saved answer; submit them as a comment when the agent should act on them.
In a standalone rendered document, an answer lasts only for the reading session and is not saved with a review.

## What the review is waiting for

A live review's **Inputs** tab lists what the review is waiting on: for now, every decision the plan asks.
Each row says where that input stands - answered, not answered, or stale - and a decision the plan's author marked `critical` says so beside its state.
Selecting a row scrolls the plan to that decision's card.

The list is the runtime's answer rather than the page's, so two browsers reading the same review read the same list, and a reload cannot invent a different one.
**Stale** is its own state rather than a kind of unanswered: you answered, and the plan moved underneath the answer.
A decision goes stale under exactly the edits that mask its answer on the card, and restoring the wording it answered makes it answered again.

A standalone rendered document has no Inputs tab: the contract is derived by the review runtime, and a document opened without one has nothing to derive it from.

## Verify

- The card's caption reads that the answer is saved with this review.
- The row for that decision in **Inputs** reads answered.

## If it goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| The card says the answer is not saved yet | A save failed and is being retried | Keep the page open until the card reports the answer saved |
| The card asks to be answered again | The decision's own content changed, so the stored answer stopped applying | Answer it again, or restore the decision's exact wording to revive the original answer |
| A row reads **Stale** | You answered and the plan moved underneath the answer | Same as above; stale is its own state, not a kind of unanswered |
| Every answering control is disabled | This page is a read-only review session | Open the newest review for that plan |

## Next

[Read the agent's changes](/review/read-changes/) — walk the change set an answer produced.
