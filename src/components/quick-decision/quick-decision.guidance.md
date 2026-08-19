# Using QuickDecision well

Use `QuickDecision` for one small, independently answerable question in a batch. It intentionally omits comparison criteria and the compare expander.

Add `critical` when the reviewer must settle this question before work begins. `big-plan guidance` owns when to mark one.

```mdx
<QuickDecision
  question="Which package manager?"
  context="The repository needs one lockfile."
>
  <Option title="pnpm" recommended summary="Matches the workspace setup." />
  <Option title="npm" />
</QuickDecision>
```
