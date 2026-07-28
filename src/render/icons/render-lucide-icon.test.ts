// Tests the Lucide adapter's deep icon-value interface and decorative SVG
// contract.

import { describe, expect, it } from "vitest";
import { CHECK_ICON } from "../../icons/lucide/check.js";
import { renderLucideIcon } from "./render-lucide-icon.js";

describe("renderLucideIcon", () => {
  it("should derive catalog identity and path data from one icon value", () => {
    const element = renderLucideIcon({ icon: CHECK_ICON, hidden: false });

    expect(element.properties["data-lucide"]).toBe("check");
    expect(element.children).toEqual([
      {
        type: "element",
        tagName: "path",
        properties: { d: "M20 6 9 17l-5-5" },
        children: [],
      },
    ]);
  });

  it("should mark a hidden decorative icon without changing its identity", () => {
    const element = renderLucideIcon({ icon: CHECK_ICON, hidden: true });

    expect(element.properties).toMatchObject({
      ariaHidden: "true",
      "data-lucide": "check",
      hidden: true,
    });
  });
});
