import { describe, expect, it } from "vitest";
import { parseMermaidSource } from "./parse.js";

describe("MermaidDiagram v1 parser", () => {
  it("accepts all four directions, node shapes, labels, cycles, and parallel edges", () => {
    const parsed = parseMermaidSource(`flowchart LR
  start([Start]) -->|begin| decision{Ready?}
  decision -.->|retry| start
  decision ==> done((Done))
  decision --- archive[[Archive]]`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map(({ id, shape }) => [id, shape])).toEqual([
      ["start", "stadium"],
      ["decision", "diamond"],
      ["done", "circle"],
      ["archive", "subroutine"],
    ]);
    expect(
      parsed.edges.map(({ from, to, label, style }) => [
        from,
        to,
        label,
        style,
      ]),
    ).toEqual([
      ["start", "decision", "begin", "solid"],
      ["decision", "start", "retry", "dotted"],
      ["decision", "done", undefined, "thick"],
      ["decision", "archive", undefined, "solid"],
    ]);
  });

  it("parses Mermaid's inline text-label edge forms", () => {
    const parsed = parseMermaidSource(`flowchart LR
  a[Alpha] -- ships --> b[Beta]
  b -- keeps --- c[Gamma]
  c -- circles --o d[Delta]
  d -- crosses --x e[Epsilon]
  a == fast ==> e
  b -. slow .-> d`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      parsed.edges.map(({ from, to, label, style }) => [
        from,
        to,
        label,
        style,
      ]),
    ).toEqual([
      ["a", "b", "ships", "solid"],
      ["b", "c", "keeps", "solid"],
      ["c", "d", "circles", "open"],
      ["d", "e", "crosses", "cross"],
      ["a", "e", "fast", "thick"],
      ["b", "d", "slow", "dotted"],
    ]);
  });

  it("parses spaceless edge operators without swallowing them into node ids", () => {
    const parsed = parseMermaidSource(`flowchart LR
  a[Alpha]-->b[Beta]
  b-.->c[Gamma]
  c===d[Delta]
  a---d`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(
      parsed.edges.map(({ from, to, style }) => [from, to, style]),
    ).toEqual([
      ["a", "b", "solid"],
      ["b", "c", "dotted"],
      ["c", "d", "thick"],
      ["a", "d", "solid"],
    ]);
    const hyphen = parseMermaidSource("flowchart LR\n  a-b-->c_d[Target]");
    expect(hyphen.diagnostics).toEqual([]);
    expect(hyphen.nodes.map(({ id }) => id)).toEqual(["a-b", "c_d"]);
    const arrow = parseMermaidSource("flowchart LR\n  a->b");
    expect(arrow.diagnostics.map(({ message }) => message)).toEqual([
      "Expected a supported edge operator such as -->, -.->, or ==>",
    ]);
  });

  it("rejects HTML in edge labels for both label forms", () => {
    const pipe = parseMermaidSource("flowchart LR\n  x[X] -->|<b>hi</b>| y[Y]");
    expect(pipe.diagnostics.map(({ message }) => message)).toEqual([
      "HTML labels are disabled; use plain text in the edge label",
    ]);
    const text = parseMermaidSource(
      "flowchart LR\n  x[X] -- <b>hi</b> --> y[Y]",
    );
    expect(text.diagnostics.map(({ message }) => message)).toEqual([
      "HTML labels are disabled; use plain text in the edge label",
    ]);
  });

  it("rejects bare dash links and malformed dotted operators", () => {
    const bare = parseMermaidSource("flowchart LR\n  a[Alpha] -- b[Beta]");
    expect(bare.diagnostics.map(({ message }) => message)).toEqual([
      "Expected a supported edge operator such as -->, -.->, or ==>",
    ]);
    const dotted = parseMermaidSource("flowchart LR\n  a[Alpha] -.--> b[Beta]");
    expect(dotted.diagnostics.map(({ message }) => message)).toEqual([
      "Expected a supported edge operator such as -->, -.->, or ==>",
    ]);
  });

  it("distinguishes parallelogram and trapezoid shapes by their closing token", () => {
    const parsed = parseMermaidSource(`flowchart TD
  lean[/Lean right/] --> trap[/Trapezoid\\]
  alt[\\Lean left\\] --> alttrap[\\Trapezoid alt/]`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map(({ id, shape }) => [id, shape])).toEqual([
      ["lean", "parallelogram"],
      ["trap", "trapezoid"],
      ["alt", "parallelogram"],
      ["alttrap", "trapezoid"],
    ]);
  });

  it("accepts static Mermaid types and rejects unsupported types", () => {
    const parsed = parseMermaidSource(`sequenceDiagram
  Alice->>Bob: Hello`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.interactive).toBe(false);
    expect(parsed.type).toBe("sequenceDiagram");
    const stateV2 = parseMermaidSource(`stateDiagram-v2
  [*] --> Ready`);
    expect(stateV2.diagnostics).toEqual([]);
    expect(stateV2.interactive).toBe(false);
    expect(stateV2.type).toBe("stateDiagram-v2");
    const unsupported = parseMermaidSource("zenuml\n Alice->Bob: Hello");
    expect(unsupported.diagnostics.map(({ message }) => message)).toEqual([
      "Unsupported Mermaid diagram type; use flowchart, graph, sequenceDiagram, classDiagram, stateDiagram, stateDiagram-v2, erDiagram, gantt, journey, pie, mindmap, timeline, or gitGraph",
    ]);
    const subgraph = parseMermaidSource(`flowchart LR
  subgraph forbidden
  end`);
    expect(subgraph.diagnostics.map(({ message }) => message)).toEqual([
      "Subgraphs are not supported in MermaidDiagram v1; use explicit nodes and edges instead",
      "Subgraphs are not supported in MermaidDiagram v1; use explicit nodes and edges instead",
    ]);
  });

  it("allows implicit nodes to receive later explicit declarations", () => {
    const parsed = parseMermaidSource(`flowchart LR
  source --> result
  result[Result]`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes).toEqual([
      expect.objectContaining({
        id: "source",
        label: "source",
        declared: false,
      }),
      expect.objectContaining({
        id: "result",
        label: "Result",
        declared: true,
      }),
    ]);
  });

  it("rejects reserved ids and preserves escaped label text", () => {
    const reserved = parseMermaidSource(
      "flowchart LR\n  start[Start] --> graph-node[Done]",
    );
    expect(reserved.diagnostics.map(({ message }) => message)).toEqual([
      'Node id "graph-node" is reserved by Mermaid; choose another id',
    ]);
    const parsed = parseMermaidSource(String.raw`flowchart LR
  source["C:\\plans"] -->|keeps \] literal| target[Target]`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.nodes.map(({ label }) => label)).toEqual([
      String.raw`C:\\plans`,
      "Target",
    ]);
    expect(parsed.edges.map(({ label }) => label)).toEqual([
      String.raw`keeps \] literal`,
    ]);
  });

  it("rejects directives and HTML labels", () => {
    const parsed = parseMermaidSource(`flowchart TD
  %%{init: { 'theme': 'dark' }}%%
  A[<b>Unsafe</b>] --> B[Safe]`);
    expect(parsed.diagnostics.map(({ message }) => message)).toEqual([
      "Mermaid comments and directives are not supported in v1; remove the %% line",
      "HTML labels are disabled; use plain text inside the node shape",
    ]);
  });

  it("rejects static configuration, styling, interactions, and HTML labels", () => {
    const sequence = parseMermaidSource(`sequenceDiagram
  link Alice: Dashboard @ https://example.com
  links Alice: {"Dashboard": "https://example.com"}
  properties Alice: {"role": "reviewer"}
  details Alice: {"team": "plans"}
  participant Alice@{ "type": "actor" }
  Alice->>Bob: <b>Review</b>`);
    expect(sequence.diagnostics).toEqual([
      {
        line: 2,
        message:
          "Mermaid interaction and metadata statements are not supported in v1; keep the static diagram source declarative",
      },
      {
        line: 3,
        message:
          "Mermaid interaction and metadata statements are not supported in v1; keep the static diagram source declarative",
      },
      {
        line: 4,
        message:
          "Mermaid interaction and metadata statements are not supported in v1; keep the static diagram source declarative",
      },
      {
        line: 5,
        message:
          "Mermaid interaction and metadata statements are not supported in v1; keep the static diagram source declarative",
      },
      {
        line: 6,
        message:
          "Mermaid configuration blocks are not supported in v1; use the diagram type's plain declarative syntax",
      },
      {
        line: 7,
        message:
          "HTML labels are disabled; use plain text in the static diagram",
      },
    ]);

    const styled = parseMermaidSource(`classDiagram
  class Plan {
    +compile()
  }
  classDef danger fill:red
  style Plan fill:red
  class Plan danger
  cssClass "Plan" danger`);
    expect(styled.diagnostics).toEqual(
      [5, 6, 7, 8].map((line) => ({
        line,
        message:
          "Mermaid style and class-assignment statements are not supported in v1; use the default diagram theme",
      })),
    );

    const sequenceStyle = parseMermaidSource(`sequenceDiagram
  participant Reviewer
  rect rgb(230, 240, 255)
    Reviewer->>Compiler: Review
  end
  box Aqua Review group
    participant Compiler
  end`);
    expect(sequenceStyle.diagnostics).toEqual(
      [3, 6].map((line) => ({
        line,
        message:
          "Mermaid style and class-assignment statements are not supported in v1; use the default diagram theme",
      })),
    );

    const ganttStyle = parseMermaidSource(`gantt
  dateFormat YYYY-MM-DD
  todayMarker stroke-width:5px,stroke:#0f0
  section Delivery
  Ship :2026-08-07, 1d`);
    expect(ganttStyle.diagnostics).toEqual([
      {
        line: 3,
        message:
          "Mermaid style and class-assignment statements are not supported in v1; use the default diagram theme",
      },
    ]);

    const styledHeader = parseMermaidSource("pie title <b>Unsafe</b>");
    expect(styledHeader.diagnostics).toEqual([
      {
        line: 1,
        message:
          "HTML labels are disabled; use plain text in the static diagram",
      },
    ]);
  });
});
