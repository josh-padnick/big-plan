// Derives the authored h2 outline and any directly preceding valid Slide
// marker for lint rules that compare structural names or typed-slide facts.

import type { Heading } from "mdast";
import type { Node, Parent } from "unist";
import {
  isSlideTypeId,
  slideTypeFor,
  type SlideTypeId,
} from "../plan-vocabulary/slide-types/index.js";

export type AuthoredSection = {
  readonly name: string;
  readonly title: string;
  readonly line: number;
  readonly column: number;
  readonly type?: SlideTypeId;
  readonly markerLine?: number;
  readonly markerColumn?: number;
};

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNamedFlowElement = (node: Node, name: string): node is Parent =>
  node.type === "mdxJsxFlowElement" &&
  isParent(node) &&
  "name" in node &&
  node.name === name;

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

const headingText = (node: Node): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return "value" in node && typeof node.value === "string" ? node.value : "";
  }
  if (!isParent(node)) {
    return "";
  }
  return node.children.map(headingText).join("");
};

/** Returns h2 sections in source order with valid top-level type markers. */
export const collectAuthoredSections = (
  tree: Node,
): ReadonlyArray<AuthoredSection> => {
  const sections: Array<AuthoredSection> = [];

  const visit = (parent: Node): void => {
    if (!isParent(parent)) {
      return;
    }
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index];
      if (child === undefined) {
        continue;
      }
      if (
        isHeading(child) &&
        child.depth === 2 &&
        child.position !== undefined
      ) {
        const title = headingText(child).trim();
        const previous = parent.children[index - 1];
        const authoredType =
          parent.type === "root" &&
          previous !== undefined &&
          isNamedFlowElement(previous, "Slide")
            ? stringAttribute({ node: previous, name: "type" })
            : undefined;
        if (authoredType !== undefined && isSlideTypeId(authoredType)) {
          sections.push({
            name: slideTypeFor(authoredType).name,
            title,
            type: authoredType,
            line: child.position.start.line,
            column: child.position.start.column,
            ...(previous?.position === undefined
              ? {}
              : {
                  markerLine: previous.position.start.line,
                  markerColumn: previous.position.start.column,
                }),
          });
        } else {
          sections.push({
            name: title,
            title,
            line: child.position.start.line,
            column: child.position.start.column,
          });
        }
      }
      visit(child);
    }
  };

  visit(tree);
  return sections;
};
