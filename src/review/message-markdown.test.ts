// Exercises the bounded Markdown subset carried to the inert review script.

import { describe, expect, it } from "vitest";
import {
  parseMessageMarkdown,
  validateMessageNodes,
} from "./message-markdown.js";

describe("agent message Markdown", () => {
  it("should preserve every allowed construct as inert structure", () => {
    const nodes = parseMessageMarkdown(
      [
        "**Bold** and *soft* with `code` and [docs](https://example.com).",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "```ts",
        "const safe = true;",
        "```",
      ].join("\n"),
    );
    expect(nodes.map(({ type }) => type)).toEqual([
      "paragraph",
      "list",
      "blockquote",
      "code",
    ]);
    expect(JSON.stringify(nodes)).toContain('"type":"strong"');
    expect(JSON.stringify(nodes)).toContain('"type":"emphasis"');
    expect(JSON.stringify(nodes)).toContain(
      '"type":"inlineCode","value":"code"',
    );
    expect(JSON.stringify(nodes)).toContain(
      '"type":"link","url":"https://example.com"',
    );
    expect(nodes.at(-1)).toMatchObject({
      type: "code",
      language: "ts",
      value: "const safe = true;",
    });
    expect(validateMessageNodes(nodes)).toEqual(nodes);
  });

  it("should flatten unsafe links, images, HTML, and headings to text", () => {
    expect(
      JSON.stringify(
        parseMessageMarkdown(
          "# Heading\n\n[bad](javascript:alert(1)) ![diagram](https://example.com/x.png) <b>raw</b>",
        ),
      ),
    ).not.toContain("javascript:");
    const text = JSON.stringify(
      parseMessageMarkdown(
        "# Heading\n\n[bad](javascript:alert(1)) ![diagram](https://example.com/x.png) <b>raw</b>",
      ),
    );
    expect(text).toContain("Heading");
    expect(text).toContain("diagram");
    expect(text).not.toContain('"type":"link"');
  });

  it("should fall back to one text node when the tree exceeds its bounds", () => {
    const source = Array.from(
      { length: 501 },
      (_, index) => `*word${index}*`,
    ).join(" ");
    expect(parseMessageMarkdown(source)).toEqual([
      { type: "text", value: source },
    ]);
  });

  it("should reject serialized links outside http and https", () => {
    expect(() =>
      validateMessageNodes([
        { type: "link", url: "javascript:alert(1)", children: [] },
      ]),
    ).toThrow(/http or https/);
  });
});
