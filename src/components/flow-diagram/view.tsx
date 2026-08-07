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
  "flow-diagram-badge ml-[0.4rem] inline-block rounded-full px-2 py-[0.05rem] align-[1px] text-[0.6875rem] font-semibold";

const BADGE_TONE_CLASSES: Readonly<Record<"neutral" | "warning", string>> = {
  neutral:
    "bg-[color-mix(in_srgb,var(--ink-c)_7%,transparent)] text-[var(--muted-c)]",
  warning:
    "bg-[color-mix(in_srgb,var(--callout-warning-c)_14%,transparent)] text-[var(--callout-warning-c)]",
};

const NODE_TONE_CLASSES: Readonly<
  Record<CompiledFlowDiagramNode["tone"], string>
> = {
  neutral: "border-edge bg-surface",
  source:
    "border-[color-mix(in_srgb,var(--accent-c)_38%,var(--edge-c))] bg-[color-mix(in_srgb,var(--accent-c)_10%,transparent)]",
  destination:
    "border-[color-mix(in_srgb,var(--callout-note-c)_35%,var(--edge-c))] bg-[color-mix(in_srgb,var(--callout-note-c)_10%,transparent)]",
};

const LABEL_CLASSES = "block text-sm font-semibold text-ink";

const EDGE_LABEL_CLASSES =
  "absolute -top-[1.15rem] left-1/2 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-muted";

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
    className={`flow-diagram-node rounded-lg border px-[0.85rem] py-2 leading-normal ${NODE_TONE_CLASSES[node.tone]}${spaced ? " my-[0.275rem]" : ""}`}
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
        className="flow-diagram-node-code block rounded-none border-0 bg-transparent p-0 font-mono text-xs text-muted"
      >
        {node.code}
      </code>
    )}
    {node.body.length === 0 ? null : (
      <span
        data-flow-field="body"
        className="mt-[0.1rem] block text-[0.8125rem] text-muted"
      >
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

// A hairline between control groups, so "2 notes Show original Revert all
// minus 100% plus Fit Maximize" reads as four units instead of one run-on.
const ToolbarSeparator = ({ id }: { readonly id?: string }) => (
  <span
    className="flow-diagram-toolbar-sep"
    aria-hidden
    {...(id === undefined ? {} : { [id]: "" })}
  />
);

const CONTROL_CLASSES =
  "figure-control inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border-0 bg-transparent px-1 text-muted transition-colors hover:bg-edge hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";

const VIEWER_CONTROL_CLASSES =
  "figure-control inline-flex h-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-4";

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
      className="flow-diagram-zoom inline-flex shrink-0 items-center overflow-hidden rounded-md border border-edge bg-paper"
      role="group"
      aria-label="Diagram zoom"
    >
      <IconControl icon={MINUS_ICON} label="Zoom out" action="out" />
      <button
        type="button"
        className={`${VIEWER_CONTROL_CLASSES} flow-diagram-zoom-readout min-w-14 border-x border-edge px-2 font-sans text-xs tabular-nums`}
        aria-label="Reset zoom to 100%"
        data-tooltip="Reset zoom to 100%"
        data-flow-zoom="reset"
        data-flow-zoom-readout
      >
        100%
      </button>
      <IconControl icon={PLUS_ICON} label="Zoom in" action="in" />
    </span>
    <ToolbarSeparator />
    {/* Fit says its word: beside a maximize control, a second frame-shaped
        glyph reads as a second maximize. */}
    <button
      type="button"
      className={`${VIEWER_CONTROL_CLASSES} flow-diagram-fit gap-1.5 rounded-md border border-edge bg-paper px-2.5 font-sans text-xs font-semibold`}
      aria-label="Fit diagram to width"
      aria-pressed="false"
      data-tooltip="Fit diagram to width"
      data-flow-zoom="fit"
    >
      {lucideIconToReact({ icon: SCAN_ICON, hidden: false })}
      <span>Fit</span>
    </button>
    <ToolbarSeparator />
    <MaximizeButton subject="diagram" size="toolbar" />
  </span>
);

// Proposal chrome: dormant until the reviewer makes a proposal, because a
// diagram nobody has marked up should show no control it cannot act on.
const ProposalControls = () => (
  <>
    <span
      className="flow-diagram-total inline-flex shrink-0 items-center rounded-full px-2 py-[0.05rem] font-sans text-[0.6875rem] font-semibold"
      data-flow-total
      hidden
    />
    <span
      className="flow-diagram-proposal-group inline-flex items-center gap-0.5"
      data-flow-proposal-group
      hidden
    >
      <ToolbarSeparator />
      <button
        type="button"
        className={CONTROL_CLASSES}
        data-flow-show-original
        aria-pressed="false"
      >
        <span className="font-sans text-[0.6875rem] font-semibold">
          Show original
        </span>
      </button>
      <button
        type="button"
        className={CONTROL_CLASSES}
        data-flow-revert-all
        hidden
      >
        {lucideIconToReact({ icon: ROTATE_CCW_ICON, hidden: false })}
        <span className="font-sans text-[0.6875rem] font-semibold">
          Revert all
        </span>
      </button>
    </span>
  </>
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
              className="absolute top-[calc(50%-1.35rem)] left-3/4 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-muted"
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
    className="m-0 mb-2 self-end text-[0.6875rem] font-semibold tracking-[0.09em] uppercase text-subtle"
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
      className="flow-diagram relative mb-5 min-w-0"
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
          className="mt-[0.9rem] mb-0 text-center text-[0.8125rem] text-muted"
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
