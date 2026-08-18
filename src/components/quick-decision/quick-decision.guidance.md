# Using QuickDecision well

Use `QuickDecision` for one small, independently answerable question in a batch. It intentionally omits comparison criteria and the compare expander.

Add `critical` when the plan should not be approved until the reviewer answers this question. Mark only the questions whose answer would change what gets built; a plan where everything is critical says nothing.

```mdx
<QuickDecision
  question="Which package manager?"
  context="The repository needs one lockfile."
>
  <Option title="pnpm" recommended summary="Matches the workspace setup." />
  <Option title="npm" />
</QuickDecision>
```
