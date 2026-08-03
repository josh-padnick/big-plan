// Tests the Decision family's stable review-address allocation contract.

import { describe, expect, it } from "vitest";
import {
  duplicateExplicitDecisionIds,
  resolveDecisionElementIds,
} from "./decision-card-anchors.js";

describe("Decision-family review anchors", () => {
  it("should reserve explicit ids before allocating prose-derived slugs", () => {
    expect(
      resolveDecisionElementIds([
        { label: "Canary", fallback: "option" },
        { id: "canary", label: "Regional rollout", fallback: "option" },
        { id: "canary-2", label: "Staged rollout", fallback: "option" },
      ]),
    ).toEqual(["canary-3", "canary", "canary-2"]);
  });

  it("should preserve duplicate explicit ids for compiler diagnostics", () => {
    const entries = [
      { id: "canary", label: "First", fallback: "option" },
      { id: "canary", label: "Second", fallback: "option" },
    ];

    expect(resolveDecisionElementIds(entries)).toEqual(["canary", "canary"]);
    expect(duplicateExplicitDecisionIds(entries)).toEqual([
      { id: "canary", index: 1 },
    ]);
  });
});
