// Implements the subtitle-duplication authoring rule: once a heading names the
// slide, nothing beneath it repeats that name, so a context builder or figure
// label either adds information or does not exist.

import type { Heading, InlineCode, Text } from "mdast";
import type { Node, Parent } from "unist";
import type { PlanLintFinding, PlanLintRule } from "../types.js";

// A component's authored attributes, as remark-mdx models them. Only a literal
// string attribute is comparable; plans cannot author expression values.
type JsxAttribute = {
  readonly type: string;
  readonly name?: string | null;
  readonly value?: unknown;
};

type JsxFlowElement = Node & {
  readonly name?: string | null;
  readonly attributes?: ReadonlyArray<JsxAttribute>;
};

// Leading articles carry no distinguishing information, so "The retry queue"
// and "Retry queue" are the same name to a reader.
const LEADING_ARTICLES: ReadonlyArray<string> = ["the", "a", "an"];

// Part markers name an act rather than a figure, and they always sit before
// the heading they might match rather than under it.
const STRUCTURAL_COMPONENTS: ReadonlyArray<string> = ["Part"];

const isParent = (node: Node): node is Parent => "children" in node;

const isHeading = (node: Node): node is Heading => node.type === "heading";

const isText = (node: Node): node is Text => node.type === "text";

const isInlineCode = (node: Node): node is InlineCode =>
  node.type === "inlineCode";

const isJsxFlowElement = (node: Node): node is JsxFlowElement =>
  node.type === "mdxJsxFlowElement";

const isBlank = (node: Node): boolean =>
  isText(node) && node.value.trim() === "";

// Flattens a node to the plain words a reader compares, so emphasis and
// inline code never hide a repeat.
const textOf = (node: Node): string => {
  if (isText(node) || isInlineCode(node)) {
    return node.value;
  }
  return isParent(node) ? node.children.map(textOf).join("") : "";
};

// Compares names the way a reader does: case, punctuation, and a leading
// article are noise.
const normalize = (value: string): ReadonlyArray<string> => {
  const words = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  const [first] = words;
  return first !== undefined && LEADING_ARTICLES.includes(first)
    ? words.slice(1)
    : words;
};

// Near-duplication is deliberately narrow: the same words, the same words
// reordered, or one name wholly contained in the other while still covering
// most of it. A passing mention of a heading's words never qualifies.
const nearDuplicates = ({
  candidate,
  heading,
}: {
  readonly candidate: string;
  readonly heading: string;
}): boolean => {
  const left = normalize(candidate);
  const right = normalize(heading);
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  if (left.join(" ") === right.join(" ")) {
    return true;
  }
  if ([...left].sort().join(" ") === [...right].sort().join(" ")) {
    return true;
  }
  const [shorter, longer] =
    left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 2 || shorter.length * 2 < longer.length) {
    return false;
  }
  return longer.join(" ").includes(shorter.join(" "));
};

// The context builder is a paragraph whose whole content is emphasized; it
// renders as the muted line only while it is the first block under a heading.
const contextBuilderText = (node: Node): string | undefined => {
  if (node.type !== "paragraph" || !isParent(node)) {
    return undefined;
  }
  const meaningful = node.children.filter((child) => !isBlank(child));
  const [only] = meaningful;
  if (
    meaningful.length !== 1 ||
    only === undefined ||
    only.type !== "emphasis"
  ) {
    return undefined;
  }
  return textOf(only);
};

// A figure's own label is the title attribute of a component standing directly
// in a slide. Nested titles name options, criteria, and columns instead.
const figureLabel = (node: Node): string | undefined => {
  if (!isJsxFlowElement(node)) {
    return undefined;
  }
  if (
    typeof node.name === "string" &&
    STRUCTURAL_COMPONENTS.includes(node.name)
  ) {
    return undefined;
  }
  const title = node.attributes?.find(
    (attribute) =>
      attribute.type === "mdxJsxAttribute" && attribute.name === "title",
  );
  return typeof title?.value === "string" ? title.value : undefined;
};

const checkSubtitleDuplication = ({
  tree,
}: {
  readonly markdown: string;
  readonly tree: Node;
}): ReadonlyArray<PlanLintFinding> => {
  if (!isParent(tree)) {
    return [];
  }
  const findings: Array<PlanLintFinding> = [];
  let heading: string | undefined;
  let leadingBlock = false;
  for (const node of tree.children) {
    if (isHeading(node)) {
      heading = textOf(node);
      leadingBlock = true;
      continue;
    }
    if (heading === undefined || node.position === undefined) {
      leadingBlock = false;
      continue;
    }
    const context = leadingBlock ? contextBuilderText(node) : undefined;
    if (
      context !== undefined &&
      nearDuplicates({ candidate: context, heading })
    ) {
      findings.push({
        line: node.position.start.line,
        column: node.position.start.column,
        message: `Drop this context builder or make it add something: it repeats the heading "${heading}"`,
      });
    }
    const label = figureLabel(node);
    if (label !== undefined && nearDuplicates({ candidate: label, heading })) {
      findings.push({
        line: node.position.start.line,
        column: node.position.start.column,
        message: `Drop this figure's title or name what the figure shows: it repeats the heading "${heading}"`,
      });
    }
    leadingBlock = false;
  }
  return findings;
};

export const subtitleDuplicationRule: PlanLintRule = {
  id: "subtitle-duplication",
  check: checkSubtitleDuplication,
};
