// Proves the compiled inventory names exactly the decisions a plan asks, and
// that its digest moves with the decision's own content and nothing else.

import { describe, expect, it } from "vitest";
import { deriveDecisionInventory } from "./decision-inventory.js";

const PLAN = `# Durable decision answers

Choose the release path before implementation begins.

<Decision question="Which release path should we use?">

The rollout window closes on Friday.

<Option title="Gradual rollout" recommended summary="Start with one group.">
<Consideration label="Risk" verdict="Low" tone="good" />
</Option>

<Option title="Immediate rollout" summary="Release everywhere together.">
<Consideration label="Risk" verdict="High" tone="bad" />
</Option>

</Decision>

## Rollback

The rollback runbook stays unchanged.
`;

const inventoryOf = (markdown: string) =>
  deriveDecisionInventory({ markdown, fallbackTitle: "plan" });

const onlyEntry = (markdown: string) => {
  const entry = Array.from(inventoryOf(markdown).values())[0];
  if (entry === undefined) throw new Error("Expected one decision");
  return entry;
};

describe("compiled decision inventory", () => {
  it("should name each decision and the options it offers", () => {
    const inventory = inventoryOf(PLAN);

    expect(Array.from(inventory.keys())).toEqual([
      "decision-which-release-path-should-we-use",
    ]);
    expect(Array.from(onlyEntry(PLAN).optionIds).sort()).toEqual([
      "decision-which-release-path-should-we-use-option-gradual-rollout",
      "decision-which-release-path-should-we-use-option-immediate-rollout",
    ]);
  });

  it("should leave the digest alone when an unrelated section changes", () => {
    const edited = PLAN.replace(
      "The rollback runbook stays unchanged.",
      "The rollback runbook now names an owner.",
    );

    expect(onlyEntry(edited).decisionDigest).toBe(
      onlyEntry(PLAN).decisionDigest,
    );
  });

  it("should move the digest when the question is reworded", () => {
    const edited = PLAN.replace(
      "Which release path should we use?",
      "How should the release reach users?",
    );

    expect(Array.from(inventoryOf(edited).keys())).toEqual([
      "decision-how-should-the-release-reach-users",
    ]);
  });

  // The slug-preserving edits are the ones the old identity model could not
  // see at all, so each gets its own proof that the digest now moves.
  it.each([
    [
      "an option summary",
      "Start with one group.",
      "Start with the beta group.",
    ],
    ["a consideration verdict", 'verdict="Low"', 'verdict="Moderate"'],
    ["the recommended option", "recommended summary", "summary"],
    ["the decision's context", "closes on Friday.", "closes on Thursday."],
  ])("should move the digest when %s changes", (_label, before, after) => {
    const edited = PLAN.replace(before, after);
    expect(edited).not.toBe(PLAN);

    expect(onlyEntry(edited).decisionDigest).not.toBe(
      onlyEntry(PLAN).decisionDigest,
    );
  });

  it("should return the same digest for byte-identical content", () => {
    const edited = PLAN.replace(
      "Which release path should we use?",
      "How should the release reach users?",
    );
    const restored = edited.replace(
      "How should the release reach users?",
      "Which release path should we use?",
    );

    expect(restored).toBe(PLAN);
    expect(onlyEntry(restored).decisionDigest).toBe(
      onlyEntry(PLAN).decisionDigest,
    );
  });

  it("should omit a decision the plan presents for audit rather than answer", () => {
    const audited = `# Audit

<DecisionAnalysis question="Which release path should we use?" state="proposed" interaction="audit">

<Criterion title="Risk">

How much of the estate a bad release reaches.

</Criterion>

<Option title="Gradual rollout" recommended summary="Start with one group.">

<Score criterion="Risk" verdict="Low" tone="good">

One group absorbs the first failure.

</Score>

</Option>

<Option title="Immediate rollout" summary="Release everywhere together.">

<Score criterion="Risk" verdict="High" tone="bad">

Every user meets the first failure at once.

</Score>

</Option>

<Reversibility rating="easy">

The release can be rolled back from one console.

</Reversibility>

</DecisionAnalysis>
`;

    expect(inventoryOf(audited).size).toBe(0);
  });

  it("should name a decision the plan asks through any decision component", () => {
    const quick = `# Quick

<QuickDecision question="Ship behind a feature flag?">
  <Option title="Yes" recommended summary="Rollback stays one toggle away." />
  <Option title="No" />
</QuickDecision>
`;

    expect(Array.from(inventoryOf(quick).keys())).toEqual([
      "quick-decision-ship-behind-a-feature-flag",
    ]);
  });
});
