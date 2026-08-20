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
 * What a Group may never hold, wherever that Group stands.
 *
 * A Group clusters loose items so they travel together as one item of a row.
 * A pane takes its own share of that row, and a collection is a region of
 * repeating records rather than a control, so either one inside a Group turns
 * the Group into a second, undeclared layout container - one that escapes both
 * the row rules and the device column budget that keep a screen readable.
 */
export const NEVER_GROUPED: ReadonlySet<WireframeNode["element"]> = new Set([
  ...ROW_PANES,
  "List",
  "Table",
]);

/** The regions of repeating records, which a Group may not hold either. */
export const COLLECTIONS: ReadonlySet<WireframeNode["element"]> = new Set([
  "List",
  "Table",
]);

/**
 * The items a set of siblings really lays out, with every Group opened.
 *
 * A Group holds only loose items - compilation refuses one holding a pane or a
 * collection - so this no longer uncovers a hidden pane. What it uncovers is
 * the loose items themselves. checkSelection reads through it because a Group
 * of buttons beside a record collection is not the detail pane that would
 * demand exactly one selected record, and checkChoiceComposition because a
 * Group holding a ChoiceGroup beside another control is still a decision
 * sharing its row; reading such a Group as one opaque child answers both
 * questions wrongly. checkGroupedPanes reads through it to reach the forbidden
 * member itself, which is what makes the refusal hold through nested Groups.
 * Every other rule filters on elements a Group cannot hold, so it reads its
 * siblings directly.
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
