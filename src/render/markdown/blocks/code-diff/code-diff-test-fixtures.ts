// Provides CodeDiff unit-test inputs, renderer setup, and HAST traversal
// assertions shared by the diagnostics and rendering behavior suites.

import type { Element, ElementContent } from "hast";
import { createDiagnosticCollector } from "../diagnostics.js";
import type { BlockAttributeValue, ScopedChild } from "../block-contract.js";
import { renderCodeDiff } from "./code-diff.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

export const fence = ({
  language = "diff",
  source = "@@ -1 +1 @@\n-old\n+new\n",
  column = 1,
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  position: {
    start: { line: 4, column, offset: 30 },
    end: { line: 8, column: 4, offset: 80 },
  },
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: [`language-${language}`] },
      position: {
        start: { line: 4, column, offset: 30 },
        end: { line: 8, column: 4, offset: 80 },
      },
      children: [{ type: "text", value: source }],
    },
  ],
});

export const annotation = ({
  lines,
  side,
  value = "Review this line.",
  positionLine = 10,
  extraAttributes = {},
}: {
  readonly lines: BlockAttributeValue;
  readonly side?: BlockAttributeValue;
  readonly value?: string;
  readonly positionLine?: number;
  readonly extraAttributes?: Readonly<Record<string, BlockAttributeValue>>;
}): ScopedChild => ({
  name: "Annotation",
  attributes: {
    lines,
    ...(side === undefined ? {} : { side }),
    ...extraAttributes,
  },
  position: {
    start: { line: positionLine, column: 1, offset: 100 },
    end: { line: positionLine + 2, column: 12, offset: 150 },
  },
  children: [
    {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value }],
    },
  ],
});

export const isElement = (node: ElementContent | undefined): node is Element =>
  node?.type === "element";

export const textOf = (element: Element): string =>
  element.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : isElement(child)
          ? textOf(child)
          : "",
    )
    .join("");

// Finds the rendered container that directly owns a matching descendant.
export const parentOfMatchingChild = ({
  element,
  matches,
}: {
  readonly element: Element;
  readonly matches: (candidate: Element) => boolean;
}): Element | undefined => {
  for (const child of element.children) {
    if (isElement(child) && matches(child)) {
      return element;
    }
  }
  for (const child of element.children) {
    if (!isElement(child)) {
      continue;
    }
    const found = parentOfMatchingChild({ element: child, matches });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

// Finds the first matching element in document order for structural checks.
export const findElement = ({
  element,
  matches,
}: {
  readonly element: Element;
  readonly matches: (candidate: Element) => boolean;
}): Element | undefined => {
  if (matches(element)) {
    return element;
  }
  for (const child of element.children) {
    if (!isElement(child)) {
      continue;
    }
    const found = findElement({ element: child, matches });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

export const viewFrom = ({
  element,
  view,
}: {
  readonly element: Element;
  readonly view: "unified" | "split";
}): Element => {
  const found = element.children.find(
    (child) =>
      isElement(child) && child.properties["data-diff-content"] === view,
  );
  if (found === undefined || !isElement(found)) {
    throw new Error(`Missing ${view} diff view`);
  }
  return found;
};

export const renderCodeDiffFixture = ({
  attributes = { file: "src/retry.ts" },
  children = [fence()],
  scopedChildren = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderCodeDiff({
    attributes,
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};
