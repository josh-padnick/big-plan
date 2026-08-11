// Proves malformed timestamps cannot leak absurd ages into message chrome.

import { describe, expect, it } from "vitest";
import {
  compactDurationLabel,
  messageTimeLabel,
  relativeSignalLabel,
} from "./time-label.js";

const NOW = Date.parse("2026-08-08T20:00:00.000Z");
const absoluteLabel = (at: number) => new Date(at).toISOString();

describe("messageTimeLabel", () => {
  it("should reject invalid and implausibly future timestamps", () => {
    expect(
      messageTimeLabel({ now: NOW, createdAt: "invalid", absoluteLabel }),
    ).toBe("Time unavailable");
    expect(
      messageTimeLabel({
        now: NOW,
        createdAt: new Date(NOW + 5 * 60_000 + 1).toISOString(),
        absoluteLabel,
      }),
    ).toBe("Time unavailable");
  });

  it("should preserve relative and absolute activity labels", () => {
    expect(
      messageTimeLabel({
        now: NOW,
        createdAt: new Date(NOW - 125_000).toISOString(),
        absoluteLabel,
      }),
    ).toBe("2m");
    expect(
      messageTimeLabel({
        now: NOW,
        createdAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
        absoluteLabel,
      }),
    ).toBe(new Date(NOW - 2 * 60 * 60_000).toISOString());
  });
});

describe("connection time labels", () => {
  it("should reject missing signal times before subtracting", () => {
    expect(relativeSignalLabel({ now: NOW, at: 0 })).toBe("signal unavailable");
  });

  it("should keep recent signals useful and bound stale labels", () => {
    expect(relativeSignalLabel({ now: NOW, at: NOW - 18_000 })).toBe("18s ago");
    expect(relativeSignalLabel({ now: NOW, at: NOW - 125_000 })).toBe("2m ago");
    expect(relativeSignalLabel({ now: NOW, at: NOW - 8 * 60 * 60_000 })).toBe(
      "over an hour ago",
    );
  });

  it("should format trustworthy connection intervals", () => {
    expect(compactDurationLabel({ start: NOW - 121_000, end: NOW })).toBe(
      "2m 01s",
    );
    expect(compactDurationLabel({ start: 0, end: NOW })).toBeNull();
  });
});
