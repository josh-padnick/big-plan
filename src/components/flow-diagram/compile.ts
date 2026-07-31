// Compiles FlowDiagram's authored form into its plan model: staged columns of
// content-sized nodes joined by verb-labeled, directed edges, with an
// optional footer line. Validation owns the v1 layout contract - single-node
// stages flowing left to right into an optional fan-out in the last stage -
// so the view can place every card and connector without measurement.

import type { Element, ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import {
  flowEdgeAnchor,
  flowFigureAnchor,
  flowFooterAnchor,
  flowNodeAnchor,
  flowStageAnchor,
  resolveStageIds,
} from "./anchors.js";

export type FlowDiagramTone = "source" | "neutral" | "destination";

const FLOW_DIAGRAM_TONES: ReadonlyArray<FlowDiagramTone> = [
  "source",
  "neutral",
  "destination",
];

export type FlowDiagramBadgeTone = "neutral" | "warning";

const BADGE_TONES: ReadonlyArray<FlowDiagramBadgeTone> = ["neutral", "warning"];

export type CompiledFlowDiagramNode = {
  readonly id: string;
  // The element's address, formed by ./anchors.ts and spent by the compiled
  // model, the rendered attributes, and the feedback package alike.
  readonly anchor: string;
  readonly label: string;
  readonly tone: FlowDiagramTone;
  // A technical identifier line (a path, command, or PR number) rendered in
  // monospace under the label; explanatory prose belongs in the body.
  readonly code?: string;
  // A short state or status pill beside the label, such as "Open - must
  // merge first"; state never fuses into the label itself.
  readonly badge?: string;
  readonly badgeTone: FlowDiagramBadgeTone;
  // The relationship explained at the point of connection: the inline
  // content of the node's one authored paragraph.
  readonly body: ReadonlyArray<ElementContent>;
};

export type CompiledFlowDiagramStage = {
  // The authored id when given, otherwise the slugged title; an id keeps the
  // stage's address stable across a reworded heading.
  readonly id: string;
  readonly anchor: string;
  readonly title: string;
  readonly nodes: ReadonlyArray<CompiledFlowDiagramNode>;
};

export type CompiledFlowDiagramEdge = {
  readonly anchor: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
};

export type CompiledFlowDiagram = {
  // The figure's own address; every element anchor inside extends it.
  readonly anchor: string;
  readonly stages: ReadonlyArray<CompiledFlowDiagramStage>;
  readonly edges: ReadonlyArray<CompiledFlowDiagramEdge>;
  // Inline content of the optional footer paragraph authored directly in the
  // FlowDiagram body: the takeaway or the conditional the diagram cannot draw.
  readonly footer?: ReadonlyArray<ElementContent>;
  readonly footerAnchor?: string;
};

const STAGE_SCHEMA = {
  id: { kind: "string", nonEmpty: true },
  title: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const NODE_SCHEMA = {
  id: { kind: "string", required: true, nonEmpty: true },
  label: { kind: "string", required: true, nonEmpty: true },
  code: { kind: "string" },
  badge: { kind: "string" },
  badgeTone: { kind: "enum", values: BADGE_TONES },
  tone: { kind: "enum", values: FLOW_DIAGRAM_TONES },
} satisfies ComponentAttributeSchema;

const EDGE_SCHEMA = {
  from: { kind: "string", required: true, nonEmpty: true },
  to: { kind: "string", required: true, nonEmpty: true },
  label: { kind: "string" },
} satisfies ComponentAttributeSchema;

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

// Reads an authored body that must be at most one paragraph, returning the
// paragraph's inline children so views can place them inside a line.
const singleParagraphContent = ({
  children,
  owner,
  position,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ElementContent>;
  readonly owner: string;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ElementContent> => {
  const meaningful = meaningfulChildren(children);
  if (meaningful.length === 0) {
    return [];
  }
  const [first] = meaningful;
  if (
    meaningful.length > 1 ||
    first === undefined ||
    !isElement(first) ||
    first.tagName !== "p"
  ) {
    diagnostics.add({ message: `${owner} is one short paragraph`, position });
    return [];
  }
  return first.children;
};

// Validates one Node into a card model; every violation reports at the
// node's own position.
const compileNode = ({
  child,
  figure,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly figure: string;
  readonly diagnostics: DiagnosticCollector;
}): CompiledFlowDiagramNode | undefined => {
  const validated = validateComponentAttributes({
    component: "Node",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: NODE_SCHEMA,
  });
  if (validated.badge === undefined && validated.badgeTone !== undefined) {
    diagnostics.add({
      message: 'Attribute "badgeTone" needs a "badge" to tint',
      position: child.position,
    });
  }
  const body = singleParagraphContent({
    children: child.children,
    owner: "A Node body",
    position: child.position,
    diagnostics,
  });
  if (validated.id === undefined || validated.label === undefined) {
    return undefined;
  }
  return {
    id: validated.id,
    anchor: flowNodeAnchor({ figure, nodeId: validated.id }),
    label: validated.label,
    tone: validated.tone ?? "neutral",
    ...(validated.code === undefined ? {} : { code: validated.code }),
    ...(validated.badge === undefined ? {} : { badge: validated.badge }),
    badgeTone: validated.badgeTone ?? "neutral",
    body,
  };
};

// A stage before the diagram knows every stage's title: its own address
// depends on whether a sibling slugs the same way, which only the whole
// diagram can answer.
type StageDraft = {
  readonly authoredId?: string;
  readonly title: string;
  readonly nodes: ReadonlyArray<CompiledFlowDiagramNode>;
};

// Validates one Stage and its Node children into a column model.
const compileStage = ({
  child,
  figure,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly figure: string;
  readonly diagnostics: DiagnosticCollector;
}): StageDraft => {
  const validated = validateComponentAttributes({
    component: "Stage",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: STAGE_SCHEMA,
  });
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message: "Stage holds only Node cards; prose belongs in a Node body",
      position: child.position,
    });
  }
  const scoped = child.scopedChildren ?? [];
  if (scoped.length === 0) {
    diagnostics.add({
      message: "Stage needs at least one Node",
      position: child.position,
    });
  }
  return {
    ...(validated.id === undefined ? {} : { authoredId: validated.id }),
    title: validated.title ?? "",
    nodes: scoped.flatMap((node) => {
      const compiled = compileNode({ child: node, figure, diagnostics });
      return compiled === undefined ? [] : [compiled];
    }),
  };
};

// Validates one Edge's attributes; reference and direction checks need the
// whole diagram, so they run after all stages compile.
const compileEdge = ({
  child,
  figure,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly figure: string;
  readonly diagnostics: DiagnosticCollector;
}): CompiledFlowDiagramEdge | undefined => {
  const validated = validateComponentAttributes({
    component: "Edge",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: EDGE_SCHEMA,
  });
  if (meaningfulChildren(child.children).length > 0) {
    diagnostics.add({
      message:
        'Edge is self-closing; write <Edge from="..." to="..." /> with no body content',
      position: child.position,
    });
  }
  if (validated.from === undefined || validated.to === undefined) {
    return undefined;
  }
  return {
    anchor: flowEdgeAnchor({
      figure,
      from: validated.from,
      to: validated.to,
    }),
    from: validated.from,
    to: validated.to,
    ...(validated.label === undefined ? {} : { label: validated.label }),
  };
};

// Enforces the v1 layout contract on the whole diagram, so every accepted
// FlowDiagram can be drawn exactly: earlier stages hold one node each, only the
// last stage may fan out, and its fan-in covers each node exactly once.
const validateShape = ({
  stages,
  edges,
  edgeChildren,
  position,
  diagnostics,
}: {
  readonly stages: ReadonlyArray<CompiledFlowDiagramStage>;
  readonly edges: ReadonlyArray<CompiledFlowDiagramEdge>;
  readonly edgeChildren: ReadonlyArray<ScopedChild>;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const stageOf = new Map<string, number>();
  stages.forEach((stage, index) => {
    for (const node of stage.nodes) {
      if (stageOf.has(node.id)) {
        diagnostics.add({
          message: `Duplicate node id "${node.id}"`,
          position,
        });
      }
      stageOf.set(node.id, index);
    }
  });
  stages.forEach((stage, index) => {
    if (index < stages.length - 1 && stage.nodes.length > 1) {
      diagnostics.add({
        message: "Only the last stage may hold more than one Node",
        position,
      });
    }
  });
  const seenPairs = new Set<string>();
  const targeted = new Map<string, number>();
  edges.forEach((edge, index) => {
    const edgePosition = edgeChildren[index]?.position ?? position;
    for (const id of [edge.from, edge.to]) {
      if (!stageOf.has(id)) {
        diagnostics.add({
          message: `Edge references unknown node id "${id}"`,
          position: edgePosition,
        });
      }
    }
    const fromStage = stageOf.get(edge.from);
    const toStage = stageOf.get(edge.to);
    if (
      fromStage !== undefined &&
      toStage !== undefined &&
      toStage !== fromStage + 1
    ) {
      diagnostics.add({
        message:
          "An Edge connects a node to a node in the next stage; flows read left to right",
        position: edgePosition,
      });
    }
    const pair = `${edge.from} ${edge.to}`;
    if (seenPairs.has(pair)) {
      diagnostics.add({
        message: `Duplicate edge from "${edge.from}" to "${edge.to}"`,
        position: edgePosition,
      });
    }
    seenPairs.add(pair);
    targeted.set(edge.to, (targeted.get(edge.to) ?? 0) + 1);
  });
  stages.forEach((stage, index) => {
    if (index === 0) {
      return;
    }
    for (const node of stage.nodes) {
      const count = targeted.get(node.id) ?? 0;
      if (count !== 1) {
        diagnostics.add({
          message: `Node "${node.id}" needs exactly one incoming edge, found ${count}`,
          position,
        });
      }
    }
  });
};

/** Compiles one FlowDiagram component into the model consumed by rendering. */
export const compileFlowDiagramComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids,
}: ComponentCompilerInput): CompiledFlowDiagram => {
  validateComponentAttributes({
    component: "FlowDiagram",
    attributes,
    position,
    diagnostics,
    schema: {},
  });
  const stageChildren = scopedChildren.filter(
    (child) => child.name === "Stage",
  );
  const edgeChildren = scopedChildren.filter((child) => child.name === "Edge");
  if (stageChildren.length < 2) {
    diagnostics.add({
      message: "FlowDiagram needs at least two Stage columns to relate",
      position,
    });
  }
  // The figure's ordinal among the document's diagrams is what its address is
  // made of; a compile with no document around it is the first diagram.
  const figure = flowFigureAnchor({
    ordinal: ids?.nextOrdinal({ component: "FlowDiagram" }) ?? 1,
  });
  const drafts = stageChildren.map((child) =>
    compileStage({ child, figure, diagnostics }),
  );
  const stageIds = resolveStageIds(
    drafts.map((draft) => ({
      ...(draft.authoredId === undefined ? {} : { id: draft.authoredId }),
      title: draft.title,
    })),
  );
  const stages = drafts.map((draft, index) => {
    const id = stageIds[index] ?? `stage-${index + 1}`;
    return {
      id,
      anchor: flowStageAnchor({ figure, stageId: id }),
      title: draft.title,
      nodes: draft.nodes,
    };
  });
  const edges = edgeChildren.flatMap((child) => {
    const edge = compileEdge({ child, figure, diagnostics });
    return edge === undefined ? [] : [edge];
  });
  if (stageChildren.length >= 2 && edges.length === edgeChildren.length) {
    validateShape({ stages, edges, edgeChildren, position, diagnostics });
  }
  const footer = singleParagraphContent({
    children,
    owner: "The FlowDiagram footer",
    position,
    diagnostics,
  });
  return {
    anchor: figure,
    stages,
    edges,
    ...(footer.length === 0
      ? {}
      : { footer, footerAnchor: flowFooterAnchor({ figure }) }),
  };
};
