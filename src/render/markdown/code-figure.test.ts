// Tests the code-figure transform: which fences gain the shared maximize
// control, and which are left alone because a component's figure owns them.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

const compileAndSerialize = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
};

describe("compileMarkdown code figures", () => {
  it("should wrap a bare fence so a dense sketch can escape the reading column", () => {
    const bodyHtml = compileAndSerialize("```text\nsketch\n```\n");

    expect(bodyHtml).toContain('data-figure-maximizable="code"');
    expect(bodyHtml).toContain('data-figure-maximize=""');
    expect(bodyHtml).toContain('data-copy-code=""');
    expect(bodyHtml).toContain('<pre data-figure-body="">');
  });

  it("should ship the control dormant so no affordance acts without scripts", () => {
    const bodyHtml = compileAndSerialize("```text\nsketch\n```\n");

    expect(bodyHtml).toContain('hidden data-figure-maximize=""');
    expect(bodyHtml).toContain('hidden data-copy-code=""');
  });

  it("should leave a component's own fence alone because its figure owns it", () => {
    const bodyHtml = compileAndSerialize(
      '<CodeSnippet file="src/retry.ts">\n```ts\nconst a = 1;\n```\n</CodeSnippet>\n',
    );

    // One maximizable frame, contributed by the component, not two.
    expect(bodyHtml.match(/data-figure-maximizable/g)).toHaveLength(1);
    expect(bodyHtml).not.toContain('class="code-figure"');
  });
});
