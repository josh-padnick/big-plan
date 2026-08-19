// Proves review chronology follows instants while retaining deterministic
// behavior for malformed stored values.

import { describe, expect, it } from "vitest";
import { compareTimestamps } from "./timestamp-order.js";

describe("compareTimestamps", () => {
  it("should order different ISO spellings by their instant", () => {
    expect(
      compareTimestamps("2026-08-10T18:00:00Z", "2026-08-10T18:00:00.100Z"),
    ).toBeLessThan(0);
  });

  it("should fall back to lexical order when either value is unparseable", () => {
    expect(compareTimestamps("not-a-time-a", "not-a-time-b")).toBeLessThan(0);
  });
});
