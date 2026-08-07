import { describe, expect, it } from "vitest";
import { parseCommentMarkdownLine } from "./comment-markdown.js";

describe("review comment Markdown", () => {
  it("should parse code spans and emphasis into display tokens", () => {
    expect(
      parseCommentMarkdownLine(
        "Keep `leaseOwner`, **retry this**, and _explain why_.",
      ),
    ).toEqual([
      { type: "text", value: "Keep " },
      { type: "code", value: "leaseOwner" },
      { type: "text", value: ", " },
      { type: "strong", value: "retry this" },
      { type: "text", value: ", and " },
      { type: "emphasis", value: "explain why" },
      { type: "text", value: "." },
    ]);
  });

  it("should preserve authored HTML as inert text", () => {
    expect(parseCommentMarkdownLine("<strong>Reviewer text</strong>")).toEqual([
      { type: "text", value: "<strong>Reviewer text</strong>" },
    ]);
  });
});
