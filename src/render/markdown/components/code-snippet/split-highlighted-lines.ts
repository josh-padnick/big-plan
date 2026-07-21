// Converts optional lowlight syntax output into independent HAST line fragments,
// cloning token spans at newline boundaries so each rendered row is self-contained.

import type { ElementContent, Text } from "hast";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export type HighlightedLine = ReadonlyArray<ElementContent>;

const text = (value: string): Text => ({ type: "text", value });

const highlightedChildren = ({
  source,
  language,
}: {
  readonly source: string;
  readonly language?: string;
}): ReadonlyArray<ElementContent> => {
  if (language === undefined || !lowlight.registered(language)) {
    return [text(source)];
  }
  return lowlight
    .highlight(language, source)
    .children.filter(
      (child): child is ElementContent => child.type !== "doctype",
    );
};

// Splits one node recursively and wraps every resulting line in a fresh copy
// of its ancestor span, preventing invalid cross-row element boundaries.
const splitNode = (node: ElementContent): ReadonlyArray<HighlightedLine> => {
  if (node.type === "text") {
    return node.value
      .split("\n")
      .map((value) => (value === "" ? [] : [text(value)]));
  }
  if (node.type !== "element") {
    return [[node]];
  }
  return splitChildren(node.children).map((children): HighlightedLine => [
    {
      type: "element",
      tagName: node.tagName,
      properties: node.properties,
      children: [...children],
    },
  ]);
};

// Merges a sequence of independently split nodes without losing the line on
// which one sibling ends and the next begins.
const splitChildren = (
  children: ReadonlyArray<ElementContent>,
): ReadonlyArray<HighlightedLine> => {
  const lines: Array<Array<ElementContent>> = [[]];
  for (const child of children) {
    const childLines = splitNode(child);
    const first = childLines[0] ?? [];
    lines[lines.length - 1]?.push(...first);
    for (const continuation of childLines.slice(1)) {
      lines.push([...continuation]);
    }
  }
  return lines;
};

/** Highlights a known language, then returns one self-contained HAST fragment per source line. */
export const splitHighlightedLines = ({
  source,
  language,
}: {
  readonly source: string;
  readonly language?: string;
}): ReadonlyArray<HighlightedLine> => {
  const lines = splitChildren(highlightedChildren({ source, language }));
  if (source.endsWith("\n") && lines.length > 1) {
    return lines.slice(0, -1);
  }
  return lines;
};
