---
title: Big Plan vs. Other
description: How Big Plan compares to Lavish and Agent-Native Plans, and the two bets it makes differently.
---

Big Plan is not the first tool to notice that agent plans deserve better than a wall of text.
Two neighbors approach the same problem well, and comparing them is the clearest way to see the two bets Big Plan makes: discrete typed components, and a standalone local file you never sign in to view.
Both bets come straight from Big Plan's [philosophy](/intro/what-is-big-plan/#philosophy) of what a plan should be.

## Big Plan vs. Lavish

[Lavish](https://github.com/kunchenguid/lavish-axi) was a big inspiration for Big Plan.
It lets an agent turn its plan into a rich HTML artifact, and its feedback loop is excellent: you annotate elements or text, message the agent without leaving the editor, and everything runs locally.

The difference is what the agent is allowed to write.
Lavish embraces freeform HTML: the agent designs each artifact from playbooks, which gives it enormous flexibility.
The cost of that flexibility is consistency; each plan is its own custom page, so structure and quality vary from plan to plan, and reading ten plans means learning ten layouts.

Big Plan makes the opposite bet.
Plans are structured MDX with a fixed library of typed [components](/components/), so every plan renders into the same document shape.
The agent spends its effort on the decisions, not the presentation, and the tenth plan you review reads exactly like the first.

## Big Plan vs. Agent-Native Plans

[Agent-Native Plans](https://www.agent-native.com/apps/plan) shares Big Plan's conviction about structure.
It renders plans beautifully through discrete components, diagrams, annotated code, schema maps, and its comment system is polished.

The difference is packaging and custody.
Agent-Native Plans is part of a larger platform, and the default flow signs you in to view your plan.
Big Plan sees no reason a plan on your own disk should require an account: it is one standalone command (`npx big-plan render plan.mdx`), the output is one HTML file, and nothing about reviewing it involves logging in or leaving your machine.

Big Plan is pre-alpha, but its [local review workflow](/reference/reviewing/) now carries comments and agent responses without an account or third-party service.
What it offers is the combination the others do not: structured, consistent plan documents and a live feedback loop from a standalone tool that keeps everything on your disk.

## Next step

[Render your first plan in under a minute.](/intro/installation/)
