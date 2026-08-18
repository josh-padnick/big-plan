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
  readonly wireframeReason?: string;
  readonly title: string;
  /** Title of the nearest preceding top-level Part marker, when the plan uses Parts. */
  readonly partTitle?: string;
  readonly partOrdinal?: number;
  /** Title of the h2 group a typed sub-slide sits inside. */
  readonly parentTitle?: string;
  readonly isTopLevel: boolean;
  readonly components: ReadonlyArray<string>;
  readonly content: ReadonlyArray<Node>;
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

/**
 * Returns typed h3 sub-slides in source order: the journeys a plan groups
 * under an actor. Only a marked sub-slide is collected, because an unmarked
 * h3 carries no typed identity for a rule to judge. The h2 collector stays
 * h2-only so section-counting rules keep comparing like with like.
 */
export const collectAuthoredSubSections = (
  tree: Node,
): ReadonlyArray<AuthoredSection> => {
  const sections: Array<AuthoredSection> = [];
  if (!isParent(tree)) {
    return sections;
  }
  let partTitle: string | undefined;
  let partOrdinal: number | undefined;
  let nextPartOrdinal = 0;
  let parentTitle: string | undefined;
  for (let index = 0; index < tree.children.length; index += 1) {
    const child = tree.children[index];
    if (child === undefined) {
      continue;
    }
    if (isNamedFlowElement(child, "Part")) {
      partTitle = stringAttribute({ node: child, name: "title" });
      // A Part opens a new act, so no heading before it can be the parent of
      // anything after it. Carrying the previous h2 across would let a typed
      // sub-slide inherit a container title from the act it just left.
      parentTitle = undefined;
      nextPartOrdinal += 1;
      partOrdinal = nextPartOrdinal;
      continue;
    }
    if (isHeading(child) && child.depth === 2) {
      parentTitle = headingText(child).trim();
      continue;
    }
    if (
      !isHeading(child) ||
      child.depth !== 3 ||
      child.position === undefined
    ) {
      continue;
    }
    const previous = tree.children[index - 1];
    if (previous === undefined || !isNamedFlowElement(previous, "Slide")) {
      continue;
    }
    const authoredType = stringAttribute({ node: previous, name: "type" });
    if (authoredType === undefined || !isSlideTypeId(authoredType)) {
      continue;
    }
    const nextOffset = tree.children
      .slice(index + 1)
      .findIndex(
        (candidate) =>
          isHeading(candidate) &&
          (candidate.depth === 2 || candidate.depth === 3),
      );
    const end =
      nextOffset === -1 ? tree.children.length : index + 1 + nextOffset;
    const journeyName = stringAttribute({ node: previous, name: "name" });
    const journeyToc = stringAttribute({ node: previous, name: "toc" });
    const wireframeReason = stringAttribute({
      node: previous,
      name: "wireframeReason",
    });
    sections.push({
      name: journeyName ?? slideTypeFor(authoredType).name,
      ...(journeyToc === undefined ? {} : { toc: journeyToc }),
      ...(wireframeReason === undefined ? {} : { wireframeReason }),
      ...(partTitle === undefined ? {} : { partTitle }),
      ...(partOrdinal === undefined ? {} : { partOrdinal }),
      ...(parentTitle === undefined ? {} : { parentTitle }),
      isTopLevel: false,
      title: headingText(child).trim(),
      components: componentNamesWithin(tree.children.slice(index + 1, end)),
      content: tree.children.slice(index + 1, end),
      type: authoredType,
      line: child.position.start.line,
      column: child.position.start.column,
      ...(previous.position === undefined
        ? {}
        : {
            markerLine: previous.position.start.line,
            markerColumn: previous.position.start.column,
          }),
    });
  }
  return sections;
};

/** Returns h2 sections in source order with valid top-level type markers. */
export const collectAuthoredSections = (
  tree: Node,
): ReadonlyArray<AuthoredSection> => {
  const sections: Array<AuthoredSection> = [];
  let nextPartOrdinal = 0;

  const visit = ({
    parent,
    inheritedPartTitle,
    inheritedPartOrdinal,
  }: {
    readonly parent: Node;
    readonly inheritedPartTitle?: string;
    readonly inheritedPartOrdinal?: number;
  }): void => {
    if (!isParent(parent)) {
      return;
    }
    let partTitle = inheritedPartTitle;
    let partOrdinal = inheritedPartOrdinal;
    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index];
      if (child === undefined) {
        continue;
      }
      if (parent.type === "root" && isNamedFlowElement(child, "Part")) {
        partTitle = stringAttribute({ node: child, name: "title" });
        nextPartOrdinal += 1;
        partOrdinal = nextPartOrdinal;
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
          const wireframeReason =
            authoredType === "user-journey" && previous !== undefined
              ? stringAttribute({ node: previous, name: "wireframeReason" })
              : undefined;
          sections.push({
            name: journeyName ?? slideTypeFor(authoredType).name,
            ...(journeyToc === undefined ? {} : { toc: journeyToc }),
            ...(wireframeReason === undefined ? {} : { wireframeReason }),
            ...(partTitle === undefined ? {} : { partTitle }),
            ...(partOrdinal === undefined ? {} : { partOrdinal }),
            isTopLevel: parent.type === "root",
            title,
            components,
            content: parent.children.slice(index + 1, sectionEnd),
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
            ...(partTitle === undefined ? {} : { partTitle }),
            ...(partOrdinal === undefined ? {} : { partOrdinal }),
            isTopLevel: parent.type === "root",
            title,
            components,
            content: parent.children.slice(index + 1, sectionEnd),
            line: child.position.start.line,
            column: child.position.start.column,
          });
        }
      }
      visit({
        parent: child,
        inheritedPartTitle: partTitle,
        inheritedPartOrdinal: partOrdinal,
      });
    }
  };

  visit({ parent: tree });
  return sections;
};
