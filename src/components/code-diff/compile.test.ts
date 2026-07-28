// Tests the compiler interface that turns authored CodeDiff inputs into the
// render-ready model shared by the header and diff-view modules.

import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import { compileCodeDiffComponent } from "./compile.js";
import { annotation, fence } from "./test-fixtures.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

describe("compileCodeDiffComponent", () => {
  it("should expose one render-ready model for valid authored input", () => {
    const diagnostics = createDiagnosticCollector();
    const source = "@@ -7 +7,2 @@\n-old();\n+new();\n+audit();\n";
    const model = compileCodeDiffComponent({
      attributes: {
        file: "src/retry.ts",
        showLineNumbers: true,
        showLineCounts: true,
      },
      children: [fence({ source })],
      scopedChildren: [
        annotation({ lines: "8", value: "Review the audit call." }),
      ],
      position: POSITION,
      diagnostics,
    });

    expect(diagnostics.diagnostics).toEqual([]);
    expect(model).toMatchObject({
      filePath: "src/retry.ts",
      source,
      showLineNumbers: true,
      showLineCounts: true,
      addedCount: 2,
      removedCount: 1,
    });
    expect(model.diff.hasHunkHeaders).toBe(true);
    expect(model.annotations).toHaveLength(1);
    expect(model.annotations[0]).toMatchObject({
      id: "annotation-1",
      lines: "8",
      startLine: 8,
      endLine: 8,
      side: "new",
      target: { kind: "add", newLineNumber: 8, text: "audit();" },
    });
    expect(() => JSON.stringify(model)).not.toThrow();
  });
});
