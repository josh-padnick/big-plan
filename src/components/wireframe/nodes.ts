// Shared reads over a compiled wireframe node tree: walking it, deciding which
// children take a share of the row they stand in, and deciding which authored
// Buttons perform work rather than switch mode. Compilation, the catalog's
// per-element rules, and the view all ask these questions about the same tree,
// and answering them separately is how a diagnostic and the drawing it
// validated come apart without either one failing.

import type { WireframeNode } from "./model.js";

/** Every node in one subtree, in authored order, at any depth. */
export const flattenNodes = (
  nodes: ReadonlyArray<WireframeNode>,
): ReadonlyArray<WireframeNode> =>
  nodes.flatMap((node) =>
    "children" in node ? [node, ...flattenNodes(node.children)] : [node],
  );

/** Elements that stretch to fill the row they stand in. */
export const FLEXIBLE_PANES: ReadonlySet<WireframeNode["element"]> = new Set([
  "Panel",
  "Stack",
  "Center",
  "Row",
]);

/**
 * Every element that takes a share of the row it stands in.
 *
 * Rail is a pane like the rest; it is separated out only where a rule cares
 * that it owns a fixed secondary width instead of stretching.
 */
export const ROW_PANES: ReadonlySet<WireframeNode["element"]> = new Set([
  ...FLEXIBLE_PANES,
  "Rail",
]);

/**
 * The panes a set of siblings really lays out, with every Group opened.
 *
 * A Group is a run of items that travel together as one item of a Row, not a
 * pane of its own, so the panes it holds still take their share of the row.
 * Reading a Group as one child would let three thirds or four outlined cards
 * hide behind a wrapper and reach the reviewer as the arrangement these rules
 * exist to refuse.
 */
export const paneSiblings = (
  nodes: ReadonlyArray<WireframeNode>,
): ReadonlyArray<WireframeNode> =>
  nodes.flatMap((node) =>
    node.element === "Group" ? paneSiblings(node.children) : [node],
  );

/**
 * Returns authored buttons that perform work, excluding mode and state.
 *
 * A segmented control's options and a bottom bar's destinations are drawn as
 * buttons, but they change what a surface shows rather than doing anything to
 * it, so no rule about actions may count them as one.
 */
export const workActionButtons = (
  nodes: ReadonlyArray<WireframeNode>,
): ReadonlyArray<WireframeNode> => {
  const all = flattenNodes(nodes);
  const stateButtons = new Set(
    all
      .filter(
        (node) =>
          node.element === "BottomBar" || node.element === "SegmentedControl",
      )
      .flatMap((node) => flattenNodes(node.children))
      .filter((node) => node.element === "Button"),
  );
  return all.filter(
    (node) => node.element === "Button" && !stateButtons.has(node),
  );
};
