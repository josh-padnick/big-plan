// Proves the one fact that separates "this change left the plan" from "the
// page has not caught up yet", now that it is the two snapshot ids rather than
// a timer only one of the plan's two writers ever started.

import { describe, expect, it } from "vitest";
import { isPlanDomBehind } from "./plan-dom-lag.js";

describe("isPlanDomBehind", () => {
  it("is behind when the article is a revision older than the plan", () => {
    expect(
      isPlanDomBehind({ displayedSnapshot: "aaa", currentSnapshot: "bbb" }),
    ).toBe(true);
  });

  it("is not behind when they agree", () => {
    expect(
      isPlanDomBehind({ displayedSnapshot: "aaa", currentSnapshot: "aaa" }),
    ).toBe(false);
  });

  it("says nothing before the first poll answers", () => {
    // Treating an unknown snapshot as a lag would hide every change on a page
    // that has only just opened.
    expect(
      isPlanDomBehind({ displayedSnapshot: "aaa", currentSnapshot: "" }),
    ).toBe(false);
    expect(
      isPlanDomBehind({ displayedSnapshot: "", currentSnapshot: "bbb" }),
    ).toBe(false);
  });

  it("does not care which writer moved the bytes", () => {
    // The predecessor knew about the reviewer's verdicts and not the agent's
    // publishes, which is the gap four rounds of defects came through.
    expect(
      isPlanDomBehind({
        displayedSnapshot: "agent-1",
        currentSnapshot: "agent-2",
      }),
    ).toBe(true);
  });
});
