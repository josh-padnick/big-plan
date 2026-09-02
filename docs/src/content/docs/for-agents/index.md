---
title: For Agents
description: Documentation written for coding agents that operate Big Plan; humans are welcome, but it is not written for them.
---

This section is written for coding agents, not people.
It carries operational steps, exact commands, and machine-readable endpoints, with none of the context or persuasion a human reader wants.

If you're a human, the same ground is covered for you in [What is Big Plan?](/intro/what-is-big-plan/) and [Installation](/intro/installation/).
Reading on anyway is a fine way to audit exactly what your agent is told.

## What's here

- [Use the skill](/for-agents/use-the-skill/): install the thin skill shell and keep guidance fresh via package upgrades.
- [Render a plan](/for-agents/render-a-plan/): the operational loop for rendering a plan and handing it to a human for review.
- [Authoring plans](/for-agents/authoring-plans/): what a plan document is, how the guidance gate works, and where each kind of rule lives.
- [setup.md](/setup.md): the one-time setup instructions an agent follows using the current Big Plan CLI without a global install.

## Read these docs as Markdown

Every page on this site is published twice: as HTML for humans, and as clean Markdown for agents.
Do not scrape the HTML pages; fetch the Markdown endpoints instead.

| Endpoint                           | What it returns                                                                                                | Fetch it when                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`/llms.txt`](/llms.txt)           | A curated map of every page, grouped by section, with one-line descriptions and links to each page's `.md` URL | You want to discover what documentation exists           |
| Any page path + `.md`              | That single page as raw Markdown                                                                               | You need specific pages and want to spend minimal tokens |
| [`/llms-full.txt`](/llms-full.txt) | The complete documentation concatenated into one Markdown document                                             | You want everything in one request                       |

Replace a page's trailing slash with `.md`:

```text
https://bigplan.dev/intro/installation/       ->  https://bigplan.dev/intro/installation.md
https://bigplan.dev/reference/cli/            ->  https://bigplan.dev/reference/cli.md
https://bigplan.dev/for-agents/render-a-plan/ ->  https://bigplan.dev/for-agents/render-a-plan.md
```

Each `.md` response starts with frontmatter carrying `title`, `description`, and `canonical` (the page's HTML URL), followed by a clean Markdown projection of the page that removes presentation-only MDX.
Fetch [`/llms.txt`](/llms.txt) once to see the map, fetch the `.md` URLs your task needs, and fall back to [`/llms-full.txt`](/llms-full.txt) only when you genuinely need the whole corpus.
