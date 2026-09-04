import { describe, expect, it } from "vitest";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  MERMAID_BROWSER_VERSION,
  MERMAID_ROLE_TOKENS,
  MERMAID_THEME_TOKENS,
  MERMAID_FONT_FAMILY,
  MERMAID_VERSION,
  isMermaidRenderFailure,
  parseMermaidRenderOutput,
  prepareMermaidArtifacts,
  renderMermaidSources,
  rewriteMermaidSvgTargets,
  type MermaidRawRender,
  type MermaidRenderResult,
} from "./renderer.js";

const success = (result: MermaidRenderResult | undefined): MermaidRawRender => {
  if (result === undefined || isMermaidRenderFailure(result)) {
    throw new Error(
      `expected a successful render, got ${JSON.stringify(result)}`,
    );
  }
  return result;
};

// Every case here compiles Mermaid through the pinned headless browser, so
// the whole suite takes the headroom a browser render needs. The default
// per-test timeout is tuned for pure logic and expires on a loaded machine
// while the render is still honest work.
const BROWSER_RENDER_TIMEOUT_MS = 60_000;

describe(
  "compile-time Mermaid renderer",
  { timeout: BROWSER_RENDER_TIMEOUT_MS },
  () => {
    it("renders both themes with pinned inputs", () => {
      const rendered = success(
        renderMermaidSources([
          {
            source: "flowchart LR\n  source[开始 · Start] --> result[✅ Done]",
          },
        ])[0],
      );
      expect(MERMAID_VERSION).toBe("11.16.0");
      expect(MERMAID_BROWSER_VERSION).toBe("1.61.1");
      expect(MERMAID_FONT_FAMILY).toBe("Noto Sans, Noto Sans SC");
      expect(rendered.light).toContain("Noto Sans");
      expect(rendered.light).toContain("Noto Sans SC");
      expect(rendered.light).toContain("开始");
      expect(rendered.light).toContain("✅");
      expect(rendered.dark).toContain("Noto Sans");
      expect(rendered.light).toContain("<svg");
      expect(rendered.dark).toContain("<svg");
      expect(rendered.light).not.toContain("foreignObject");
      expect(rendered.dark).not.toContain("foreignObject");
    });

    it("delivers a diagram in colour roles so it follows the reviewer's theme", () => {
      const rendered = success(
        renderMermaidSources([
          { source: "flowchart LR\n  a[Alpha] --> b[Beta]" },
        ])[0],
      );
      for (const variant of [rendered.light, rendered.dark] as const) {
        expect(variant).toContain("var(--surface-c)");
        expect(variant).toContain("var(--edge-strong-c)");
        expect(variant).toContain("var(--ink-c)");
        expect(variant).toContain("var(--subtle-c)");
      }
      // Every literal a role owns is gone, in both variants: a colour left
      // baked in would freeze that part of the diagram in the palette that
      // compiled it.
      for (const [variant, svg] of [
        ["light", rendered.light],
        ["dark", rendered.dark],
      ] as const) {
        for (const token of Object.keys(MERMAID_ROLE_TOKENS)) {
          const literal =
            MERMAID_THEME_TOKENS[variant][
              token as keyof (typeof MERMAID_THEME_TOKENS)[typeof variant]
            ];
          expect(
            svg.toLowerCase(),
            `${variant} still bakes ${token}`,
          ).not.toContain(literal);
        }
      }
    });

    it("keeps arrowhead markers and presentation attributes through sanitization", () => {
      const rendered = success(
        renderMermaidSources([
          { source: "flowchart LR\n  a[Alpha] --> b[Beta]" },
        ])[0],
      );
      expect(rendered.light).toContain("marker-end");
      expect(rendered.light).toContain("<marker");
      expect(rendered.light).toMatch(/<marker[^>]+refX="[^"]+"/u);
      expect(rendered.light).toMatch(/<marker[^>]+refY="[^"]+"/u);
      expect(rendered.light).toMatch(/<marker[^>]+markerWidth="[^"]+"/u);
      expect(rendered.light).toMatch(/<marker[^>]+markerHeight="[^"]+"/u);
      expect(rendered.light).toMatch(/<marker[^>]+markerUnits="[^"]+"/u);
      expect(rendered.light).toMatch(/<marker[^>]+orient="[^"]+"/u);
      expect(rendered.dark).toContain("marker-end");
    });

    it("keeps Mermaid's script-free text fallback for journey labels", () => {
      const rendered = success(
        renderMermaidSources([
          {
            source:
              "journey\n  title Plan review\n  section Understand\n    Read the diagram: 5: Reviewer\n    Leave feedback: 4: Reviewer",
          },
        ])[0],
      );
      expect(rendered.light).toContain("Read the diagram");
      expect(rendered.light).toContain("Leave feedback");
      expect(rendered.dark).toContain("Read the diagram");
      expect(rendered.dark).toContain("Leave feedback");
      expect(rendered.light).not.toContain("foreignObject");
      expect(rendered.dark).not.toContain("foreignObject");
    });

    it("returns a per-source failure instead of aborting the whole batch", () => {
      const results = renderMermaidSources([
        { source: "flowchart LR\n  a[A] -> b[B]" },
        { source: "flowchart LR\n  a[Alpha] --> b[Beta]" },
      ]);
      const failure = results[0];
      expect(failure !== undefined && isMermaidRenderFailure(failure)).toBe(
        true,
      );
      if (failure !== undefined && isMermaidRenderFailure(failure)) {
        expect(failure.error).not.toBe("");
      }
      expect(success(results[1]).light).toContain("<svg");
    });

    it("rejects malformed renderer process results at the typed boundary", () => {
      expect(() =>
        parseMermaidRenderOutput({ output: "[null]", expectedCount: 1 }),
      ).toThrow("Mermaid browser rendering returned an invalid diagram");
    });

    it("renders identical SVG across separate browser processes", () => {
      const source = `flowchart LR
  plan[Plan source] --> compile[[Compile]]
  compile --> review{Review}
  review -->|accept| execute([Execute])
  review -.->|revise| plan`;
      const first = success(renderMermaidSources([{ source }])[0]);
      const second = success(renderMermaidSources([{ source }])[0]);
      expect(first).toEqual(second);
    });

    it("does not pre-render Mermaid examples inside a fenced text block", () => {
      const markdown = `<MermaidDiagram>\n\n\`\`\`mermaid\nflowchart LR\n  a[Actual] --> b[Figure]\n\`\`\`\n\n</MermaidDiagram>\n\n\`\`\`\`text\n<MermaidDiagram>\n\`\`\`mermaid\nflowchart LR\n  rejected[Rejected]\n\`\`\`\n</MermaidDiagram>\n\`\`\`\``;
      const tree = unified().use(remarkParse).use(remarkMdx).parse(markdown);
      const artifacts = prepareMermaidArtifacts(tree);
      expect(artifacts.size).toBe(1);
      expect(artifacts.has("flowchart LR\n  a[Actual] --> b[Figure]")).toBe(
        true,
      );
    });

    it("maps every extracted node and edge to a Big Plan anchor", () => {
      const { light } = success(
        renderMermaidSources([
          { source: "flowchart LR\n  a[Alpha] -->|ships| b[Beta]" },
        ])[0],
      );
      const svg = rewriteMermaidSvgTargets({
        svg: light,
        idNamespace: "bp-mermaid-test-1",
        nodes: [
          {
            id: "a",
            label: "Alpha",
            anchor: "component/MermaidDiagram#1/node/a",
          },
          {
            id: "b",
            label: "Beta",
            anchor: "component/MermaidDiagram#1/node/b",
          },
        ],
        edges: [
          {
            from: "a",
            to: "b",
            label: "ships",
            anchor: "component/MermaidDiagram#1/edge/a/b",
          },
        ],
      });
      expect(svg).toContain('id="component/MermaidDiagram#1/node/a"');
      expect(svg).toContain('id="component/MermaidDiagram#1/node/b"');
      expect(svg).toContain('id="component/MermaidDiagram#1/edge/a/b"');
      expect(svg).toContain('data-flow-element="edge"');
      expect(svg).toContain("data-flow-edge-label-target");
    });

    it("maps edges whose flattened Mermaid ids collide", () => {
      const source =
        "flowchart LR\n  a_b[One] --> c[Three]\n  a[Two] --> b_c[Four]";
      const { light } = success(renderMermaidSources([{ source }])[0]);
      const svg = rewriteMermaidSvgTargets({
        svg: light,
        idNamespace: "bp-mermaid-test-2",
        nodes: [
          { id: "a_b", label: "One", anchor: "anchor/node/a_b" },
          { id: "c", label: "Three", anchor: "anchor/node/c" },
          { id: "a", label: "Two", anchor: "anchor/node/a" },
          { id: "b_c", label: "Four", anchor: "anchor/node/b_c" },
        ],
        edges: [
          { from: "a_b", to: "c", anchor: "anchor/edge/a_b/c" },
          { from: "a", to: "b_c", anchor: "anchor/edge/a/b_c" },
        ],
      });
      expect(svg).toContain('id="anchor/edge/a_b/c"');
      expect(svg).toContain('id="anchor/edge/a/b_c"');
    });

    it("isolates marker definitions for independently reviewable edges", () => {
      const source = "flowchart LR\n  a[Alpha] --> b[Beta]\n  a --> c[Gamma]";
      const { light } = success(renderMermaidSources([{ source }])[0]);
      const svg = rewriteMermaidSvgTargets({
        svg: light,
        idNamespace: "bp-mermaid-test-markers",
        nodes: [
          { id: "a", label: "Alpha", anchor: "anchor/node/a" },
          { id: "b", label: "Beta", anchor: "anchor/node/b" },
          { id: "c", label: "Gamma", anchor: "anchor/node/c" },
        ],
        edges: [
          { from: "a", to: "b", anchor: "anchor/edge/a/b" },
          { from: "a", to: "c", anchor: "anchor/edge/a/c" },
        ],
      });
      const markerReferences = [
        ...svg.matchAll(/marker-end="url\(#([^)]+)\)"/gu),
      ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
      expect(markerReferences).toHaveLength(2);
      expect(new Set(markerReferences).size).toBe(2);
      for (const reference of markerReferences) {
        expect(svg).toContain(`id="${reference}"`);
      }
    });

    it("suffixes DOM ids for a variant while keeping canonical anchors", () => {
      const { dark } = success(
        renderMermaidSources([
          { source: "flowchart LR\n  a[Alpha] --> b[Beta]" },
        ])[0],
      );
      const svg = rewriteMermaidSvgTargets({
        svg: dark,
        idNamespace: "bp-mermaid-test-3",
        nodes: [
          { id: "a", label: "Alpha", anchor: "anchor/node/a" },
          { id: "b", label: "Beta", anchor: "anchor/node/b" },
        ],
        edges: [{ from: "a", to: "b", anchor: "anchor/edge/a/b" }],
        idSuffix: "--dark",
      });
      expect(svg).toContain('id="anchor/node/a--dark"');
      expect(svg).toContain('id="anchor/edge/a/b--dark"');
      expect(svg).toContain('data-flow-anchor="anchor/node/a"');
      expect(svg).not.toContain('id="anchor/node/a"');
    });

    it("fails when a rendered target no longer matches the semantic model", () => {
      const { light } = success(
        renderMermaidSources([
          { source: "flowchart LR\n  a[Alpha] --> b[Beta]" },
        ])[0],
      );
      expect(() =>
        rewriteMermaidSvgTargets({
          svg: light,
          idNamespace: "bp-mermaid-test-4",
          nodes: [{ id: "missing", label: "Missing", anchor: "anchor" }],
          edges: [],
        }),
      ).toThrow(/target mismatch/u);
    });

    it("keeps non-flow types as sanitized figure-only SVG", () => {
      const result = success(
        renderMermaidSources([
          { source: "sequenceDiagram\n  Alice->>Bob: Hello" },
        ])[0],
      );
      const svg = rewriteMermaidSvgTargets({
        svg: result.light,
        idNamespace: "bp-mermaid-test-5",
        nodes: [],
        edges: [],
        interactive: false,
      });
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("data-flow-element");
      expect(svg).not.toContain("foreignObject");
    });

    it("adds stable static targets and wide edge hit paths for non-flow SVGs", () => {
      const sequence = success(
        renderMermaidSources([
          {
            source:
              "sequenceDiagram\n  participant Reviewer\n  participant Compiler\n  Reviewer->>Compiler: Submit source",
          },
        ])[0],
      );
      const svg = rewriteMermaidSvgTargets({
        svg: sequence.light,
        idNamespace: "bp-mermaid-test-6",
        nodes: [],
        edges: [],
        interactive: false,
        staticAnchorPrefix: "component/MermaidDiagram#1",
      });
      expect(svg).toContain(
        'data-flow-anchor="component/MermaidDiagram#1/node/Reviewer"',
      );
      expect(svg).toContain(
        'data-flow-anchor="component/MermaidDiagram#1/edge/Submit%20source"',
      );
      expect(svg).toContain('data-flow-element="node"');
      expect(svg).toContain('data-flow-element="edge"');
      expect(svg).toContain("data-flow-edge-label-target");
      expect(svg).toContain('data-flow-edge-hit=""');
      expect(svg).toContain('stroke-width="32"');
      expect(svg).not.toMatch(/marker-end="[^"]+"[^>]*data-flow-edge-hit/);
      expect(svg).toContain('width="450"');
      expect(svg).toContain('height="225"');
    });

    it("keeps static semantic targets unique when descendants reuse their ids", () => {
      const mindmap = success(
        renderMermaidSources([
          {
            source:
              "mindmap\n  root((Plan))\n    Source\n      MDX\n    Output",
          },
        ])[0],
      );
      const svg = rewriteMermaidSvgTargets({
        svg: mindmap.light,
        idNamespace: "bp-mermaid-test-mindmap",
        nodes: [],
        edges: [],
        interactive: false,
        staticAnchorPrefix: "component/MermaidDiagram#1",
      });
      const ids = [...svg.matchAll(/\sid="([^"]+)"/gu)].flatMap((match) =>
        match[1] === undefined ? [] : [match[1]],
      );
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("component/MermaidDiagram#1/node/Source");
      expect(ids).toContain("component/MermaidDiagram#1/node/MDX");
      expect(ids).toContain("component/MermaidDiagram#1/node/Output");
    });
  },
);
