# Using DecisionAnalysis well

Use `DecisionAnalysis` when the reviewer must audit a recommendation across explicit criteria. Set `state` to `proposed`, `decided`, or `deferred`, and set `interaction` to `audit` or `choose`; choosing is available only for a proposed analysis. Qualitative scoring is the default. Add `scoring="weighted"` when each criterion needs an `impact` from 1–5 and each `Score` needs a numeric `score` from 1–5.

Every `Criterion` and `Score` needs a one-sentence body. The dashed title or value reveals that definition. Include exactly one `Reversibility`; `Details` is optional.

Add `critical` when the reviewer must settle this question before work begins. It is accepted only with `state="proposed"` and `interaction="choose"`, because a settled or audited analysis asks the reviewer for nothing. `big-plan guidance` owns when to mark one.

```mdx
<DecisionAnalysis
  question="Which store should we use?"
  state="proposed"
  interaction="choose"
  scoring="weighted"
>
  <Criterion title="Reliability" impact="5">
    How safely the store preserves review state.
  </Criterion>
  <Criterion title="Setup" impact="2">
    How much local setup the store requires.
  </Criterion>
  <Option
    title="PostgreSQL"
    recommended
    summary="Use the store the team already operates."
  >
    <Score criterion="Reliability" verdict="Strong" tone="good" score="5">
      Transactions keep related state atomic.
    </Score>
    <Score criterion="Setup" verdict="Server" tone="mixed" score="2">
      A database service must be running.
    </Score>
  </Option>
  <Option title="SQLite">
    <Score criterion="Reliability" verdict="Strong" tone="good" score="4">
      A transaction protects each local write.
    </Score>
    <Score criterion="Setup" verdict="Embedded" tone="good" score="5">
      The process opens the file directly.
    </Score>
  </Option>
  <Reversibility rating="somewhat-hard">
    Changing stores requires a data migration but not a domain rewrite.
  </Reversibility>
</DecisionAnalysis>
```
