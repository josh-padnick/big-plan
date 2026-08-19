// Proves the canonical form one feedback submission is identified by: the same
// set of comments in any order is the same submission, and the fields a
// submission is not identified by cannot move it.

import { describe, expect, it } from "vitest";
import { canonicalSubmissionComments } from "./routes-review-state.js";
import type { ReviewComment } from "./shared/comment.js";

const SNAPSHOT = "a".repeat(16);

const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: "c1c1c1c1",
  body: "Say why this step comes first.",
  premiseSnapshot: SNAPSHOT,
  target: { type: "document" },
  createdAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

describe("canonicalSubmissionComments", () => {
  it("should give one order however the comments arrive", () => {
    const first = comment({ id: "aaaaaaaa" });
    const second = comment({ id: "bbbbbbbb" });

    expect(canonicalSubmissionComments([second, first])).toEqual(
      canonicalSubmissionComments([first, second]),
    );
    expect(
      canonicalSubmissionComments([second, first]).map((entry) => entry.id),
    ).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("should carry only the fields a submission is identified by", () => {
    expect(canonicalSubmissionComments([comment()])).toEqual([
      {
        id: "c1c1c1c1",
        body: "Say why this step comes first.",
        premiseSnapshot: SNAPSHOT,
        target: { type: "document" },
      },
    ]);
  });

  it("should ignore a field outside that set", () => {
    expect(
      canonicalSubmissionComments([
        comment({ createdAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    ).toEqual(canonicalSubmissionComments([comment()]));
  });

  it("should separate submissions whose comments differ", () => {
    expect(canonicalSubmissionComments([comment()])).not.toEqual(
      canonicalSubmissionComments([comment({ body: "Something else." })]),
    );
  });
});
