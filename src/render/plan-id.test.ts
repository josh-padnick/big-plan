// Pins the persistence identity contract: location and exact source content
// both distinguish a plan, while equivalent inputs remain deterministic.

import { describe, expect, it } from "vitest";
import { derivePlanId } from "./plan-id.js";

describe("derivePlanId", () => {
  it("should distinguish plans with identical content at different paths", () => {
    const planContent = "# Shared title\n";

    expect(
      derivePlanId({ planPath: "/plans/first.mdx", planContent }),
    ).not.toBe(derivePlanId({ planPath: "/plans/second.mdx", planContent }));
  });

  it("should distinguish revisions at the same path", () => {
    const planPath = "/plans/plan.mdx";

    expect(
      derivePlanId({ planPath, planContent: "# Shared title\n\nFirst.\n" }),
    ).not.toBe(
      derivePlanId({ planPath, planContent: "# Shared title\n\nSecond.\n" }),
    );
  });

  it("should normalize the path and remain deterministic", () => {
    const planContent = "# Plan\n";
    const expected = derivePlanId({
      planPath: "/plans/plan.mdx",
      planContent,
    });

    expect(
      derivePlanId({
        planPath: "/plans/nested/../plan.mdx",
        planContent,
      }),
    ).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{32}$/);
  });
});
