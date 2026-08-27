// Declares FlowDiagram's component integration contract and its Stage, Node, and
// Edge child grammar; rendering lives in the React component library.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { compileFlowDiagramComponent } from "./compile.js";
import { FlowDiagram } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { flowDiagramMarkdown } from "./markdown.js";

// A node body is the one-line relationship explanation; anything with
// structure belongs in the surrounding slide, not inside a card.
const node: ScopedChildDefinition = {
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: "A Node body is one short paragraph and cannot contain headings",
      footnoteReference:
        "A Node body is one short paragraph and cannot contain footnote references",
      footnoteDefinition:
        "A Node body is one short paragraph and cannot contain footnote definitions",
      registeredComponent:
        "A Node body is one short paragraph and cannot contain typed components",
    },
  },
};

const stage: ScopedChildDefinition = {
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: "Stage holds only Node cards and cannot contain headings",
      footnoteReference:
        "Stage holds only Node cards and cannot contain footnote references",
      footnoteDefinition:
        "Stage holds only Node cards and cannot contain footnote definitions",
      registeredComponent:
        "Stage holds only Node cards and cannot contain typed components",
    },
  },
  scopedChildren: { Node: node },
};

// Edges are self-closing attribute carriers; their bodies allow nothing.
const edge: ScopedChildDefinition = {
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: "Edge is self-closing and cannot contain headings",
      footnoteReference:
        "Edge is self-closing and cannot contain footnote references",
      footnoteDefinition:
        "Edge is self-closing and cannot contain footnote definitions",
      registeredComponent:
        "Edge is self-closing and cannot contain typed components",
    },
  },
};

/** Declares FlowDiagram's renderer and Stage, Node, and Edge child contract blocks. */
export const FLOW_DIAGRAM_COMPONENT_DEFINITION = defineComponent({
  compile: compileFlowDiagramComponent,
  view: FlowDiagram,
  markdown: flowDiagramMarkdown,
  scopedChildren: { Stage: stage, Edge: edge },
});
