// Proves what "an agent still owes this request an answer" means: an answer
// closes it, and so does a cancellation - whether the store already carries it
// or the reviewer's own cancel write is still in flight.

import { describe, expect, it } from "vitest";
import { requestIsOutstanding } from "./request-lifecycle.js";

const REQUEST_ID = "aaaaaaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbbbbbbbbbb";

const outstanding = ({
  canceledAt,
  answeredRequestIds = new Set<string>(),
  cancelPendingRequestIds = new Set<string>(),
}: {
  readonly canceledAt?: string;
  readonly answeredRequestIds?: ReadonlySet<string>;
  readonly cancelPendingRequestIds?: ReadonlySet<string>;
} = {}): boolean =>
  requestIsOutstanding({
    request: {
      requestId: REQUEST_ID,
      ...(canceledAt === undefined ? {} : { canceledAt }),
    },
    answeredRequestIds,
    cancelPendingRequestIds,
  });

describe("requestIsOutstanding", () => {
  it("should hold an unanswered, uncanceled request outstanding", () => {
    expect(outstanding()).toBe(true);
  });

  it("should close a request the agent has answered", () => {
    expect(outstanding({ answeredRequestIds: new Set([REQUEST_ID]) })).toBe(
      false,
    );
  });

  it("should close a request the store already records as canceled", () => {
    expect(outstanding({ canceledAt: "2026-08-17T12:00:00.000Z" })).toBe(false);
  });

  // The cancel write can still be in flight while a poll returns the older
  // request, so local intent closes the request before the store confirms it.
  it("should close a request whose cancellation has not landed yet", () => {
    expect(
      outstanding({ cancelPendingRequestIds: new Set([REQUEST_ID]) }),
    ).toBe(false);
  });

  it("should ignore an answer or a cancellation that names another request", () => {
    expect(
      outstanding({
        answeredRequestIds: new Set([OTHER_ID]),
        cancelPendingRequestIds: new Set([OTHER_ID]),
      }),
    ).toBe(true);
  });
});
