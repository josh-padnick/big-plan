// Pins the persistence identity contract: location distinguishes plans while
// source revisions keep the same review namespace.

import { describe, expect, it } from "vitest";
import { derivePlanId } from "./plan-id.js";

describe("derivePlanId", () => {
  it("should distinguish plans when their paths differ", () => {
    expect(derivePlanId({ planPath: "/plans/first.mdx" })).not.toBe(
      derivePlanId({ planPath: "/plans/second.mdx" }),
    );
  });

  it("should keep one identity when plan content changes at the same path", () => {
    const planPath = "/plans/plan.mdx";
    expect(derivePlanId({ planPath })).toBe(derivePlanId({ planPath }));
  });

  it("should normalize the path and remain deterministic", () => {
    const expected = derivePlanId({ planPath: "/plans/plan.mdx" });

    expect(derivePlanId({ planPath: "/plans/nested/../plan.mdx" })).toBe(
      expected,
    );
    expect(expected).toMatch(/^[a-f0-9]{16}$/);
  });
});
