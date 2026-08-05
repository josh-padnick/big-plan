// Proves invalid store sentinels cannot leak absurd ages into review chrome.

import { describe, expect, it } from "vitest";
import {
  commentTimeLabel,
  compactDurationLabel,
  relativeSignalLabel,
} from "./time-label.js";

const NOW = Date.parse("2026-08-04T20:00:00.000Z");

describe("relativeSignalLabel", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "should reject invalid timestamp %s before subtracting",
    (at) => {
      expect(relativeSignalLabel({ now: NOW, at })).toBe("signal unavailable");
    },
  );

  it("should reject an implausible future timestamp", () => {
    expect(relativeSignalLabel({ now: NOW, at: NOW + 5 * 60_000 + 1 })).toBe(
      "signal unavailable",
    );
  });

  it("should keep useful recent labels and bound stale labels", () => {
    expect(relativeSignalLabel({ now: NOW, at: NOW - 18_000 })).toBe("18s ago");
    expect(relativeSignalLabel({ now: NOW, at: NOW - 125_000 })).toBe("2m ago");
    expect(relativeSignalLabel({ now: NOW, at: NOW - 8 * 60 * 60_000 })).toBe(
      "over an hour ago",
    );
  });
});

describe("commentTimeLabel", () => {
  const absoluteLabel = (at: number) => new Date(at).toISOString();

  it("should reject invalid and implausibly future activity timestamps", () => {
    expect(commentTimeLabel({ now: NOW, at: 0, absoluteLabel })).toBe(
      "Time unavailable",
    );
    expect(
      commentTimeLabel({
        now: NOW,
        at: NOW + 5 * 60_000 + 1,
        absoluteLabel,
      }),
    ).toBe("Time unavailable");
  });

  it("should preserve relative and absolute activity labels", () => {
    expect(
      commentTimeLabel({
        now: NOW,
        at: NOW - 125_000,
        absoluteLabel,
      }),
    ).toBe("2m");
    expect(
      commentTimeLabel({
        now: NOW,
        at: NOW - 2 * 60 * 60_000,
        absoluteLabel,
      }),
    ).toBe(new Date(NOW - 2 * 60 * 60_000).toISOString());
  });
});

describe("compactDurationLabel", () => {
  it("should reject missing or reversed endpoints", () => {
    expect(compactDurationLabel({ start: 0, end: NOW })).toBeNull();
    expect(compactDurationLabel({ start: NOW, end: NOW - 1 })).toBeNull();
  });

  it("should format a trustworthy event pair", () => {
    expect(compactDurationLabel({ start: NOW - 121_000, end: NOW })).toBe(
      "2m 01s",
    );
  });
});
