import { describe, expect, it } from "vitest";
import { parseReviewerMarkdown } from "./reviewer-markdown.js";

const id = "a".repeat(64);

describe("reviewer Markdown", () => {
  it("should accept only a valid review-image digest", () => {
    expect(parseReviewerMarkdown(`![shot](review-image:${id})`)).toEqual([
      {
        type: "paragraph",
        children: [{ type: "image", id, alt: "shot" }],
      },
    ]);
    expect(
      parseReviewerMarkdown("![shot](https://example.com/shot.png)"),
    ).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "shot" }] },
    ]);
    expect(parseReviewerMarkdown("![shot](review-image:not-a-digest)")).toEqual(
      [{ type: "paragraph", children: [{ type: "text", value: "shot" }] }],
    );
  });

  it("should keep authored HTML inert and preserve basic structure", () => {
    expect(parseReviewerMarkdown("**bold**\n\n- one\n- two")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "strong", children: [{ type: "text", value: "bold" }] },
        ],
      },
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "one" }] },
            ],
          },
          {
            type: "listItem",
            children: [
              { type: "paragraph", children: [{ type: "text", value: "two" }] },
            ],
          },
        ],
      },
    ]);
    expect(parseReviewerMarkdown("<script>alert(1)</script>")).toEqual([
      { type: "text", value: "<script>alert(1)</script>" },
    ]);
  });

  it("should fall back to text when the tree exceeds the safety bounds", () => {
    const value = Array.from({ length: 501 }, () => "x").join("\n\n");
    expect(parseReviewerMarkdown(value)).toEqual([{ type: "text", value }]);
  });
});
