# Using Decision well

Use `Decision` for one lightweight choice whose tradeoffs can be explained inline. Add at least two `Option` children. Each option may contain short `Consideration` children with a `label`, terse `verdict`, optional `tone`, and optional one-sentence body. When the body explains what a criterion means, its label shows the explanation on hover and keyboard focus.

```mdx
<Decision question="Which release path should we use?">
  <Option
    title="Gradual rollout"
    recommended
    summary="Start narrow, then expand."
  >
    <Consideration label="Risk" verdict="Low" tone="good">
      Exposure stays bounded while signals settle.
    </Consideration>
  </Option>
  <Option title="Immediate rollout">
    <Consideration label="Risk" verdict="Higher" tone="mixed">
      Every customer sees the change at once.
    </Consideration>
  </Option>
</Decision>
```
