---
title: How it works
description: The whole Big Plan loop in one page, from your agent writing a plan to you approving it.
---

## TL;DR

1. You ask your agent for a plan. A few minutes later it hands you a link.
2. You engage with a visual document designed for human readability.
3. You request changes or ask for feedback on specific parts. The agent updates the plan in
   place. You keep iterating as needed.
4. When you are happy, you approve it.

To understand how that works in depth, let's keep reading!

---

## The loop

### 1. Your agent reads the house rules

Before writing anything, the agent runs:

```sh
npx -y big-plan@latest guidance
```

That prints Big Plan's plan-writing principles — how to title a plan, how to structure it as a
deck, when a component beats a paragraph, how terse to be. It is **gated**: until an agent has
read it, the commands that produce a document for you refuse to run. So the plan you get was
written by an agent that had just been told how to write one.

### 2. It writes the plan as MDX

The plan is one file on your disk, `plan.mdx`. It is ordinary Markdown plus a closed set of
[components](/components/) — a `Decision` for a tradeoff, a `CodeDiff` for a change, a
`Wireframe` for a screen.

**Nothing in a plan executes.** Imports, expressions, and inline JSX are rejected as errors
rather than evaluated, so a plan can never introduce code into its own document. The file stays
greppable, diffable, and yours.

### 3. It checks its own work

```sh
npx -y big-plan@latest validate plan.mdx
```

This compiles the plan, renders the whole document in memory, and applies every authoring rule —
without writing anything. The agent fixes what it reports and runs it again. A plan that fails
these checks never reaches you.

### 4. It serves the plan and hands you a link

```sh
npx -y big-plan@latest review plan.mdx
```

You get an address on your own machine that stays the same for that plan, so you can save it and
come back to it. Open it and you are reading the plan as a document: a table of contents, one
slide per section, code you can actually read, decisions presented as cards.

Nothing left your machine to get here.

### 5. You mark it up

Select a sentence and comment on it. Use a slide's comment icon to talk about a whole section.
Ask a question about the plan as a whole in **Chat**. Answer the questions the plan asks you —
its decision cards are answerable in place, and an **Inputs** list tells you what is still
outstanding.

Your notes are anchored to the exact blocks they are about, so the agent knows what you meant.

### 6. The agent answers

Run the connect command in a second terminal and your coding agent joins the review. It picks up
your feedback, revises **its own copy** of the plan, checks the new version, and publishes one
answer per comment.

Big Plan then shows you **what changed** — a walk through each changed place, side by side with
what was there before, each one shown where it happened. A bar at the foot of the page tours the
set: accept the changes you are happy with, reject the ones you are not, and undo either verdict.
When a change is not what you wanted, **Chat** opens a conversation about that one change without
taking it off your screen, and the agent's answer arrives there. The bar's menu also lets you
accept or reject every change in the set, or delete the thread that proposed it.

Your plan file is never edited by the agent directly. Big Plan swaps its copy in only when a
valid answer publishes, so an agent that stalls or dies mid-edit leaves your plan exactly as it
was.

### 7. You approve

**Approve plan** in the top bar. The dialog shows you what is accepted, what is still open, which
decisions you answered and which you did not, and the covering note that goes with it.

Confirming does three things: it writes your decision answers into the plan file itself, it
records exactly which version you approved, and it tells the agent to begin.

The agent then re-reads that file, checks it is byte-for-byte the version you approved, and
starts work.

## What you get out of it

- **A document, not a transcript.** Sections, navigation, readable code, and purpose-built
  presentation for decisions, diffs, schemas, and screens.
- **Feedback that lands somewhere.** A comment is attached to a block, not to a line number that
  moves.
- **A record.** Your answers end up in the plan file, and the approval names the exact version it
  covers.
- **Nothing leaves your machine.** No account, no service, no external requests from the
  rendered document.

## Where to go next

| You want to                       | Read                                                 |
| --------------------------------- | ---------------------------------------------------- |
| Walk the loop from your side      | [Your first review](/intro/first-review/)            |
| See what the interface looks like | [UI review](/intro/ui-review/)                       |
| Look at real plans                | [Sample plans](/samples/)                            |
| Know what a plan can contain      | [Components](/components/)                           |
| Write plans yourself              | [Write a plan](/for-agents/#what-a-plan-may-contain) |
| Operate Big Plan as an agent      | [For agents](/for-agents/)                           |
| Look up a command                 | [Reference](/reference/commands/render/)             |

## Next

[Components](/components/) — the twenty ways a plan can present something better than prose.
