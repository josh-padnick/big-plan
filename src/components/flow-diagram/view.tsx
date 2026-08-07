// Renders a compiled FlowDiagram as a staged diagram: small-caps stage headers over
// content-sized, tone-tinted cards, joined by verb-labeled connectors whose
// arrowheads point subject-to-object, with an explicit branching fork when
// one node feeds several. Placement is inline grid coordinates because
// column and row counts are per-diagram knowledge; colors and connector
// drawing live in the colocated stylesheet.
//
// TWO THINGS THIS VIEW OWES THE READER BESIDES THE PICTURE
//  1. DOM order is flow order - each stage, then its nodes, then the edges
//     leaving them. Every cell is placed by explicit grid coordinates, so DOM
//     order carries no visual meaning and the picture is identical either way;
//     assistive technology reads the flow instead of four titles, five cards,
//     and three loose verbs.
//  2. Every authored element inside the figure - stage, node, edge, and
//     footer - is a comment and suggested-edit target. The figure itself is
//     the diagram's keyboard entry point and address, not a comment target:
//     slide-level feedback owns whole-diagram remarks. Drawn connectors,
//     rails, and stubs stay decoration and are hidden from assistive
//     technology.

import type { CSSProperties, ReactNode } from "react";
import type {
  CompiledFlowDiagram,
  CompiledFlowDiagramEdge,
  CompiledFlowDiagramNode,
  CompiledFlowDiagramStage,
} from "./compile.js";
import {
  FLOW_ANCHOR_ATTRIBUTE,
  FLOW_ELEMENT_ATTRIBUTE,
  type FlowElementKind,
} from "./anchors.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import type { LucideIcon } from "../../icons/lucide-icon.js";
import { lucideIconToReact } from "../_shared/lucide-icon/lucide-icon.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";
import { MaximizeButton } from "../_shared/figure-controls/maximize-button.js";

// /* off-scale */ Phase A preserves the legacy semantic washes, 0.85rem card
// padding, connector-label offsets, and compact badge metrics exactly. Phase
// B may regularize them against the product scale.

const BADGE_CLASSES =
  "flow-diagram-badge ml-1.5 inline-block rounded-full px-2 py-0.5 align-[1px] text-2xs font-semibold";

const BADGE_TONE_CLASSES: Readonly<Record<"neutral" | "warning", string>> = {
  neutral: "bg-surface text-muted",
  warning: "bg-[var(--callout-warning-bg)] text-[var(--callout-warning-c)]",
};

// A node's tone is a palette pairing - ground, label ink, and a secondary ink
// from the same hue - so the stylesheet owns it through the tone attribute and
// no utility here can hand a tinted card a grey label.

const LABEL_CLASSES = "block text-sm font-semibold";

const EDGE_LABEL_CLASSES =
  "absolute -top-[1.15rem] left-1/2 -translate-x-1/2 text-2xs whitespace-nowrap text-muted";

// Grid template column widths: card columns size to content, connector
// columns hold a verb label without crowding it, and a fork column is
// narrower because its branches carry shorter ones. Both are wide enough that
// a label like "streams" reads as a word rather than as a smudge between two
// cards - the tightest case the captain called out.
const LINK_COLUMN = "7rem";
const FORK_COLUMN = "4.75rem";

// Every targetable element declares the same four things, so the viewer leg
// can treat a stage, a node, an edge, and the footer alike.
const targetProps = ({
  kind,
  anchor,
  name,
  accessibleName,
  tabbable = false,
}: {
  readonly kind: FlowElementKind;
  readonly anchor: string;
  readonly name: string;
  readonly accessibleName: string;
  // Roving focus: only the figure joins the document tab order, so a diagram
  // is one tab stop and arrow keys move between its elements.
  readonly tabbable?: boolean;
}) => ({
  [FLOW_ELEMENT_ATTRIBUTE]: kind,
  [FLOW_ANCHOR_ATTRIBUTE]: anchor,
  // The short human name a tray line and a live announcement both read.
  "data-flow-name": name,
  role: "group",
  "aria-label": accessibleName,
  tabIndex: tabbable ? 0 : -1,
});

