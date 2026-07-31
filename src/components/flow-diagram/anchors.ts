// The single owner of every FlowDiagram anchor string and of the attribute
// names that carry one into the rendered document.
//
// WHY THIS MODULE EXISTS
// An element anchor is written three times - into the compiled machine-readable
// model, onto the HTML the reader points at, and into the feedback package the
// agent receives. Three places deriving the same string independently is how
// markdown/deck-collapse.ts earned its warning comment. Every consumer reads
// the format from here instead of spelling it again.
//
// THE FORMAT
//   component/FlowDiagram#1                     the figure
//   component/FlowDiagram#1/stage/package       a stage column
//   component/FlowDiagram#1/node/apply          a node card
//   component/FlowDiagram#1/edge/apply-progress a connection
//   component/FlowDiagram#1/footer              the figure's own line
// Each string slots straight into the `anchors` field of a BlockDescriptor, so
// no parallel identity scheme appears beside the block tree.

/** Carries an element's anchor string into the rendered document. */
export const FLOW_ANCHOR_ATTRIBUTE = "data-flow-anchor";

/** Names which of the five kinds an anchored element is. */
export const FLOW_ELEMENT_ATTRIBUTE = "data-flow-element";

/** The kinds a reviewer may address; everything else in the figure is scenery. */
export type FlowElementKind = "figure" | "stage" | "node" | "edge" | "footer";

/** The figure's own address, from its position among the document's diagrams. */
export const flowFigureAnchor = ({
  ordinal,
}: {
  readonly ordinal: number;
}): string => `component/FlowDiagram#${ordinal}`;

export const flowStageAnchor = ({
  figure,
  stageId,
}: {
  readonly figure: string;
  readonly stageId: string;
}): string => `${figure}/stage/${stageId}`;

export const flowNodeAnchor = ({
  figure,
  nodeId,
}: {
  readonly figure: string;
  readonly nodeId: string;
}): string => `${figure}/node/${nodeId}`;

export const flowEdgeAnchor = ({
  figure,
  from,
  to,
}: {
  readonly figure: string;
  readonly from: string;
  readonly to: string;
}): string => `${figure}/edge/${from}-${to}`;

export const flowFooterAnchor = ({
  figure,
}: {
  readonly figure: string;
}): string => `${figure}/footer`;

// Stage titles are prose, so the slug drops anything that is not a letter,
// a number, or a word break. An empty result would make two untitled stages
// share one address, so it falls back to the ordinal instead.
const slugForStageTitle = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

/**
 * Resolves one stable id per stage in authored order.
 *
 * An authored `id` wins because it survives a reworded heading. Otherwise the
 * slugged title stands in, disambiguated by ordinal when two stages slug alike,
 * so a diagram never carries two identical addresses.
 */
export const resolveStageIds = (
  stages: ReadonlyArray<{ readonly id?: string; readonly title: string }>,
): ReadonlyArray<string> => {
  const used = new Set<string>();
  return stages.map((stage, index) => {
    const preferred =
      stage.id ?? (slugForStageTitle(stage.title) || `stage-${index + 1}`);
    if (!used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    let suffix = 2;
    while (used.has(`${preferred}-${suffix}`)) {
      suffix += 1;
    }
    const id = `${preferred}-${suffix}`;
    used.add(id);
    return id;
  });
};
