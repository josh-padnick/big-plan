// Proves which session answer an open tab may follow in place after a restart,
// so a reattach never lands on a session that is not the live one.

import { describe, expect, it } from "vitest";

import { reattachableSessionId } from "./review-wire.js";

const answer = (over: Record<string, unknown>) => ({
  plan: "/tmp/plan.mdx",
  authoritative: true,
  sessionId: "newsession",
  ...over,
});

describe("reattachableSessionId", () => {
  it("should follow an authoritative session under a new id", () => {
    expect(
      reattachableSessionId({
        value: answer({}),
        currentSessionId: "oldsession",
      }),
    ).toBe("newsession");
  });

  it("should not follow the session the tab already holds", () => {
    expect(
      reattachableSessionId({
        value: answer({ sessionId: "oldsession" }),
        currentSessionId: "oldsession",
      }),
    ).toBeUndefined();
  });

  it("should not follow a session that is not authoritative", () => {
    expect(
      reattachableSessionId({
        value: answer({ authoritative: false }),
        currentSessionId: "oldsession",
      }),
    ).toBeUndefined();
  });

  it("should refuse a malformed answer", () => {
    expect(
      reattachableSessionId({ value: null, currentSessionId: "oldsession" }),
    ).toBeUndefined();
    expect(
      reattachableSessionId({
        value: answer({ plan: undefined }),
        currentSessionId: "oldsession",
      }),
    ).toBeUndefined();
    expect(
      reattachableSessionId({
        value: answer({ sessionId: "" }),
        currentSessionId: "oldsession",
      }),
    ).toBeUndefined();
  });
});
