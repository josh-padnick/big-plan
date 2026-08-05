## Stack position

**2 of 5** in the reviewable replacement stack for #54. This PR targets `main` and depends on **#56**.

Merge the stack in numeric order. Once PR 1 lands, this draft's visible diff reduces to the agent-loop slice.

## Scope

This slice connects reviewer feedback to a real coding-agent loop:

- immutable request and response exchange records;
- CLI commands that print ready-to-paste Codex and Claude review sessions;
- anchored response history;
- revision snapshots, reverts, and before/after diffs;
- shell-safe command generation and focused protocol tests.

Deliberately out of scope: the complete commenting lifecycle and navigator, the Tailwind conversion, crash-safe mutable persistence, and component-specific revision lenses.

## Review plan

- [Rendered self-contained plan](https://raw.githubusercontent.com/josh-padnick/big-plan/refs/heads/fm/bp-pr54-split/.big-plan/pr54-split/02-agent-loop-and-diffs.html)
- [MDX plan source](https://github.com/josh-padnick/big-plan/blob/fm/bp-pr54-split/.big-plan/pr54-split/02-agent-loop-and-diffs.mdx)
- Local rendered path: `/Users/personal/.treehouse/big-plan-918a82/9/big-plan/.big-plan/pr54-split/02-agent-loop-and-diffs.html`

The plan walks through the two-terminal reviewer/agent exchange and what to inspect in each response and diff.

## Green evidence

- `bun run build`
- `bun run lint`
- `bun run test` — 971 unit tests passed
- `bun run test:e2e` — 52 browser tests passed

## Split bridges

The only slice-local bridge refreshes the generated embedded stylesheet after the historical commits are replayed. No agent-loop behavior is invented outside #54.