const Node = ({
  node,
  stage,
  style,
  spaced,
}: {
  readonly node: CompiledFlowDiagramNode;
  readonly stage: CompiledFlowDiagramStage;
  readonly style: CSSProperties;
  readonly spaced: boolean;
}) => (
  <div
    data-flow-diagram-node
    data-flow-diagram-tone={node.tone}
    data-flow-node={node.id}
    data-flow-in-stage={stage.id}
    className={`flow-diagram-node rounded-lg border border-edge px-3 py-2 leading-normal${spaced ? " my-1" : ""}`}
    style={style}
    {...targetProps({
      kind: "node",
      anchor: node.anchor,
      name: `node "${node.label}"`,
      accessibleName: [
        node.label,
        `node in stage ${stage.title}`,
        ...(node.code === undefined ? [] : [node.code]),
        ...(node.badge === undefined ? [] : [node.badge]),
      ].join(", "),
    })}
  >
    <strong className={LABEL_CLASSES}>
      <span data-flow-field="label">{node.label}</span>
      {node.badge === undefined ? null : (
        <span
          data-flow-diagram-badge
          data-flow-diagram-badge-tone={node.badgeTone}
          data-flow-field="badge"
          className={`${BADGE_CLASSES} ${BADGE_TONE_CLASSES[node.badgeTone]}`}
        >
          {node.badge}
        </span>
      )}
    </strong>
    {node.code === undefined ? null : (
      <code
        data-flow-field="code"
        className="flow-diagram-node-code block rounded-none border-0 bg-transparent p-0 font-mono text-xs"
      >
        {node.code}
      </code>
    )}
    {node.body.length === 0 ? null : (
      <span data-flow-field="body" className="mt-0.5 block text-sm text-muted">
        {hastContentToReact(node.body)}
      </span>
    )}
  </div>
);

// One straight connector: the line itself, its arrowhead from the
// stylesheet, and the verb label floating above the middle. The connector is
// two pixels of paint, so the target a reviewer aims at is the padded hit
// area spanning its whole cell rather than the line.
const Link = ({
  edge,
  name,
  accessibleName,
  style,
}: {
  readonly edge: CompiledFlowDiagramEdge;
  readonly name: string;
  readonly accessibleName: string;
  readonly style: CSSProperties;
}) => (
  <div
    data-flow-diagram-link
    data-flow-edge-from={edge.from}
    data-flow-edge-to={edge.to}
    className="flow-diagram-link relative self-center"
    style={style}
    {...targetProps({
      kind: "edge",
      anchor: edge.anchor,
      name,
      accessibleName,
    })}
  >
    <span className="flow-diagram-hit" aria-hidden />
    {edge.label === undefined ? null : (
      <span className={EDGE_LABEL_CLASSES} data-flow-field="label">
        {edge.label}
      </span>
    )}
  </div>
);

const branchPosition = ({
  index,
  count,
}: {
  readonly index: number;
  readonly count: number;
}): "first" | "middle" | "last" =>
  index === 0 ? "first" : index === count - 1 ? "last" : "middle";

// approved-metric: the 36 pixel control box, which is the touch-target floor a
// browser test holds for every toolbar control.
const VIEWER_CONTROL_CLASSES =
  "figure-control inline-flex h-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";

// A bounded group: the border and the shared ground say these controls belong
// together, so no separator has to say it for them.
const TOOLBAR_GROUP_CLASSES =
  "inline-flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-edge bg-raised";

const IconControl = ({
  icon,
  label,
  action,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly action: string;
}) => (
  <button
    type="button"
    className={`${VIEWER_CONTROL_CLASSES} w-9 px-0`}
    aria-label={label}
    data-tooltip={label}
    data-flow-zoom={action}
  >
    {lucideIconToReact({ icon, hidden: false })}
  </button>
);

