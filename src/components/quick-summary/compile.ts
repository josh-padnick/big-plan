// Compiles QuickSummary's authored form into its plan model: What, How,
// Risks, and Decisions facets of a few short bullets each, with hard caps
// that keep a summary from growing into an aggregation of the whole plan.

import type { Element, ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";

export const QUICK_SUMMARY_FACETS = [
  "What",
  "How",
  "Risks",
  "Decisions",
] as const;

export type QuickSummaryFacetName = (typeof QUICK_SUMMARY_FACETS)[number];

export const QUICK_SUMMARY_MAXIMUM_BULLETS_PER_FACET = 3;
export const QUICK_SUMMARY_MAXIMUM_CHARACTERS = 600;

export type CompiledQuickSummaryFacet = {
  readonly name: QuickSummaryFacetName;
  readonly items: ReadonlyArray<ReadonlyArray<ElementContent>>;
};

export type CompiledQuickSummary = {
  readonly facets: ReadonlyArray<CompiledQuickSummaryFacet>;
};

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

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

// Extracts a facet's bullet items, reporting every shape violation at the
// facet's own position.
const compileFacet = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<ReadonlyArray<ElementContent>> => {
  validateComponentAttributes({
    component: child.name,
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: {},
  });
  const body = meaningfulChildren(child.children);
  const [list] = body;
  if (
    body.length !== 1 ||
    list === undefined ||
    !isElement(list) ||
    list.tagName !== "ul"
  ) {
    diagnostics.add({
      message: `${child.name} must contain exactly one bullet list and nothing else`,
      position: child.position,
    });
    return [];
  }
  const items = list.children
    .filter(isElement)
    .filter((entry) => entry.tagName === "li");
  if (items.length === 0) {
    diagnostics.add({
      message: `${child.name} needs at least one bullet`,
      position: child.position,
    });
  }
  if (items.length > QUICK_SUMMARY_MAXIMUM_BULLETS_PER_FACET) {
    diagnostics.add({
      message: `${child.name} allows at most ${QUICK_SUMMARY_MAXIMUM_BULLETS_PER_FACET} bullets (found ${items.length}); keep only the key points`,
      position: child.position,
    });
  }
  return items.map((item) => item.children);
};

/** Compiles one QuickSummary component into the model consumed by rendering. */
export const compileQuickSummaryComponent = ({
  attributes,
  children,
  scopedChildren,
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
  if (meaningfulChildren(children).length > 0) {
    diagnostics.add({
      message:
        "QuickSummary holds only What, How, Risks, and Decisions sections; move loose content into one of them",
      position,
    });
  }
  const seen = new Set<string>();
  for (const child of scopedChildren) {
    if (seen.has(child.name)) {
      diagnostics.add({
        message: `QuickSummary allows one ${child.name} section`,
        position: child.position,
      });
    }
    seen.add(child.name);
  }
  if (!seen.has("What")) {
    diagnostics.add({
      message:
        "QuickSummary needs a What section stating what changes for the reader",
      position,
    });
  }
  const authoredNames = scopedChildren.map((child) => child.name);
  // The first occurrence of each authored facet must follow canonical order;
  // duplicates are already reported above.
  const firstOfEach = QUICK_SUMMARY_FACETS.map((name) =>
    scopedChildren.find((child) => child.name === name),
  ).filter((child): child is ScopedChild => child !== undefined);
  const inCanonicalOrder = scopedChildren
    .filter((child, index) => authoredNames.indexOf(child.name) === index)
    .every((child, index) => child === firstOfEach[index]);
  if (!inCanonicalOrder) {
    diagnostics.add({
      message:
        "Order QuickSummary sections What, How, Risks, Decisions so every plan reads the same way",
      position,
    });
  }
  const facets = QUICK_SUMMARY_FACETS.flatMap((name) => {
    const child = scopedChildren.find((entry) => entry.name === name);
    if (child === undefined) {
      return [];
    }
    return [{ name, items: compileFacet({ child, diagnostics }) }];
  });
  const totalCharacters = facets.reduce(
    (sum, facet) =>
      sum +
      facet.items.reduce(
        (facetSum, item) => facetSum + readableLength(item),
        0,
      ),
    0,
  );
  if (totalCharacters > QUICK_SUMMARY_MAXIMUM_CHARACTERS) {
    diagnostics.add({
      message: `QuickSummary allows at most ${QUICK_SUMMARY_MAXIMUM_CHARACTERS} characters of text (found ${totalCharacters}); summarize at the altitude of intent, not inventory`,
      position,
    });
  }
  return { facets };
};
