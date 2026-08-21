// Proves the approved-state copy the details popover paints: a locale date
// row, no invented clock for a bad timestamp, and count-aware leftover
// decisions that stay explicitly non-critical.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approvedAtExactLabel,
  approvedOnLabel,
  unansweredNonCriticalCopy,
} from "./approval-copy.js";

const AT = "2026-08-20T13:42:00.000Z";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("approvedOnLabel", () => {
  it("formats a valid timestamp as Approved <month day>", () => {
    vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("Aug 20");
    expect(approvedOnLabel(AT)).toBe("Approved Aug 20");
  });

  it("does not invent a date for an unparseable timestamp", () => {
    expect(approvedOnLabel("not-a-date")).toBe("Approved");
  });
});

describe("approvedAtExactLabel", () => {
  it("exposes the exact local time for a title tooltip", () => {
    vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue(
      "Aug 20, 2026, 6:42 AM",
    );
    expect(approvedAtExactLabel(AT)).toBe("Aug 20, 2026, 6:42 AM");
  });

  it("omits the tooltip when the timestamp is unusable", () => {
    expect(approvedAtExactLabel("not-a-date")).toBeUndefined();
  });
});

describe("unansweredNonCriticalCopy", () => {
  it("omits the row when nothing remains unanswered", () => {
    expect(unansweredNonCriticalCopy(0)).toBeUndefined();
    expect(unansweredNonCriticalCopy(-1)).toBeUndefined();
  });

  it("uses singular copy for one leftover decision", () => {
    expect(unansweredNonCriticalCopy(1)).toBe(
      "1 non-critical decision was left unanswered.",
    );
  });

  it("uses plural copy for two or more leftover decisions", () => {
    expect(unansweredNonCriticalCopy(2)).toBe(
      "2 non-critical decisions were left unanswered.",
    );
    expect(unansweredNonCriticalCopy(5)).toBe(
      "5 non-critical decisions were left unanswered.",
    );
  });
});
