import { describe, expect, it } from "vitest";
import { MERMAID_FIXTURES } from "./fixtures.js";
import { parseMermaidSource } from "./parse.js";
import {
  isMermaidRenderFailure,
  renderMermaidSources,
  rewriteMermaidSvgTargets,
} from "./renderer.js";

describe("MermaidDiagram fixture corpus", () => {
  it("accepts every v1 fixture and extracts the expected semantic breadth", () => {
    for (const fixture of MERMAID_FIXTURES) {
      const parsed = parseMermaidSource(fixture.source);
      expect(parsed.diagnostics, fixture.name).toEqual([]);
      if (parsed.interactive) {
        expect(parsed.nodes.length, fixture.name).toBeGreaterThanOrEqual(2);
        expect(parsed.edges.length, fixture.name).toBeGreaterThanOrEqual(1);
      } else {
        expect(parsed.nodes, fixture.name).toEqual([]);
        expect(parsed.edges, fixture.name).toEqual([]);
      }
    }
    expect(parseMermaidSource(MERMAID_FIXTURES[4].source).nodes).toHaveLength(
      10,
    );
    expect(parseMermaidSource(MERMAID_FIXTURES[6].source).edges).toHaveLength(
      5,
    );
  });

  it("renders every fixture and maps every semantic target", () => {
    const rendered = renderMermaidSources(
      MERMAID_FIXTURES.map(({ source }) => ({ source })),
    );
    for (const [index, fixture] of MERMAID_FIXTURES.entries()) {
      const parsed = parseMermaidSource(fixture.source);
      const result = rendered[index];
      expect(
        result !== undefined && !isMermaidRenderFailure(result),
        fixture.name,
      ).toBe(true);
      if (result === undefined || isMermaidRenderFailure(result)) continue;
      const svg = rewriteMermaidSvgTargets({
        svg: result.light,
        idNamespace: `bp-mermaid-fixture-${index + 1}`,
        nodes: parsed.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          anchor: `fixture/${fixture.name}/node/${node.id}`,
        })),
        edges: parsed.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          ...(edge.label === undefined ? {} : { label: edge.label }),
          anchor: `fixture/${fixture.name}/edge/${edge.from}/${edge.to}`,
        })),
        interactive: parsed.interactive,
        ...(parsed.interactive
          ? {}
          : { staticAnchorPrefix: `fixture/${fixture.name}` }),
      });
      if (!parsed.interactive) {
        const darkSvg = rewriteMermaidSvgTargets({
          svg: result.dark,
          idNamespace: `bp-mermaid-fixture-${index + 1}`,
          nodes: [],
          edges: [],
          interactive: false,
          idSuffix: "--dark",
          staticAnchorPrefix: `fixture/${fixture.name}`,
        });
        const anchors = (value: string): ReadonlyArray<string> =>
          [...value.matchAll(/data-flow-anchor="([^"]+)"/gu)].flatMap(
            (match) => (match[1] === undefined ? [] : [match[1]]),
          );
        expect(anchors(svg).length, fixture.name).toBeGreaterThan(0);
        expect(anchors(darkSvg), fixture.name).toEqual(anchors(svg));
        expect(svg, fixture.name).not.toMatch(/\/item\/\d+/u);
        expect(svg, fixture.name).not.toMatch(
          /aria-label="(?:node|edge) \d+"/u,
        );
        continue;
      }
      expect(
        (svg.match(/data-flow-element="node"/gu) ?? []).length,
        fixture.name,
      ).toBe(parsed.nodes.length);
      expect(
        (svg.match(/data-flow-element="edge"/gu) ?? []).length,
        fixture.name,
      ).toBe(parsed.edges.length);
    }
  });
});
