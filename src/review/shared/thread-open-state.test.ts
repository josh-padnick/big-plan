// Locks the disclosure defaults shared by inline cards and the feedback rail.

import { describe, expect, it } from "vitest";
import {
  isThreadOpen,
  toggleThreadOpen,
  type ThreadOpenState,
} from "./thread-open-state.js";

describe("thread open state", () => {
  const empty: ThreadOpenState = new Map();

  it("should keep draft defaults stable across rail states and surfaces", () => {
    expect(
      isThreadOpen({
        state: empty,
        commentId: "draft",
        kind: "draft",
        surface: "inline",
        isRailOpen: false,
      }),
    ).toBe(true);
    expect(
      isThreadOpen({
        state: empty,
        commentId: "draft",
        kind: "draft",
        surface: "inline",
        isRailOpen: true,
      }),
    ).toBe(false);
    expect(
      isThreadOpen({
        state: empty,
        commentId: "draft",
        kind: "draft",
        surface: "rail",
        isRailOpen: true,
      }),
    ).toBe(true);
  });

  it("should keep sent threads closed until their active channel is toggled", () => {
    const primary = toggleThreadOpen({
      state: empty,
      commentId: "sent",
      kind: "sent",
      surface: "rail",
      isRailOpen: true,
    });
    expect(
      isThreadOpen({
        state: primary,
        commentId: "sent",
        kind: "sent",
        surface: "rail",
        isRailOpen: true,
      }),
    ).toBe(true);
    expect(
      isThreadOpen({
        state: primary,
        commentId: "sent",
        kind: "sent",
        surface: "inline",
        isRailOpen: true,
      }),
    ).toBe(false);
  });
});
