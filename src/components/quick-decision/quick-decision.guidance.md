# Using QuickDecision well

Use `QuickDecision` for one small, independently answerable question in a batch. It intentionally omits comparison criteria and the compare expander.

Add `critical` when the reviewer must settle this question before work begins. `big-plan guidance` owns when to mark one.

A `QuickDecision` is proposed until it is settled, so write no `state` for a question you are asking. Author `state="decided"` with `chosen` on exactly one `Option` only for a choice that was already settled before this review began; Big Plan writes those two attributes itself when the reviewer answers the question at approval. A settled decision renders as the record of what was chosen and stops asking.

```mdx
<QuickDecision
  question="Which package manager?"
  context="The repository needs one lockfile."
>
  <Option title="pnpm" recommended summary="Matches the workspace setup." />
  <Option title="npm" />
</QuickDecision>
```
