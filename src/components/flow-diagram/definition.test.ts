// Tests FlowDiagram's staged-diagram contract: the v1 shape validation - single-node
// stages flowing left to right into an optional last-stage fan-out - plus the
// card, connector, fork, badge, and footer markup the view places on the
// grid.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import {
  createComponentIdAllocator,
  type ComponentIdAllocator,
  type ScopedChild,
} from "../_authoring/contract.js";
import { compileFlowDiagramComponent } from "./compile.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { FLOW_DIAGRAM_COMPONENT_DEFINITION } from "./definition.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 3, column: 1, offset: 20 },
  end: { line: 20, column: 8, offset: 400 },
};

const CHILD_POSITION = {
  start: { line: 5, column: 1, offset: 40 },
  end: { line: 8, column: 9, offset: 120 },
};

const paragraph = (text: string): ElementContent => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value: text }],
});

const node = (
  attributes: Readonly<Record<string, string | boolean>>,
  children: ReadonlyArray<ElementContent> = [],
): ScopedChild => ({
  name: "Node",
  attributes,
  children,
  position: CHILD_POSITION,
});

const stage = (
  title: string,
  nodes: ReadonlyArray<ScopedChild>,
  id?: string,
): ScopedChild => ({
  name: "Stage",
  attributes: id === undefined ? { title } : { id, title },
  children: [],
  scopedChildren: nodes,
  position: CHILD_POSITION,
});

const edge = (
  attributes: Readonly<Record<string, string | boolean>>,
): ScopedChild => ({
  name: "Edge",
  attributes,
  children: [],
  position: CHILD_POSITION,
});

