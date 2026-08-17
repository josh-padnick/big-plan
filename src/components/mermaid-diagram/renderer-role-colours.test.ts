// Tests the two pure rules that turn a Mermaid diagram's baked colours back
// into colour roles. The renderer suite proves the whole delivery through the
// pinned browser; these cases prove the substitution itself, so a role mapping
// that stops matching fails here in milliseconds rather than behind a render.

import { describe, expect, it } from "vitest";
import {
  MERMAID_ROLE_TOKENS,
  MERMAID_THEME_TOKENS,
  roleSubstitutions,
  substituteColours,
} from "./renderer.js";

describe("mermaid role colours", () => {
  it("should map every role-bearing token's literal to its role", () => {
    for (const variant of ["light", "dark"] as const) {
      const substitutions = roleSubstitutions({ variant });
      for (const [token, role] of Object.entries(MERMAID_ROLE_TOKENS)) {
        const literal =
          MERMAID_THEME_TOKENS[variant][
            token as keyof (typeof MERMAID_THEME_TOKENS)[typeof variant]
          ];
        expect(
          substitutions.get(literal.toLowerCase()),
          `${variant}/${token}`,
        ).toBe(`var(${role})`);
      }
    }
  });

  it("should leave a tint that owns no role alone", () => {
    // The secondary and tertiary tints are deliberately literal: giving them
    // the nearest role would move pixels in the default palette.
    const substitutions = roleSubstitutions({ variant: "light" });
    for (const token of [
      "secondaryColor",
      "secondaryBorderColor",
      "tertiaryColor",
      "tertiaryBorderColor",
    ] as const) {
      const literal = MERMAID_THEME_TOKENS.light[token];
      expect(substitutions.get(literal.toLowerCase()), token).toBeUndefined();
    }
  });

  it("should rewrite every baked literal in one value and keep the rest", () => {
    const substitutions = new Map([
      ["#f7f5f0", "var(--bg)"],
      ["#211e1a", "var(--ink-c)"],
    ]);
    expect(
      substituteColours({
        value: "fill:#F7F5F0;stroke:#211e1a;stroke-width:2px",
        substitutions,
      }),
    ).toBe("fill:var(--bg);stroke:var(--ink-c);stroke-width:2px");
  });

  it("should leave a literal no role claims untouched", () => {
    expect(
      substituteColours({
        value: "#123456",
        substitutions: new Map([["#f7f5f0", "var(--bg)"]]),
      }),
    ).toBe("#123456");
  });

  it("should refuse a mapping where two roles claim one literal", () => {
    // Two roles resolving to the same shade would make the rewrite ambiguous,
    // so the renderer fails at compile time rather than picking one.
    expect(() =>
      roleSubstitutions({
        variant: "light",
        themeTokens: { light: { mainBkg: "#101010", nodeBorder: "#101010" } },
        roleTokens: { mainBkg: "--surface-c", nodeBorder: "--edge-strong-c" },
      }),
    ).toThrow(/shares #101010 with a different role/u);
  });

  it("should accept two tokens that claim one literal for one role", () => {
    // --bg reaches two tokens on purpose, so sharing a shade is only a failure
    // when the roles differ.
    expect(
      roleSubstitutions({
        variant: "light",
        themeTokens: {
          light: { background: "#101010", edgeLabelBackground: "#101010" },
        },
        roleTokens: { background: "--bg", edgeLabelBackground: "--bg" },
      }).get("#101010"),
    ).toBe("var(--bg)");
  });

  it("should refuse a role token the variant bakes no literal for", () => {
    expect(() =>
      roleSubstitutions({
        variant: "light",
        themeTokens: { light: { mainBkg: "#101010" } },
        roleTokens: { nodeBorder: "--edge-strong-c" },
      }),
    ).toThrow(/"nodeBorder" has no light literal/u);
  });
});
