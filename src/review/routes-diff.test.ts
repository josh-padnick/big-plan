import { describe, expect, it, vi } from "vitest";
import { compileMarkdown } from "../render/markdown/compile-markdown.js";
import { compileSnapshotDiffPayload } from "./routes-diff.js";

const FROM_SNAPSHOT = "1111111111111111";
const TO_SNAPSHOT = "2222222222222222";

describe("snapshot diff payload", () => {
  it("should compile each document once when a request has multiple locations", () => {
    const compileDocument = vi.fn(compileMarkdown);
    const beforeSource = `# Plan

## Approach

Keep the first path stable.

Keep the second path stable.
`;
    const afterSource = `# Plan

## Approach

Keep the first path resilient.

Keep the second path resilient.
`;

    const payload = compileSnapshotDiffPayload({
      from: FROM_SNAPSHOT,
      to: TO_SNAPSHOT,
      beforeSource,
      afterSource,
      compileDocument,
    });

    expect(payload.locations).toHaveLength(2);
    expect(compileDocument).toHaveBeenCalledTimes(2);
    expect(compileDocument.mock.calls.map(([input]) => input.markdown)).toEqual([
      beforeSource,
      afterSource,
    ]);
  });
});