// A diagram is a canvas wherever it sits, so zoom belongs to the reading
// column as much as to the overlay. The group ships hidden and the viewer leg
// reveals it, because without scripts there is no canvas to zoom.
const ViewerControls = () => (
  <span
    className="flow-diagram-view-controls ml-auto inline-flex shrink-0 items-center gap-2"
    data-flow-zoom-controls
    hidden
  >
    <span
      className={`flow-diagram-zoom ${TOOLBAR_GROUP_CLASSES}`}
      role="group"
      aria-label="Diagram zoom"
    >
      <IconControl icon={MINUS_ICON} label="Zoom out" action="out" />
      <button
        type="button"
        className={`${VIEWER_CONTROL_CLASSES} flow-diagram-zoom-readout min-w-12 border-x border-edge px-2 font-sans text-2xs tabular-nums`}
        aria-label="Reset zoom to 100%"
        data-tooltip="Reset zoom to 100%"
        data-flow-zoom="reset"
        data-flow-zoom-readout
      >
        100%
      </button>
      <IconControl icon={PLUS_ICON} label="Zoom in" action="in" />
    </span>
    {/* Fit says its word: beside a maximize control, a second frame-shaped
        glyph reads as a second maximize. */}
    <button
      type="button"
      className={`${VIEWER_CONTROL_CLASSES} flow-diagram-fit gap-1.5 rounded-md border border-edge bg-raised px-3 font-sans text-2xs font-semibold`}
      aria-label="Fit diagram to width"
      aria-pressed="false"
      data-tooltip="Fit diagram to width"
      data-flow-zoom="fit"
    >
      {lucideIconToReact({ icon: SCAN_ICON, hidden: false })}
      <span>Fit</span>
    </button>
    <MaximizeButton subject="diagram" size="toolbar" />
  </span>
);

// Showing the original is one either-or state, so it is a switch. A switch
// shows which state is on without the reader translating a verb, and it is the
// same control the file-tree diff uses for the same kind of question.
const MODE_SWITCH_CLASSES =
  "flow-diagram-mode-switch inline-flex h-3.5 w-6 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-raised transition-all outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50 aria-checked:bg-accent aria-[checked=false]:bg-edge";
const MODE_THUMB_CLASSES =
  "flow-diagram-mode-thumb pointer-events-none block size-3 rounded-full bg-paper ring-0 transition-transform";

// Proposal chrome: dormant until the reviewer makes a proposal, because a
// diagram nobody has marked up should show no control it cannot act on. It
// sits directly after the feedback action rather than floating between margins.
const ProposalControls = () => (
  <span
    className="flow-diagram-proposal-group ml-2 inline-flex items-center gap-1"
    data-flow-proposal-group
    hidden
  >
    <span
      className={`flow-diagram-mode ${VIEWER_CONTROL_CLASSES} gap-2 rounded-md px-3 font-sans text-2xs font-semibold`}
    >
      <span id="flow-mode-label">Show original</span>
      <button
        type="button"
        role="switch"
        aria-checked="false"
        aria-labelledby="flow-mode-label"
        className={MODE_SWITCH_CLASSES}
        data-flow-mode
      >
        <span className={MODE_THUMB_CLASSES} />
      </button>
    </span>
    <button
      type="button"
      className={`${VIEWER_CONTROL_CLASSES} flow-diagram-revert-all w-9 rounded-md px-0`}
      data-flow-revert-all
      aria-label="Revert all changes"
      data-tooltip="Revert all changes"
    >
      {lucideIconToReact({ icon: ROTATE_CCW_ICON, hidden: false })}
    </button>
  </span>
);

