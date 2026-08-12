import { describe, expect, it } from "vitest";
import {
  reconcilePendingCancellations,
  requestIsCanceled,
} from "./cancel-pending.js";

describe("pending cancellation", () => {
  it("should preserve local cancel intent across an older poll", () => {
    const pendingRequestIds = new Set(["request-1"]);
    expect(
      requestIsCanceled({
        request: { requestId: "request-1" },
        pendingRequestIds,
      }),
    ).toBe(true);
    expect(
      reconcilePendingCancellations({
        pendingRequestIds,
        requests: [{ requestId: "request-1" }],
      }),
    ).toEqual(pendingRequestIds);
  });

  it("should release local intent after the server confirms cancellation", () => {
    expect(
      reconcilePendingCancellations({
        pendingRequestIds: new Set(["request-1", "request-2"]),
        requests: [
          { requestId: "request-1", canceledAt: "2026-08-10T20:00:00Z" },
          { requestId: "request-2" },
        ],
      }),
    ).toEqual(new Set(["request-2"]));
  });
});
