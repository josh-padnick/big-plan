import { describe, expect, it } from "vitest";
import {
  commentTargetSideLabel,
  isCommentTargetSide,
  sideQualifiedControlLabel,
} from "./comment-target-side.js";

describe("comment target side", () => {
  it("names each side with the diff toggle's own word", () => {
    expect(commentTargetSideLabel("baseline")).toBe("Was");
    expect(commentTargetSideLabel("proposed")).toBe("Now");
  });

  it("accepts only the two sides a component diff has", () => {
    expect(isCommentTargetSide("baseline")).toBe(true);
    expect(isCommentTargetSide("proposed")).toBe(true);
    expect(isCommentTargetSide("live")).toBe(false);
    expect(isCommentTargetSide(undefined)).toBe(false);
  });

  it("tells two identically named controls apart by their side", () => {
    expect(
      sideQualifiedControlLabel({
        label: "Comment on Queue",
        side: "baseline",
      }),
    ).toBe("Comment on Queue (Was)");
    expect(
      sideQualifiedControlLabel({
        label: "Comment on Queue",
        side: "proposed",
      }),
    ).toBe("Comment on Queue (Now)");
  });

  it("leaves a control outside every diff unqualified", () => {
    expect(sideQualifiedControlLabel({ label: "Comment on Queue" })).toBe(
      "Comment on Queue",
    );
  });
});
