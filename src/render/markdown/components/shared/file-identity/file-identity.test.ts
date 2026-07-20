// Covers the shared file-identity caption's dir/name split and its accessible
// name across plain and nested paths.

import { describe, expect, it } from "vitest";
import { renderFileIdentity } from "./file-identity.js";

const textContent = (node: unknown): string => {
  if (typeof node !== "object" || node === null) {
    return "";
  }
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(textContent).join("");
  }
  return "";
};

describe("renderFileIdentity", () => {
  it("should pin the accessible name to the exact path when rendering", () => {
    const caption = renderFileIdentity({ filePath: "src/render/page.ts" });
    expect(caption.properties.ariaLabel).toBe("src/render/page.ts");
    expect(textContent(caption)).toBe("src/render/page.ts");
  });

  it("should split a nested path into a muted dir and an emphasized name", () => {
    const caption = renderFileIdentity({ filePath: "src/render/page.ts" });
    const html = JSON.stringify(caption);
    expect(html).toContain('"file-identity-dir"');
    expect(html).toContain("src/render/");
    expect(html).toContain('"file-identity-name"');
    expect(html).toContain("page.ts");
  });

  it("should omit the dir segment when the path has no directory", () => {
    const caption = renderFileIdentity({ filePath: "README.md" });
    const html = JSON.stringify(caption);
    expect(html).not.toContain('"file-identity-dir"');
    expect(textContent(caption)).toBe("README.md");
  });
});
