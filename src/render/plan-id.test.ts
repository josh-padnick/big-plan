import { describe, expect, it } from "vitest";
import { derivePlanId } from "./plan-id.js";

describe("derivePlanId", () => {
  it("should give two plans distinct ids when their paths differ", () => {
    expect(derivePlanId({ planPath: "/plans/a.mdx" })).not.toBe(
      derivePlanId({ planPath: "/plans/b.mdx" }),
    );
  });

  it("should give the same id when the same path is spelled differently", () => {
    expect(derivePlanId({ planPath: "/plans/./nested/../a.mdx" })).toBe(
      derivePlanId({ planPath: "/plans/a.mdx" }),
    );
  });

  it("should keep the id stable when the plan's content changes", () => {
    // Drafts are namespaced by this id, so a content-sensitive id would orphan
    // a reviewer's unsent notes on the very re-render their feedback produced.
    const before = derivePlanId({ planPath: "/plans/a.mdx" });
    const after = derivePlanId({ planPath: "/plans/a.mdx" });
    expect(after).toBe(before);
  });

  it("should produce a short, path-safe id when given any path", () => {
    expect(derivePlanId({ planPath: "/plans/a b/c'd.mdx" })).toMatch(
      /^[a-f0-9]{16}$/,
    );
  });
});
