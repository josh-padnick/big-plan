// Proves the one lifetime phrasing the runtime, the command, and the browser
// banner share, including the sub-minute case the CLI floor still allows
// programmatically.

import { describe, expect, it } from "vitest";
import { reviewIdleDurationLabel } from "./review-lifetime.js";

describe("review idle duration label", () => {
  it("should name whole minutes as minutes", () => {
    expect(reviewIdleDurationLabel(30 * 60 * 1_000)).toBe("30 minutes");
    expect(reviewIdleDurationLabel(60 * 1_000)).toBe("1 minute");
  });

  it("should name a partial minute in seconds", () => {
    expect(reviewIdleDurationLabel(1_000)).toBe("1 second");
    expect(reviewIdleDurationLabel(90 * 1_000)).toBe("90 seconds");
  });
});
