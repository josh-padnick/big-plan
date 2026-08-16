import { describe, expect, it } from "vitest";
import { projectThreadReopenStates } from "./thread-reopen.js";

describe("thread reopen projection", () => {
  it("should emit one state per current thread that a request reopened", () => {
    expect(
      projectThreadReopenStates({
        requests: [
          { reopenedCommentIds: ["aaaa", "bbbb"] },
          { reopenedCommentIds: ["aaaa"] },
        ],
        currentCommentIds: new Set(["aaaa", "cccc"]),
      }),
    ).toEqual([{ commentId: "aaaa" }]);
  });

  it("should ignore requests that never reopened a current thread", () => {
    expect(
      projectThreadReopenStates({
        requests: [{ reopenedCommentIds: ["bbbb"] }, {}],
        currentCommentIds: new Set(["aaaa"]),
      }),
    ).toEqual([]);
  });
});
