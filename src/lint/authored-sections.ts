// Derives the authored h2 outline and any directly preceding valid Slide
// marker for lint rules that compare structural names or typed-slide facts.

import type { Heading } from "mdast";
import type { Node } from "unist";
import {
  isSlideTypeId,
  slideTypeFor,
  type SlideTypeId,
} from "../plan-vocabulary/slide-types/index.js";
import { isNamedFlowElement, isParent, stringAttribute } from "./mdx-nodes.js";

export type AuthoredSection = {
  readonly name: string;
  readonly toc?: string;
  readonly title: string;
  readonly components: ReadonlyArray<string>;
  readonly line: number;
  readonly column: number;
  readonly type?: SlideTypeId;
  readonly markerLine?: number;
  readonly markerColumn?: number;
};

const isHeading = (node: Node): node is Heading => node.type === "heading";

const headingText = (node: Node): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return "value" in node && typeof node.value === "string" ? node.value : "";
  }
  if (!isParent(node)) {
    return "";
  }
  return node.children.map(headingText).join("");
};

const componentNamesWithin = (
  nodes: ReadonlyArray<Node>,
): ReadonlyArray<string> => {
  const names: Array<string> = [];
  const visit = (node: Node): void => {
    if (
      node.type === "mdxJsxFlowElement" &&
      "name" in node &&
      typeof node.name === "string"
    ) {
      names.push(node.name);
    }
    if (isParent(node)) {
      node.children.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return names;
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
        const nextSectionOffset = parent.children
          .slice(index + 1)
          .findIndex(
            (candidate) => isHeading(candidate) && candidate.depth === 2,
          );
        const sectionEnd =
          nextSectionOffset === -1
            ? parent.children.length
            : index + 1 + nextSectionOffset;
        const components = componentNamesWithin(
          parent.children.slice(index + 1, sectionEnd),
        );
        const title = headingText(child).trim();
        const previous = parent.children[index - 1];
        const authoredType =
          parent.type === "root" &&
          previous !== undefined &&
          isNamedFlowElement(previous, "Slide")
            ? stringAttribute({ node: previous, name: "type" })
            : undefined;
        if (authoredType !== undefined && isSlideTypeId(authoredType)) {
          const journeyName =
            authoredType === "user-journey" && previous !== undefined
              ? stringAttribute({ node: previous, name: "name" })
              : undefined;
          const journeyToc =
            authoredType === "user-journey" && previous !== undefined
              ? stringAttribute({ node: previous, name: "toc" })
              : undefined;
          sections.push({
            name: journeyName ?? slideTypeFor(authoredType).name,
            ...(journeyToc === undefined ? {} : { toc: journeyToc }),
            title,
            components,
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
            components,
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
