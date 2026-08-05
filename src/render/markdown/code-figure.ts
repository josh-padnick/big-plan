// Wraps every plain fenced code block in a figure carrying the shared
// maximize control, so a dense sketch a reviewer must actually read is not
// stuck at the width of the reading column.
//
// A fence rendered by a component (CodeSnippet, CodeDiff, DataTable, and the
// rest) already sits inside its own figure with its own caption chrome, and
// those add the control themselves through the React edge. This transform
// therefore only claims a pre that is still a bare child of the document.
//
// The attribute vocabulary is owned by components/_model/figure-controls.

import type { Element, Root, RootContent } from "hast";
import { MAXIMIZE_2_ICON } from "../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../icons/lucide/minimize-2.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
  TRIGGER_ATTRIBUTE,
  maximizeLabel,
} from "../../components/_model/figure-controls/figure-controls.js";
import { lucideIconToHast } from "./lucide-icon-hast.js";

const isElement = (node: RootContent): node is Element =>
  node.type === "element";

// /* off-scale */ Phase A preserves the legacy floating-control offsets and
// z-index exactly; Phase B will choose their scale-backed replacements.
// Matches the React edge's resting-quiet button so the two affordances are
// the same affordance.
const BUTTON_CLASSES =
  "figure-control inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-edge bg-paper p-0 text-muted transition-colors hover:bg-edge hover:text-ink focus-visible:bg-edge focus-visible:text-ink focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-c)_20%,transparent)] focus-visible:outline-none [&_svg]:size-3.5";

const maximizeButton = (): Element => {
  const label = maximizeLabel("code");
  return {
    type: "element",
    tagName: "button",
    properties: {
      type: "button",
      className: BUTTON_CLASSES.split(" "),
      "aria-label": label,
      "data-tooltip": label,
      hidden: true,
      [TRIGGER_ATTRIBUTE]: "",
    },
    children: [
      lucideIconToHast({ icon: MAXIMIZE_2_ICON }),
      lucideIconToHast({ icon: MINIMIZE_2_ICON, hidden: true }),
    ],
  };
};

const codeFigure = (pre: Element): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: [
      "code-figure",
      "group/code-figure",
      "relative",
      "mb-5",
      "[&>pre]:mb-0",
    ],
    [MAXIMIZABLE_ATTRIBUTE]: "code",
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          "figure-control-bar",
          "absolute",
          "top-[0.3rem]",
          "right-[0.4rem]",
          "z-[1]",
          "flex",
          "items-center",
          "justify-end",
          "gap-1",
          "p-0",
          "opacity-0",
          "motion-safe:transition-opacity",
          "motion-safe:duration-150",
          "group-hover/code-figure:opacity-100",
          "group-focus-within/code-figure:opacity-100",
        ],
      },
      children: [maximizeButton()],
    },
    { ...pre, properties: { ...pre.properties, [BODY_ATTRIBUTE]: "" } },
  ],
});

const isBareFence = (node: Element): boolean =>
  node.tagName === "pre" &&
  node.children.some((child) => isElement(child) && child.tagName === "code");

// Descends the document but never into an element that already declares
// itself maximizable: a component's own figure owns everything inside it.
const wrapCodeFigures = (node: Root | Element): void => {
  if (
    node.type === "element" &&
    node.properties[MAXIMIZABLE_ATTRIBUTE] !== undefined
  ) {
    return;
  }
  node.children = node.children.map((child) => {
    if (!isElement(child)) return child;
    if (isBareFence(child)) return codeFigure(child);
    wrapCodeFigures(child);
    return child;
  });
};

export const rehypeCodeFigures = () => (tree: Root) => {
  wrapCodeFigures(tree);
};
