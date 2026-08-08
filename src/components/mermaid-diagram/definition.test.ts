import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../../render/render-document.js";

const GALLERY = readFileSync(
  new URL("../../../examples/mermaid-gallery.mdx", import.meta.url),
  "utf8",
);

const PLAN = `# Mermaid review

<MermaidDiagram>

\`\`\`mermaid
flowchart LR
  source[Source] -->|ships| result((Result))
\`\`\`

The compiled picture is the content floor.

</MermaidDiagram>
`;

describe("MermaidDiagram document delivery", () => {
  it("delivers static light and dark SVG with semantic anchors", () => {
    const { html } = renderDocument({
      markdown: PLAN,
      fallbackTitle: "Mermaid",
    });
    expect(html).toContain(
      'data-flow-anchor="component/MermaidDiagram#1/node/source"',
    );
    expect(html).toContain(
      'data-flow-anchor="component/MermaidDiagram#1/node/result"',
    );
    expect(html).toContain(
      'data-flow-anchor="component/MermaidDiagram#1/edge/source/result"',
    );
    expect(html).toContain("mermaid-diagram-svg-light");
    expect(html).toContain("mermaid-diagram-svg-dark");
    expect(html).not.toContain("mermaid.min.js");
    expect(html).toContain("font-family:Noto Sans");
    expect(html).toContain('font-family: "Noto Sans"');
    expect(html).toContain("The compiled picture is the content floor.");
  });

  it("reports a stable diagnostic when Mermaid rejects otherwise accepted source", () => {
    const markdown = `# Invalid\n\n<MermaidDiagram>\n\n\`\`\`mermaid\nsequenceDiagram\n  Alice->>Bob: PLAN_SECRET\n  definitely invalid\n\`\`\`\n\n</MermaidDiagram>\n`;
    try {
      renderDocument({ markdown, fallbackTitle: "Invalid" });
      throw new Error("Expected Mermaid rendering to fail");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MarkdownDiagnosticsError);
      const messages = (error as MarkdownDiagnosticsError).diagnostics.map(
        ({ message }) => message,
      );
      expect(messages).toEqual([
        "Mermaid could not render this diagram; check that the source uses valid supported Mermaid syntax",
      ]);
      expect(messages.join(" ")).not.toContain("PLAN_SECRET");
    }
  });

  it("rejects an additional fenced block instead of dropping it", () => {
    const markdown = `# Invalid\n\n<MermaidDiagram>\n\n\`\`\`mermaid\nflowchart LR\n  a[Alpha] --> b[Beta]\n\`\`\`\n\n\`\`\`text\nThis content must not disappear.\n\`\`\`\n\n</MermaidDiagram>\n`;
    expect(() =>
      renderDocument({ markdown, fallbackTitle: "Invalid" }),
    ).toThrow(MarkdownDiagnosticsError);
    try {
      renderDocument({ markdown, fallbackTitle: "Invalid" });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MarkdownDiagnosticsError);
      expect((error as MarkdownDiagnosticsError).diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("additional fenced code blocks"),
        }),
      );
    }
  });

  it("renders a Mermaid fence with an indented closing delimiter", () => {
    const markdown = `# Indented fence\n\n<MermaidDiagram>\n\n\`\`\`mermaid\nflowchart LR\n  a[Alpha] --> b[Beta]\n   \`\`\`\n\n</MermaidDiagram>\n`;
    const { html } = renderDocument({
      markdown,
      fallbackTitle: "Indented fence",
    });
    expect(html).toContain(
      'data-flow-anchor="component/MermaidDiagram#1/node/a"',
    );
    expect(html).toContain(
      'data-flow-anchor="component/MermaidDiagram#1/node/b"',
    );
  });

  it("rejects Mermaid fence metadata with an authoring diagnostic", () => {
    const markdown = `# Metadata\n\n<MermaidDiagram>\n\n\`\`\`mermaid title="Retry flow"\nflowchart LR\n  a[Alpha] --> b[Beta]\n\`\`\`\n\n</MermaidDiagram>\n`;
    try {
      renderDocument({ markdown, fallbackTitle: "Metadata" });
      throw new Error("Expected Mermaid metadata to be rejected");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MarkdownDiagnosticsError);
      const messages = (error as MarkdownDiagnosticsError).diagnostics.map(
        ({ message }) => message,
      );
      expect(messages).toContain(
        "Mermaid fence metadata is not supported; use exactly ```mermaid on the opening line",
      );
      expect(messages).not.toContain(
        "Mermaid SVG was not prepared; compile the document through Big Plan's renderer",
      );
    }
  });

  it("namespaces every SVG id across repeated Mermaid sources", () => {
    const figure = `<MermaidDiagram>\n\n\`\`\`mermaid\nflowchart LR\n  a[Alpha] --> b[Beta]\n\`\`\`\n\n</MermaidDiagram>`;
    const { html } = renderDocument({
      markdown: `# Repeated\n\n${figure}\n\n${figure}\n`,
      fallbackTitle: "Repeated",
    });
    const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    );
    expect(new Set(ids).size).toBe(ids.length);
    const references = [
      ...html.matchAll(/marker-(?:start|mid|end)="url\(#([^)]+)\)"/gu),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(ids).toContain(reference);
  });

  it("reports rejected Mermaid syntax before delivery", () => {
    const markdown = `# Invalid\n\n<MermaidDiagram>\n\n\`\`\`mermaid\nflowchart LR\n  subgraph Unsupported\n    source[Source]\n  end\n\`\`\`\n\n</MermaidDiagram>\n`;
    expect(() =>
      renderDocument({ markdown, fallbackTitle: "Invalid" }),
    ).toThrow(MarkdownDiagnosticsError);
    try {
      renderDocument({ markdown, fallbackTitle: "Invalid" });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MarkdownDiagnosticsError);
      expect((error as MarkdownDiagnosticsError).diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Subgraphs are not supported"),
        }),
      );
    }
  });

  it("renders the complete example gallery as static light and dark figures", () => {
    const { html } = renderDocument({
      markdown: GALLERY,
      fallbackTitle: "Gallery",
    });
    expect(html.match(/class="mermaid-diagram-static"/gu)).toHaveLength(20);
    expect(html.match(/data-mermaid-theme="light"/gu)).toHaveLength(20);
    expect(html.match(/data-mermaid-theme="dark"/gu)).toHaveLength(20);
    expect(html).toContain("subgraphs are not supported in v1");
    expect(html).not.toContain("mermaid.min.js");
  }, 15000);
});
