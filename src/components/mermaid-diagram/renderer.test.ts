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
  createMermaidRenderCache,
  isMermaidRenderFailure,
  parseMermaidRenderOutput,
  prepareMermaidArtifacts,
  renderMermaidSources,
  renderMermaidSourcesAsync,
  rewriteMermaidSvgTargets,
  warmMermaidArtifacts,
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
      // Isolated caches force two genuine renders: this is the determinism the
      // shared render cache relies on to be safe.
      const first = success(
        renderMermaidSources([{ source }], {
          cache: createMermaidRenderCache(),
        })[0],
      );
      const second = success(
        renderMermaidSources([{ source }], {
          cache: createMermaidRenderCache(),
        })[0],
      );
      expect(first).toEqual(second);
    });

    it("serves a repeated render from the content cache instead of relaunching Chromium (BIG-300)", () => {
      const cache = createMermaidRenderCache();
      const source = "flowchart LR\n  a[Alpha] --> b[Beta]";
      const first = renderMermaidSources([{ source }], { cache })[0];
      const second = renderMermaidSources([{ source }], { cache })[0];
      // Reference equality proves the second call returned the cached object:
      // no second Chromium launch, and no event-loop-blocking render. This is
      // the re-render that starved the review heartbeat before the fix.
      expect(second).toBe(first);
      // A fresh cache renders again into a different object, so the identity
      // check above is meaningful and the diagrams stay deterministic.
      const rerendered = renderMermaidSources([{ source }], {
        cache: createMermaidRenderCache(),
      })[0];
      expect(rerendered).not.toBe(first);
      expect(rerendered).toEqual(first);
    });

    it("caches a render failure so a broken diagram is not re-rendered every request", () => {
      const cache = createMermaidRenderCache();
      const source = "flowchart LR\n  a[A] -> b[B]";
      const first = renderMermaidSources([{ source }], { cache })[0];
      expect(first !== undefined && isMermaidRenderFailure(first)).toBe(true);
      const second = renderMermaidSources([{ source }], { cache })[0];
      expect(second).toBe(first);
    });

    it("renders the same SVG on the async path as the sync path", async () => {
      const source = "flowchart LR\n  async[Async] --> same[Same]";
      const sync = success(
        renderMermaidSources([{ source }], {
          cache: createMermaidRenderCache(),
        })[0],
      );
      const asynchronous = success(
        (
          await renderMermaidSourcesAsync([{ source }], {
            cache: createMermaidRenderCache(),
          })
        )[0],
      );
      expect(asynchronous).toEqual(sync);
    });

    it("coalesces concurrent async renders for the same uncached source (BIG-300)", async () => {
      const cache = createMermaidRenderCache();
      const source = "flowchart LR\n  concurrent[Concurrent] --> once[Once]";
      const [first, second] = await Promise.all([
        renderMermaidSourcesAsync([{ source }], { cache }),
        renderMermaidSourcesAsync([{ source }], { cache }),
      ]);
      expect(second[0]).toBe(first[0]);
    });

    it("keeps recurring diagrams cached across a growing revision sequence (BIG-300)", async () => {
      const cache = createMermaidRenderCache();
      const revisions = [
        ["a", "b"],
        ["a", "b", "c"],
        ["a", "c", "d"],
        ["a", "b", "d", "e"],
      ].map((names) =>
        names.map((name) => ({
          source: `flowchart LR\n  ${name}[${name}] --> done[Done]`,
        })),
      );
      const firstBySource = new Map<string, MermaidRenderResult>();
      const identities = new Set<MermaidRenderResult>();
      for (const revision of revisions) {
        const rendered = await renderMermaidSourcesAsync(revision, { cache });
        revision.forEach(({ source }, index) => {
          const result = rendered[index] as MermaidRenderResult;
          const earlier = firstBySource.get(source);
          if (earlier === undefined) firstBySource.set(source, result);
          else expect(result).toBe(earlier);
          identities.add(result);
        });
      }
      expect(identities.size).toBe(firstBySource.size);
      expect(firstBySource.size).toBe(5);
    });

    it("warms diagrams off the event loop so the synchronous render never blocks (BIG-300)", async () => {
      const source = "flowchart LR\n  warm[Warm] --> ready[Ready]";
      const markdown = `<MermaidDiagram>\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n</MermaidDiagram>`;
      const tree = unified().use(remarkParse).use(remarkMdx).parse(markdown);
      // The event loop must keep turning while the async render runs, or a
      // review heartbeat would starve exactly as it did before the fix.
      let ticks = 0;
      const ticker = setInterval(() => {
        ticks += 1;
      }, 50);
      try {
        await warmMermaidArtifacts(tree);
      } finally {
        clearInterval(ticker);
      }
      expect(ticks).toBeGreaterThan(0);
      // The synchronous compile now reads the warmed cache: the same object,
      // with no Chromium launch on the request path.
      const warmed = prepareMermaidArtifacts(tree).get(source);
      expect(warmed).toBe(renderMermaidSources([{ source }])[0]);
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
