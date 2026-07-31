---
title: For Agents
description: Documentation written for coding agents that operate Big Plan; humans are welcome, but it is not written for them.
---

This section is written for coding agents, not people.
It carries operational steps, exact commands, and machine-readable endpoints, with none of the context or persuasion a human reader wants.

If you're a human, the same ground is covered for you in [What is Big Plan?](/intro/what-is-big-plan/) and [Installation](/intro/installation/).
Reading on anyway is a fine way to audit exactly what your agent is told.

## What's here

- [Render a plan](/for-agents/render-a-plan/): the operational loop for rendering a plan and handing it to a human for review.
- [Authoring plans](/for-agents/authoring-plans/): what a plan document is, how the guidance gate works, and where each kind of rule lives.
- [setup.md](/setup.md): the one-time setup instructions an agent follows after installing Big Plan.

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
https://big-plan.ai/intro/installation/       ->  https://big-plan.ai/intro/installation.md
https://big-plan.ai/reference/cli/            ->  https://big-plan.ai/reference/cli.md
https://big-plan.ai/for-agents/render-a-plan/ ->  https://big-plan.ai/for-agents/render-a-plan.md
```

Each `.md` response starts with frontmatter carrying `title`, `description`, and `canonical` (the page's HTML URL), followed by a clean Markdown projection of the page that removes presentation-only MDX.
Fetch [`/llms.txt`](/llms.txt) once to see the map, fetch the `.md` URLs your task needs, and fall back to [`/llms-full.txt`](/llms-full.txt) only when you genuinely need the whole corpus.