const render = ({
  scopedChildren = [],
  children = [],
}: {
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly children?: ReadonlyArray<ElementContent>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    FLOW_DIAGRAM_COMPONENT_DEFINITION.compile({
      attributes: {},
      children,
      scopedChildren,
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

// The compiled model on its own, for the identity contract the machine-readable
// output carries and the view only reflects.
const compile = ({
  scopedChildren = [],
  children = [],
  ids,
}: {
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly ids?: ComponentIdAllocator;
}) => {
  const diagnostics = createDiagnosticCollector();
  const model = compileFlowDiagramComponent({
    attributes: {},
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
    ...(ids === undefined ? {} : { ids }),
  });
  return { model, diagnostics: diagnostics.diagnostics };
};

// The two-stage dependency diagram: prerequisite unblocks this plan.
const dependencyChildren = (): ReadonlyArray<ScopedChild> => [
  stage("Prerequisite", [
    node({ id: "pr", label: "Readability PR #33", badge: "Open" }, [
      paragraph("Adds the guidance command"),
    ]),
  ]),
  stage("This plan", [
    node({ id: "skill", label: "Skill PR", tone: "source" }),
  ]),
  edge({ from: "pr", to: "skill", label: "unblocks" }),
];

// The three-stage pipeline with a fan-out into three destinations.
const pipelineChildren = (): ReadonlyArray<ScopedChild> => [
  stage("Source of truth", [
    node({
      id: "authored",
      label: "Author once",
      code: "assets/skill/SKILL.md",
      tone: "source",
    }),
  ]),
  stage("Generate", [
    node({ id: "gen", label: "Generate", code: "scripts/gen-skill.mjs" }),
  ]),
  stage("Available through", [
    node({
      id: "cli",
      label: "CLI",
      code: "big-plan skill",
      tone: "destination",
    }),
    node({ id: "docs", label: "Docs", tone: "destination" }),
    node({ id: "setup", label: "Setup", tone: "destination" }),
  ]),
  edge({ from: "authored", to: "gen", label: "feeds" }),
  edge({ from: "gen", to: "cli" }),
  edge({ from: "gen", to: "docs" }),
  edge({ from: "gen", to: "setup" }),
];

describe("FLOW_DIAGRAM_COMPONENT_DEFINITION", () => {
  it("should report a FlowDiagram with fewer than two stages", () => {
    const { diagnostics } = render({
      scopedChildren: [stage("Only", [node({ id: "a", label: "A" })])],
    });
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "FlowDiagram needs at least two Stage columns to relate",
      },
    ]);
  });

  it("should report an empty Stage at the stage's position", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("Empty", []),
        stage("Full", [node({ id: "a", label: "A" })]),
        edge({ from: "a", to: "a" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message: "Stage needs at least one Node",
    });
  });

  it("should report a duplicate node id once per collision", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [node({ id: "a", label: "A" })]),
        stage("Two", [node({ id: "a", label: "B" })]),
        edge({ from: "a", to: "a" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Duplicate node id "a"',
    });
  });

  it("should report an edge referencing an unknown node id", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [node({ id: "a", label: "A" })]),
        stage("Two", [node({ id: "b", label: "B" })]),
        edge({ from: "a", to: "missing" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message: 'Edge references unknown node id "missing"',
    });
  });

  it("should report an edge that skips a stage or points backward", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [node({ id: "a", label: "A" })]),
        stage("Two", [node({ id: "b", label: "B" })]),
        stage("Three", [node({ id: "c", label: "C" })]),
        edge({ from: "a", to: "c" }),
        edge({ from: "a", to: "b" }),
        edge({ from: "b", to: "c" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message:
        "An Edge connects a node to a node in the next stage; flows read left to right",
    });
  });

  it("should report a fan-out anywhere but the last stage", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [
          node({ id: "a", label: "A" }),
          node({ id: "b", label: "B" }),
        ]),
        stage("Two", [node({ id: "c", label: "C" })]),
        edge({ from: "a", to: "c" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: "Only the last stage may hold more than one Node",
    });
  });

  it("should require exactly one incoming edge per downstream node", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [node({ id: "a", label: "A" })]),
        stage("Two", [
          node({ id: "b", label: "B" }),
          node({ id: "c", label: "C" }),
        ]),
        edge({ from: "a", to: "b" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Node "c" needs exactly one incoming edge, found 0',
    });
  });

  it("should report a badgeTone that has no badge to tint", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [node({ id: "a", label: "A", badgeTone: "warning" })]),
        stage("Two", [node({ id: "b", label: "B" })]),
        edge({ from: "a", to: "b" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message: 'Attribute "badgeTone" needs a "badge" to tint',
    });
  });

  it("should reject a Node body that is more than one paragraph", () => {
    const { diagnostics } = render({
      scopedChildren: [
        stage("One", [
          node({ id: "a", label: "A" }, [paragraph("one"), paragraph("two")]),
        ]),
        stage("Two", [node({ id: "b", label: "B" })]),
        edge({ from: "a", to: "b" }),
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message: "A Node body is one short paragraph",
    });
  });

  it("should reject loose FlowDiagram content that is not a footer paragraph", () => {
    const { diagnostics } = render({
      scopedChildren: dependencyChildren(),
      children: [
        {
          type: "element",
          tagName: "ul",
          properties: {},
          children: [],
        },
      ],
    });
    expect(diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: "The FlowDiagram footer is one short paragraph",
    });
  });

  it("should render the dependency diagram with tones, badge, and edge label", () => {
    const { element, diagnostics } = render({
      scopedChildren: dependencyChildren(),
      children: [paragraph("Until #33 merges, branch the skill PR from it.")],
    });
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-flow-diagram"]).toBe("true");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"data-flow-diagram-tone":"source"');
    expect(rendered).toContain('"data-flow-diagram-badge-tone":"neutral"');
    expect(rendered).toContain('"value":"unblocks"');
    expect(rendered).toContain('"value":"Adds the guidance command"');
    expect(rendered).toContain('"data-flow-diagram-footer":"true"');
    expect(rendered).toContain(
      '"value":"Until #33 merges, branch the skill PR from it."',
    );
    expect(rendered).toContain('"data-flow-diagram-link":"true"');
    expect(rendered).not.toContain("data-flow-diagram-branch");
  });

  it("should render the pipeline fan-out as a fork touching every card", () => {
    const { element, diagnostics } = render({
      scopedChildren: pipelineChildren(),
    });
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Source of truth"');
    expect(rendered).toContain('"value":"assets/skill/SKILL.md"');
    expect(rendered).toContain('"data-flow-diagram-fork-stub":"true"');
    expect(rendered).toContain('"data-flow-diagram-branch":"first"');
    expect(rendered).toContain('"data-flow-diagram-branch":"middle"');
    expect(rendered).toContain('"data-flow-diagram-branch":"last"');
    // The single-node stages span every lane; the fan-out cards take one
    // lane each so the branches meet their centers.
    expect(rendered).toContain("grid-row:2 / span 3");
    expect(rendered).toContain("grid-row:4");
  });

  it("should address every authored element from the figure's own anchor", () => {
    const compiled = compile({
      scopedChildren: dependencyChildren(),
      children: [paragraph("Until #33 merges, branch from it.")],
    });
    expect(compiled.model.anchor).toBe("component/FlowDiagram#1");
    expect(compiled.model.stages.map((stage) => stage.anchor)).toEqual([
      "component/FlowDiagram#1/stage/prerequisite",
      "component/FlowDiagram#1/stage/this-plan",
    ]);
    expect(compiled.model.stages[0]?.nodes[0]?.anchor).toBe(
      "component/FlowDiagram#1/node/pr",
    );
    expect(compiled.model.edges[0]?.anchor).toBe(
      "component/FlowDiagram#1/edge/pr/skill",
    );
    expect(compiled.model.footerAnchor).toBe("component/FlowDiagram#1/footer");
  });

  it("should keep hyphenated edge endpoints as distinct feedback targets", () => {
    const scopedChildren = [
      stage("First", [node({ id: "a", label: "A" })]),
      stage("Second", [node({ id: "b-c", label: "B-C" })]),
      stage("Third", [node({ id: "a-b", label: "A-B" })]),
      stage("Fourth", [node({ id: "c", label: "C" })]),
      edge({ from: "a", to: "b-c" }),
      edge({ from: "b-c", to: "a-b" }),
      edge({ from: "a-b", to: "c" }),
    ];
    const compiled = compile({
      scopedChildren,
      children: [paragraph("The endpoints remain independently addressable.")],
    });
    const anchors = compiled.model.edges.map((item) => item.anchor);

    expect(compiled.diagnostics).toEqual([]);
    expect(anchors).toEqual([
      "component/FlowDiagram#1/edge/a/b-c",
      "component/FlowDiagram#1/edge/b-c/a-b",
      "component/FlowDiagram#1/edge/a-b/c",
    ]);
    expect(new Set(anchors).size).toBe(3);
    expect(compiled.model.anchor).toBe("component/FlowDiagram#1");
    expect(compiled.model.stages[0]?.anchor).toBe(
      "component/FlowDiagram#1/stage/first",
    );
    expect(compiled.model.stages[0]?.nodes[0]?.anchor).toBe(
      "component/FlowDiagram#1/node/a",
    );
    expect(compiled.model.footerAnchor).toBe("component/FlowDiagram#1/footer");

    const rendered = render({ scopedChildren });
    expect(rendered.diagnostics).toEqual([]);
    const markup = JSON.stringify(rendered.element);
    for (const anchor of anchors) {
      expect(markup).toContain(`"data-flow-anchor":"${anchor}"`);
    }
  });

  it("should encode authored ids as opaque anchor path segments", () => {
    const compiled = compile({
      scopedChildren: [
        stage(
          "First",
          [node({ id: "source/50%", label: "Source" })],
          "phase/one",
        ),
        stage("Second", [node({ id: "result?", label: "Result" })]),
        edge({ from: "source/50%", to: "result?" }),
      ],
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.model.stages[0]?.anchor).toBe(
      "component/FlowDiagram#1/stage/phase%2Fone",
    );
    expect(compiled.model.stages[0]?.nodes[0]?.anchor).toBe(
      "component/FlowDiagram#1/node/source%2F50%25",
    );
    expect(compiled.model.edges[0]?.anchor).toBe(
      "component/FlowDiagram#1/edge/source%2F50%25/result%3F",
    );
  });

  it("should keep a stage's anchor when its title changes but its id does not", () => {
    const named = (title: string) =>
      compile({
        scopedChildren: [
          stage(title, [node({ id: "pr", label: "Prerequisite PR" })], "gate"),
          stage("This plan", [node({ id: "skill", label: "Skill PR" })]),
          edge({ from: "pr", to: "skill" }),
        ],
      }).model.stages[0]?.anchor;
    expect(named("Prerequisite")).toBe("component/FlowDiagram#1/stage/gate");
    expect(named("Blocked on")).toBe("component/FlowDiagram#1/stage/gate");
  });

  it("should disambiguate two stages whose titles slug alike", () => {
    const compiled = compile({
      scopedChildren: [
        stage("Review!", [node({ id: "a", label: "A" })]),
        stage("Review", [node({ id: "b", label: "B" })]),
        edge({ from: "a", to: "b" }),
      ],
    });
    expect(compiled.model.stages.map((stage) => stage.id)).toEqual([
      "review",
      "review-2",
    ]);
  });

  it("should reserve an authored stage id before allocating title slugs", () => {
    const compiled = compile({
      scopedChildren: [
        stage("Review!", [node({ id: "a", label: "A" })]),
        stage("Second pass", [node({ id: "b", label: "B" })], "review"),
        edge({ from: "a", to: "b" }),
      ],
    });

    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.model.stages.map((item) => item.id)).toEqual([
      "review-2",
      "review",
    ]);
  });

  it("should report duplicate authored stage ids", () => {
    const compiled = compile({
      scopedChildren: [
        stage("First", [node({ id: "a", label: "A" })], "review"),
        stage("Second", [node({ id: "b", label: "B" })], "review"),
        edge({ from: "a", to: "b" }),
      ],
    });

    expect(compiled.diagnostics).toContainEqual({
      line: 5,
      column: 1,
      message: 'Duplicate stage id "review"',
    });
    expect(compiled.model.stages.map((item) => item.id)).toEqual([
      "review",
      "review-2",
    ]);
  });

  it("should emit the diagram in flow order with named elements", () => {
    const { element, diagnostics } = render({
      scopedChildren: pipelineChildren(),
    });
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    // Stage, then its nodes, then the edges leaving it: the order a screen
    // reader follows and the order the picture already draws.
    const order = ["Source of truth", "Author once", "feeds", "Generate"];
    let cursor = -1;
    for (const value of order) {
      const next = rendered.indexOf('"value":"' + value + '"', cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(rendered).toContain(
      '"ariaLabel":"Author once, node in stage Source of truth, assets/skill/SKILL.md"',
    );
    expect(rendered).toContain('"ariaLabel":"Source of truth, stage 1 of 3"');
    expect(rendered).toContain(
      '"ariaLabel":"feeds, from Author once to Generate"',
    );
    // Drawn scenery stays out of the accessible output.
    expect(rendered).toContain('"data-flow-diagram-fork-stub":"true"');
    expect(rendered).toContain('"ariaHidden":"true"');
  });

  it("should number diagrams by their position in one document", () => {
    const ids = createComponentIdAllocator();
    const first = compile({ scopedChildren: dependencyChildren(), ids });
    const second = compile({ scopedChildren: dependencyChildren(), ids });
    expect(first.model.anchor).toBe("component/FlowDiagram#1");
    expect(second.model.anchor).toBe("component/FlowDiagram#2");
  });
});
