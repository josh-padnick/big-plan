// Tests FlowDiagram's staged-diagram contract: the v1 shape validation - single-node
// stages flowing left to right into an optional last-stage fan-out - plus the
// card, connector, fork, badge, and footer markup the view places on the
// grid.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../_authoring/contract.js";
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
): ScopedChild => ({
  name: "Stage",
  attributes: { title },
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
});
