// Implements the glance-matches-sections authoring rule: when a plan carries
// a Glance, its Item section attributes must repeat the document's h2
// section titles exactly, in order, one to one, so the overview can never
// drift from the sections it promises.

import type { Heading } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNamedFlowElement = (node: Node, name: string): node is Parent =>
  node.type === "mdxJsxFlowElement" &&
  isParent(node) &&
  "name" in node &&
  node.name === name;

// Reads one static string attribute from an authored component node; missing
// and expression-valued attributes read as absent, and structural
// compilation owns rejecting them.
const stringAttribute = ({
  node,
  name,
}: {
  readonly node: Node;
  readonly name: string;
}): string | undefined => {
  if (!("attributes" in node) || !Array.isArray(node.attributes)) {
    return undefined;
  }
  for (const attribute of node.attributes) {
    if (
      isRecord(attribute) &&
      attribute["type"] === "mdxJsxAttribute" &&
      attribute["name"] === name
    ) {
      const value = attribute["value"];
      return typeof value === "string" ? value : undefined;
    }
  }
  return undefined;
};

// A heading's comparable text concatenates its plain-text and inline-code
// children recursively, matching what the rendered section title shows.
const headingText = (node: Node): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return "value" in node && typeof node.value === "string" ? node.value : "";
  }
  if (!isParent(node)) {
    return "";
  }
  return node.children.map(headingText).join("");
};

type GlanceNode = {
  readonly items: ReadonlyArray<string>;
  readonly line: number;
  readonly column: number;
};

const checkGlanceMatchesSections = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  const glances: Array<GlanceNode> = [];
  const sectionTitles: Array<string> = [];

  const visit = (node: Node): void => {
    if (isHeading(node) && node.depth === 2) {
      sectionTitles.push(headingText(node).trim());
    }
    if (isNamedFlowElement(node, "Glance") && node.position !== undefined) {
      glances.push({
        items: node.children
          .filter((child) => isNamedFlowElement(child, "Item"))
          .map((child) => stringAttribute({ node: child, name: "section" }))
          .filter((section): section is string => section !== undefined),
        line: node.position.start.line,
        column: node.position.start.column,
      });
    }
    if (isParent(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(tree);

  const findings: Array<PlanLintFinding> = [];
  for (const glance of glances) {
    const count = Math.max(glance.items.length, sectionTitles.length);
    for (let index = 0; index < count; index += 1) {
      const item = glance.items[index];
      const section = sectionTitles[index];
      if (item !== undefined && section !== undefined && item !== section) {
        findings.push({
          line: glance.line,
          column: glance.column,
          message: `Glance item ${index + 1} says "${item}" but section ${index + 1} is titled "${section}"; list every section title exactly, in document order`,
        });
      } else if (item !== undefined && section === undefined) {
        findings.push({
          line: glance.line,
          column: glance.column,
          message: `Glance item ${index + 1} ("${item}") has no matching section; a Glance lists exactly the document's sections`,
        });
      } else if (item === undefined && section !== undefined) {
        findings.push({
          line: glance.line,
          column: glance.column,
          message: `Glance is missing an item for section ${index + 1} ("${section}")`,
        });
      }
    }
  }
  return findings;
};

export const glanceMatchesSectionsRule: PlanLintRule = {
  id: "glance-matches-sections",
  check: checkGlanceMatchesSections,
};
