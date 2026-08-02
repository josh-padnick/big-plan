// Tests DataTable's shared comparator, especially values that cannot be read
// as the type an author declared.

import { describe, expect, it } from "vitest";
import { compareDataTableValues } from "./sort-values.js";

describe("compareDataTableValues", () => {
  it.each([1, -1] as const)(
    "should sort an unreadable number last in direction %i",
    (direction) => {
      expect(
        compareDataTableValues({
          left: "N/A",
          right: "2",
          type: "number",
          direction,
        }),
      ).toBeGreaterThan(0);
      expect(
        compareDataTableValues({
          left: "2",
          right: "N/A",
          type: "number",
          direction,
        }),
      ).toBeLessThan(0);
    },
  );

  it("should compare readable formatted numbers in the requested direction", () => {
    expect(
      compareDataTableValues({
        left: "$1,200",
        right: "$9,000",
        type: "number",
        direction: 1,
      }),
    ).toBeLessThan(0);
    expect(
      compareDataTableValues({
        left: "$1,200",
        right: "$9,000",
        type: "number",
        direction: -1,
      }),
    ).toBeGreaterThan(0);
  });
});
