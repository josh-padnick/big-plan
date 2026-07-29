// Compiles QuickSummary's authored form into its plan model: the few short
// bullets a reviewer reads first, with hard caps that keep a summary from
// growing into an aggregation of the whole plan.

import type { Element, ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";

export const QUICK_SUMMARY_MAXIMUM_ITEMS = 5;
export const QUICK_SUMMARY_MAXIMUM_CHARACTERS = 600;

export type CompiledQuickSummary = {
  readonly items: ReadonlyArray<ReadonlyArray<ElementContent>>;
};

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isBlankText = (node: ElementContent): boolean =>
  node.type === "text" && node.value.trim() === "";

// Counts the characters a reader actually reads: text content with runs of
// whitespace collapsed, so markup and formatting never hide length.
const collectText = (nodes: ReadonlyArray<ElementContent>): string =>
  nodes
    .map((node) =>
      node.type === "text"
        ? node.value
        : isElement(node)
          ? collectText(node.children)
          : "",
    )
    .join("");

const readableLength = (nodes: ReadonlyArray<ElementContent>): number =>
  collectText(nodes).replace(/\s+/gu, " ").trim().length;

/** Compiles one QuickSummary component into the model consumed by rendering. */
export const compileQuickSummaryComponent = ({
  attributes,
  children,
  position,
  diagnostics,
}: ComponentCompilerInput): CompiledQuickSummary => {
  validateComponentAttributes({
    component: "QuickSummary",
    attributes,
    position,
    diagnostics,
    schema: {},
  });
  const meaningful = children.filter((node) => !isBlankText(node));
  const [list] = meaningful;
  if (
    meaningful.length !== 1 ||
    list === undefined ||
    !isElement(list) ||
    list.tagName !== "ul"
  ) {
    diagnostics.add({
      message:
        "QuickSummary must contain exactly one bullet list and nothing else",
      position,
    });
    return { items: [] };
  }
  const items = list.children
    .filter(isElement)
    .filter((child) => child.tagName === "li");
  if (items.length === 0) {
    diagnostics.add({
      message: "QuickSummary needs at least one bullet",
      position,
    });
  }
  if (items.length > QUICK_SUMMARY_MAXIMUM_ITEMS) {
    diagnostics.add({
      message: `QuickSummary allows at most ${QUICK_SUMMARY_MAXIMUM_ITEMS} bullets (found ${items.length}); keep only the key points`,
      position,
    });
  }
  const totalCharacters = items.reduce(
    (sum, item) => sum + readableLength(item.children),
    0,
  );
  if (totalCharacters > QUICK_SUMMARY_MAXIMUM_CHARACTERS) {
    diagnostics.add({
      message: `QuickSummary allows at most ${QUICK_SUMMARY_MAXIMUM_CHARACTERS} characters of text (found ${totalCharacters}); summarize at the altitude of intent, not inventory`,
      position,
    });
  }
  return { items: items.map((item) => item.children) };
};
