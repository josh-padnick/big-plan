// Implements the envelope-fit authoring rule: a wireframe is drawn into a
// figure slot whose width is fixed, so a screen that asks for more columns than
// the slot can hold does not get a wider figure - it gets narrower columns.
//
// The rule exists because the alternative is invisible while authoring. A
// five-column desktop screen compiles, renders, and looks structurally correct
// in source; the damage only appears once the drawing is scaled into the review
// column, where each column has become too narrow to read and the reviewer
// concludes the plan is unreadable rather than that the screen was overloaded.
// Counting columns in the authored source is the earliest place that judgement
// can be made.

import type { Node, Parent, Position } from "unist";
import { isNamedFlowElement, isParent, stringAttribute } from "../mdx-nodes.js";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// The elements that take a share of a Row's width. Controls and copy inside a
// row wrap and reflow; these lay out as columns, so these are what a column
// budget counts.
const COLUMN_ELEMENTS: ReadonlySet<string> = new Set([
  "Panel",
  "Stack",
  "Row",
  "Center",
  "Rail",
  "List",
  "Table",
]);

/**
 * How many columns one row of each device's envelope can hold and still leave
 * every column readable.
 *
 * Desktop's three are the shape every desktop product with a collection, a work
 * surface, and an inspector already uses; a fourth column takes the width out
 * of the primary surface, which is the one that had to stay dominant. A phone
 * is one column by definition, and side-by-side columns on a handset is the
 * "vertical iPad" mistake rather than a density trade-off.
 */
const COLUMN_BUDGETS: Readonly<Record<string, number>> = {
  desktop: 3,
  tablet: 3,
  "tablet-portrait": 2,
  phone: 1,
};

const isColumnElement = (node: Node): boolean => {
  for (const name of COLUMN_ELEMENTS) {
    if (isNamedFlowElement(node, name)) {
      return true;
    }
  }
  return false;
};

// A Group is a run of loose controls that travels together as one item, and
// compilation refuses one that holds a pane or a collection, so a Group never
// contributes a column and is not looked through here.
const columnChildren = (node: Parent): ReadonlyArray<Node> =>
  node.children.filter(isColumnElement);

const checkScreen = ({
  screen,
  findings,
}: {
  readonly screen: Parent;
  readonly findings: Array<PlanLintFinding>;
}): void => {
  const device = stringAttribute({ node: screen, name: "device" }) ?? "desktop";
  const budget = COLUMN_BUDGETS[device];
  if (budget === undefined) {
    return;
  }
  const visit = (node: Node): void => {
    if (isNamedFlowElement(node, "Row")) {
      const columns = columnChildren(node);
      const position: Position | undefined = node.position;
      if (columns.length > budget && position !== undefined) {
        findings.push({
          line: position.start.line,
          column: position.start.column,
          message: `This Row lays out ${columns.length} columns on a ${device} screen, which the ${device} envelope cannot hold at a readable width; the figure never widens, so give the screen ${budget} columns or fewer and move the rest to another screen, a Rail, or progressive disclosure`,
        });
      }
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const child of screen.children) {
    visit(child);
  }
};

const checkWireframeEnvelopeFit = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const findings: Array<PlanLintFinding> = [];
  const visit = (node: Node): void => {
    if (isNamedFlowElement(node, "Screen")) {
      checkScreen({ screen: node, findings });
      return;
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(tree);
  return findings;
};

export const wireframeEnvelopeFitRule: PlanLintRule = {
  id: "wireframe-envelope-fit",
  check: checkWireframeEnvelopeFit,
};