// The connectors leaving one stage, in the column between it and the next.
const connectorsLeaving = ({
  model,
  stageIndex,
  laneCount,
  edgeName,
  edgeAccessibleName,
}: {
  readonly model: CompiledFlowDiagram;
  readonly stageIndex: number;
  readonly laneCount: number;
  readonly edgeName: (edge: CompiledFlowDiagramEdge) => string;
  readonly edgeAccessibleName: (edge: CompiledFlowDiagramEdge) => string;
}): ReadonlyArray<ReactNode> => {
  const next = model.stages[stageIndex + 1];
  if (next === undefined) {
    return [];
  }
  const connectorColumn = `${stageIndex * 2 + 2}`;
  const edgeInto = (nodeId: string) =>
    model.edges.find((edge) => edge.to === nodeId);
  if (next.nodes.length <= 1) {
    const target = next.nodes[0];
    const edge = target === undefined ? undefined : edgeInto(target.id);
    if (edge === undefined) {
      return [];
    }
    return [
      <Link
        key={`link-${stageIndex}`}
        edge={edge}
        name={edgeName(edge)}
        accessibleName={edgeAccessibleName(edge)}
        style={{
          gridColumn: connectorColumn,
          gridRow: `2 / span ${laneCount}`,
        }}
      />,
    ];
  }
  // The explicit one-to-many fork: a stub leaves the source at the stack's
  // center, and every target row gets its own rail-and-arrow branch, so a
  // lone arrow never stands beside a stack. The stub and the rail are drawn
  // scenery; only the branch carries an authored edge.
  return [
    <div
      key={`stub-${stageIndex}`}
      data-flow-diagram-fork-stub
      // The stub leaves one node, so it can ghost with that node even though
      // it carries no authored edge of its own.
      data-flow-stub-from={model.stages[stageIndex]?.nodes[0]?.id}
      aria-hidden
      className="flow-diagram-fork-stub w-1/2 justify-self-start self-center"
      style={{
        gridColumn: connectorColumn,
        gridRow: `2 / span ${laneCount}`,
      }}
    />,
    ...next.nodes.flatMap((node, nodeIndex) => {
      const edge = edgeInto(node.id);
      if (edge === undefined) {
        return [];
      }
      return [
        <div
          key={`branch-${node.id}`}
          data-flow-diagram-branch={branchPosition({
            index: nodeIndex,
            count: next.nodes.length,
          })}
          data-flow-edge-from={edge.from}
          data-flow-edge-to={edge.to}
          className="flow-diagram-fork-branch relative self-stretch"
          style={{
            gridColumn: connectorColumn,
            gridRow: `${nodeIndex + 2}`,
          }}
          {...targetProps({
            kind: "edge",
            anchor: edge.anchor,
            name: edgeName(edge),
            accessibleName: edgeAccessibleName(edge),
          })}
        >
          <span className="flow-diagram-hit" aria-hidden />
          <span className="flow-diagram-fork-rail" aria-hidden />
          {edge.label === undefined ? null : (
            // The branch's own segment runs from the rail to the card, so its
            // verb floats over that right half.
            <span
              data-flow-field="label"
              className="absolute top-[calc(50%-1.35rem)] left-3/4 -translate-x-1/2 text-2xs whitespace-nowrap text-muted"
            >
              {edge.label}
            </span>
          )}
        </div>,
      ];
    }),
  ];
};

const StageHeader = ({
  stage,
  stageIndex,
  stageCount,
  style,
}: {
  readonly stage: CompiledFlowDiagramStage;
  readonly stageIndex: number;
  readonly stageCount: number;
  readonly style: CSSProperties;
}) => (
  <p
    data-flow-diagram-stage
    data-flow-stage={stage.id}
    // A stage's neighborhood is its position in the flow; the tray reads it
    // from here rather than from the accessible name, which a proposal
    // rewrites.
    data-flow-where={`stage ${stageIndex + 1} of ${stageCount}`}
    className="m-0 mb-2 self-end text-2xs font-semibold tracking-caps uppercase text-subtle"
    style={style}
    {...targetProps({
      kind: "stage",
      anchor: stage.anchor,
      name: `stage "${stage.title}"`,
      accessibleName: `${stage.title}, stage ${stageIndex + 1} of ${stageCount}`,
    })}
  >
    <span data-flow-field="title">{stage.title}</span>
  </p>
);

