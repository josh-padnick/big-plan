---
title: Comment on a plan
description: Attach a note to a slide, a component, or a piece of selected text, and send it to the agent.
---

**Goal.** One or more comments, anchored to the exact places in the plan they are about, sent
to the coding agent as a feedback package.

## Before you start

- A live review, started with [Start a review](/review/start-a-review/).
- Optionally a coding agent connected to it; comments can be written and staged before an
  agent arrives, and are delivered when one connects.

## Steps

1. Use a slide's comment icon, a component toolbar comment icon, or select text
   and choose **Comment**.
2. Write a Markdown comment and choose **Submit Now**. Turn off **Submit right
   away** to stage it with **Add Comment** instead. `Cmd/Ctrl+Enter` performs
   the visible primary action; `Escape` cancels.
   Hover or focus the primary action or **Cancel** to see the shortcut for that control, including while the primary action is disabled.
   Hover or focus the information mark beside **Submit right away** to compare immediate submission with staging comments for a later batch.
3. Open **Feedback** to inspect staged comments in the **Comments** tab.
   The **Chat** tab asks questions about the plan as a whole.
   The **Chat** tab also shows threads that the agent pushed into the review.
   **Inputs** lists what the review is still waiting for.
   **Agent Status** - its own control beside **Feedback** - shows the coding-agent connection and current work for a live review session.
   **More actions** follows those visible controls and contains **Export**, then **Settings**.
   The two controls share the sidebar and toggle independently: choosing one
   swaps the sidebar's body to it, and choosing it again closes the sidebar.
   A review-session outage is reported separately and does not label the agent
   as offline.
4. Edit or delete an individual staged comment, or choose **Send all comments
   to agent** to write one feedback package.

The **Chat** tab keeps pushed conversations that still need a verdict under **Needs you**, ranks them above changes already accepted by auto-accept under **Applied**, and files reviewer-resolved conversations under **Resolved**.
Every pushed card uses the bot icon and **Added by agent** heading.
A push that relays reviewer wording needs no extra origin marker, while an agent-authored opener carries the narrower **Agent-opened · About** context.
Open the card to reply, review and accept its changes, revert a response, or resolve the thread after its pending work finishes.
When the agent continues a pushed thread, Big Plan adds another exchange to the same card.
The card keeps the opener's presentation.
An unresolved pushed card offers **Auto-accept all changes**.
Its confirmation separates the immediate consequence - accepting the open changes in that thread - from the session-wide consequence that every later push arrives accepted, including pushes in other threads.
While armed, the Chat tab shows when auto-accept was turned on and offers **Switch back to review**.
Applied cards remain conversations: you can reply, receive a follow-up push, inspect each pushed revision's summary, or revert it.
Switching back changes only later arrivals: it leaves the card and its conversation available, while the next pushed change arrives open for review.
Starting a fresh review session always starts in review mode.

A push that lands while you are reading announces itself.
The **Chat** tab leads with a **Pushed just now** entry naming the agent's model and client, plus how many blocks changed when the push revised the plan.
**Open thread** takes you to the conversation, and **Dismiss** clears the entry; either way the entry names the newest arrival, and a newer push replaces it.
On a wide screen, where the sidebar sits beside the plan rather than over it, an arrival opens the sidebar on **Chat** for you, unless you are part-way through writing a comment or reply or a pointer press is in flight: reserving the sidebar's gutter would move or recreate the control you are using, so the arrival waits until that interaction finishes.
On a narrower screen it waits as well, because the sidebar would cover the sentence you are reading.
Instead, the closed **Feedback** control carries the arrival count; once the sidebar is open on another tab, **Chat** carries a mark until you view the entry.
Your reading position is kept either way.

The blocks the revision changed settle briefly in place, so you can see what moved without hunting for it.
Readers who ask their system for reduced motion get the entry without the highlight.

A comment reaches the agent with the scope it was left at.
Selecting text inside a paragraph, list, or table cell anchors the note to that block alone.
A slide's comment icon, or a selection of the slide's own title, addresses the whole slide, so an instruction such as "rewrite this in Spanish" carries the slide's content rather than its heading.
When that slide is split into sub-slides, the agent is given the slide's own content above the first sub-slide plus the names of the sub-slides it continues into, and reads their content from the plan source.

A plan may also point at picture files of its own, such as
`![The cabinet](./assets/cabinet.jpg)`.
`big-plan review` serves any PNG, JPEG, WebP, GIF, AVIF, or SVG file up to 10 MiB that sits inside the plan's own directory, at any depth, so a photograph an author or an agent saves beside the plan appears in the review document.
Nothing else in that directory is served: another file type, a dot-prefixed
directory such as `.big-plan/`, and any path that leaves the plan's directory
are all refused.

Comments, replies, and plan-wide chat accept PNG, JPEG, and WebP screenshots.
Paste an image into a composer or drag and drop a file onto it.
The runtime stores each image by its SHA-256 digest and inserts a Markdown
reference into the message.
Images are limited to four per message, 10 MiB per image, and 20 MiB total.
Each stored image belongs to the plan rather than to one review session, so a
picture pasted today still appears after the review runtime is restarted.
A stored picture that cannot load is shown as an **Image unavailable** placeholder that explains itself on demand.
The local `big-plan review` runtime is required to capture or retrieve images;
standalone rendered files keep text drafts but do not accept image bytes.

The kernel is a typed React interaction island built from token-themed
shadcn/ui primitives. The plan content stays server-rendered HTML: React adds
controls beside that content, and a live revision swaps in the next
server-rendered article without client-rendering or gating the plan.

## Verify

- A staged comment appears in the **Comments** tab of **Feedback**, and a sent one is grouped
  under a package heading there.
- A sent comment's thread reads **Waiting for an agent** until an agent picks it up, and
  **Working** once one has.

## If it goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| **Blocked - no agent connected** | Nothing is attached to answer you | The message sends itself when an agent reconnects; open **Agent Status** for the prompt that starts one |
| The composer refuses to send | The runtime has stopped accepting changes, lost contact, or been replaced | Your text is kept; see [When a review goes wrong](/review/troubleshooting/) |
| **Original target unavailable** | The block the comment was anchored to no longer exists at that structural path | The thread keeps its recorded address; Big Plan never re-attaches it to nearby prose by guesswork |
| An image will not attach | The file is not PNG, JPEG, or WebP, or the message is past four images, 10 MiB each, or 20 MiB total | Reduce or convert it; a standalone rendered document accepts no image bytes at all |

## Next

[Answer the plan's decisions](/review/answer-decisions/) — record a choice on a decision card
and see what the review is still waiting for.
