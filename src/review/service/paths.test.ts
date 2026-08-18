// Proves the fixed port stays fixed. Big Plan never slides to a neighbouring
// port, so the only ways the address changes are the explicit override and a
// value it refuses to honour.

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_PORT,
  serviceOrigin,
  servicePlanUrl,
  servicePort,
} from "./paths.js";

const previous = process.env["BIG_PLAN_PORT"];

afterEach(() => {
  if (previous === undefined) {
    delete process.env["BIG_PLAN_PORT"];
  } else {
    process.env["BIG_PLAN_PORT"] = previous;
  }
});

describe("service paths", () => {
  it("should claim the fixed port when nothing overrides it", () => {
    delete process.env["BIG_PLAN_PORT"];
    expect(servicePort()).toBe(DEFAULT_SERVICE_PORT);
    expect(serviceOrigin()).toBe(`http://127.0.0.1:${DEFAULT_SERVICE_PORT}`);
  });

  it("should honour an explicit override", () => {
    process.env["BIG_PLAN_PORT"] = "9123";
    expect(servicePort()).toBe(9123);
    expect(servicePlanUrl({ planId: "1111111111111111" })).toBe(
      "http://127.0.0.1:9123/plan/1111111111111111",
    );
  });

  it("should fall back to the fixed port rather than a value it cannot use", () => {
    // A refused override lands on the documented address, which is the one a
    // saved link already points at. Inventing a nearby port instead would make
    // the link wrong rather than the configuration loud.
    for (const value of ["", "  ", "not-a-port", "0", "-1", "70000", "80.5"]) {
      process.env["BIG_PLAN_PORT"] = value;
      expect(servicePort()).toBe(DEFAULT_SERVICE_PORT);
    }
  });

  it("should address a plan by its review-store identifier", () => {
    delete process.env["BIG_PLAN_PORT"];
    expect(servicePlanUrl({ planId: "abcdef0123456789" })).toBe(
      `http://127.0.0.1:${DEFAULT_SERVICE_PORT}/plan/abcdef0123456789`,
    );
  });
});