export const FlowDiagram = ({
  model,
}: {
  readonly model: CompiledFlowDiagram;
}) => {
  const laneCount = Math.max(
    1,
    ...model.stages.map((stage) => stage.nodes.length),
  );
  const lastStage = model.stages.length - 1;
  const fansOut = (model.stages[lastStage]?.nodes.length ?? 0) > 1;
  const columns = model.stages
    .map((stage, index) => {
      if (index === lastStage) {
        return "auto";
      }
      return `auto ${index === lastStage - 1 && fansOut ? FORK_COLUMN : LINK_COLUMN}`;
    })
    .join(" ");
  const cardColumn = (stageIndex: number) => `${stageIndex * 2 + 1}`;
  const labelOf = (nodeId: string) =>
    model.stages
      .flatMap((stage) => stage.nodes)
      .find((node) => node.id === nodeId)?.label ?? nodeId;
  // An edge that names its endpoints removes the need for a parallel hidden
  // description of the whole diagram.
  const edgeAccessibleName = (edge: CompiledFlowDiagramEdge) =>
    `${edge.label ?? "connects"}, from ${labelOf(edge.from)} to ${labelOf(edge.to)}`;
  // The short name a tray line reads: endpoints, not ids, because a reviewer
  // recognizes what the cards say.
  const edgeName = (edge: CompiledFlowDiagramEdge) =>
    `${labelOf(edge.from)} -> ${labelOf(edge.to)}`;
  const firstStageTitle = model.stages[0]?.title ?? "";
  const lastStageTitle = model.stages[lastStage]?.title ?? "";
  return (
    <figure
      className="flow-diagram relative mb-6 min-w-0"
      data-flow-diagram
      // The collector names the diagram it belongs to from here, not from the
      // accessible name: the shared maximize leg rewrites that label while the
      // figure is promoted, and a collector that renames itself to "Maximized
      // diagram" mid-session is naming the wrong thing.
      data-flow-scope={`Flow: ${firstStageTitle} to ${lastStageTitle}`}
      {...{ [MAXIMIZABLE_ATTRIBUTE]: "diagram" }}
      // The one capability the diagram adds to the shared maximize primitive:
      // the promoted figure gets a scaling, pannable surface.
      data-figure-surface="zoom"
      {...targetProps({
        kind: "figure",
        anchor: model.anchor,
        name: "the whole diagram",
        accessibleName: `Flow diagram, ${model.stages.length} stages from ${firstStageTitle} to ${lastStageTitle}`,
        // The figure is the roving-focus container, so it owns the tab stop.
        tabbable: true,
      })}
    >
      <div
        className="figure-control-bar flow-diagram-controls flex min-w-0 items-center"
        data-flow-controls
      >
        {/* Feedback and proposal controls stay at the left. Viewer controls
            form a right-aligned cluster with distinct zoom, Fit, and maximize
            groups. */}
        <ProposalControls />
        <ViewerControls />
      </div>
      {/* The canvas. Without scripts this is an ordinary scrolling strip, the
          only honest fallback; the viewer leg marks the figure
          data-flow-canvas on init and it becomes a surface you zoom and pan
          instead - no scrollbars, standard trackpad gestures. */}
      <div
        className="flow-diagram-viewport"
        data-flow-viewport
        {...{ [BODY_ATTRIBUTE]: "" }}
      >
        <div className="flow-diagram-sizer" data-flow-sizer>
          <div className="flow-diagram-artboard" data-flow-artboard>
            <div
              className="grid w-max max-w-none items-center"
              style={{ gridTemplateColumns: columns }}
            >
              {model.stages.flatMap((stage, stageIndex) => [
                <StageHeader
                  key={`stage-${stageIndex}`}
                  stage={stage}
                  stageIndex={stageIndex}
                  stageCount={model.stages.length}
                  style={{ gridColumn: cardColumn(stageIndex), gridRow: "1" }}
                />,
                ...stage.nodes.map((node, nodeIndex) => (
                  <Node
                    key={node.id}
                    node={node}
                    stage={stage}
                    spaced={stage.nodes.length > 1}
                    style={{
                      gridColumn: cardColumn(stageIndex),
                      gridRow:
                        stage.nodes.length > 1
                          ? `${nodeIndex + 2}`
                          : `2 / span ${laneCount}`,
                    }}
                  />
                )),
                ...connectorsLeaving({
                  model,
                  stageIndex,
                  laneCount,
                  edgeName,
                  edgeAccessibleName,
                }),
              ])}
            </div>
          </div>
        </div>
      </div>
      {model.footer === undefined || model.footerAnchor === undefined ? null : (
        <figcaption
          data-flow-diagram-footer
          className="mt-4 mb-0 text-center text-sm text-muted"
          {...targetProps({
            kind: "footer",
            anchor: model.footerAnchor,
            name: "the diagram's footer",
            accessibleName: "Diagram note",
          })}
        >
          <span data-flow-field="footer">
            {hastContentToReact(model.footer)}
          </span>
        </figcaption>
      )}
    </figure>
  );
};
