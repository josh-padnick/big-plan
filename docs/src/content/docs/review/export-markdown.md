---
title: Export a plan as Markdown
description: Download the latest committed plan as portable Markdown, with the current review overlay.
---

**Goal.** A `<plan-name>.md` file on your disk holding the plan as portable text, including
your saved decision answers and — where it applies — the approval.

## Before you start

- A live review whose runtime you can still reach. A session that has become read-only can
  still export.
- A standalone rendered document cannot: it keeps the Settings gear and offers no export,
  because it has no authoritative source to refresh from.

## Steps

Open **More actions**, choose **Export**, and confirm to download the latest committed plan as `<plan-name>.md`. The review runtime reads the authoritative plan source when you confirm, so a browser showing an older revision does not make the export stale. Candidate agent edits that have not been published are not part of that source.

The file preserves ordinary Markdown and turns every built-in component into a semantic Markdown presentation. Wireframes become vocabulary-neutral, per-screen reconstruction notes rather than screenshots: they describe the device frame, layout geometry, visual hierarchy, spatial groupings, appearance, states, labels, values, and navigation targets in plain UI language. A separated review overlay includes current saved decision answers and an approval summary only when the approval matches the exported plan version. Comments, comment drafts, feedback dispositions, staged agent candidates, and agent status are not included.

Export is available from live reviews, including a session that has become read-only, while its runtime remains reachable. A standalone document keeps the Settings gear and does not offer export because it has no authoritative source to refresh from.

## Verify

- The downloaded file opens as ordinary Markdown, with each built-in component rendered as
  semantic text rather than as a screenshot.
- The review overlay at the end carries your current saved decision answers, and an approval
  summary only when that approval matches the version you exported.

## If it goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| **Export** is not in **More actions** | You are reading a standalone rendered document | Open the live review for that plan |
| The export is missing recent agent edits | Those edits are still a private candidate and have not been published | They appear once the agent publishes its answer |
| The export carries no approval summary | The approval in force does not pin the exported version | Re-approve the current plan, then export again |

## Next

[Change how the viewer looks](/review/viewer-settings/) — appearance, colour theme, and the
note that rides with an approval.
