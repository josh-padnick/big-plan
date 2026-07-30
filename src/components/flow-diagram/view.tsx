// Renders a compiled FlowDiagram as a staged diagram: small-caps stage headers over
// content-sized, tone-tinted cards, joined by verb-labeled connectors whose
// arrowheads point subject-to-object, with an explicit branching fork when
// one node feeds several. Placement is inline grid coordinates because
// column and row counts are per-diagram knowledge; colors and connector
// drawing live in the colocated stylesheet.

import type { CSSProperties } from "react";
import type {
  CompiledFlowDiagram,
  CompiledFlowDiagramEdge,
  CompiledFlowDiagramNode,
} from "./compile.js";
import { hastContentToReact } from "../_shared/hast-content/hast-content.js";

const BADGE_CLASSES =
  "flow-diagram-badge ml-[0.4rem] inline-block rounded-full px-2 py-[0.05rem] align-[1px] text-[0.6875rem] font-semibold";

const LABEL_CLASSES = "block text-sm font-semibold text-ink";

const EDGE_LABEL_CLASSES =
  "absolute -top-[1.15rem] left-1/2 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-muted";

// Grid template column widths: card columns size to content, connector
// columns stay narrow so cards dominate, and a fork column is narrower
// still because its branches carry no labels of their own.
const LINK_COLUMN = "5rem";
const FORK_COLUMN = "3rem";

const Node = ({
  node,
  style,
  spaced,
}: {
  readonly node: CompiledFlowDiagramNode;
  readonly style: CSSProperties;
  readonly spaced: boolean;
}) => (
  <div
    data-flow-diagram-node
    data-flow-diagram-tone={node.tone}
    className={`flow-diagram-node rounded-lg border px-[0.85rem] py-2 leading-normal${spaced ? " my-[0.275rem]" : ""}`}
    style={style}
  >
    <strong className={LABEL_CLASSES}>
      {node.label}
      {node.badge === undefined ? null : (
        <span
          data-flow-diagram-badge
          data-flow-diagram-badge-tone={node.badgeTone}
          className={BADGE_CLASSES}
        >
          {node.badge}
        </span>
      )}
    </strong>
    {node.code === undefined ? null : (
      <code className="flow-diagram-node-code block font-mono text-xs text-muted">
        {node.code}
      </code>
    )}
    {node.body.length === 0 ? null : (
      <span className="mt-[0.1rem] block text-[0.8125rem] text-muted">
        {hastContentToReact(node.body)}
      </span>
    )}
  </div>
);

// One straight connector: the line itself, its arrowhead from the
// stylesheet, and the verb label floating above the middle.
const Link = ({
  edge,
  style,
}: {
  readonly edge: CompiledFlowDiagramEdge;
  readonly style: CSSProperties;
}) => (
  <div
    data-flow-diagram-link
    className="flow-diagram-link relative self-center"
    style={style}
  >
    {edge.label === undefined ? null : (
      <span className={EDGE_LABEL_CLASSES}>{edge.label}</span>
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
  const edgeInto = (nodeId: string) =>
    model.edges.find((edge) => edge.to === nodeId);
  return (
    <div data-flow-diagram className="flow-diagram mb-5 overflow-x-auto">
      <div
        className="grid w-max max-w-none items-center"
        style={{ gridTemplateColumns: columns }}
      >
        {model.stages.map((stage, stageIndex) => (
          <p
            key={`stage-${stageIndex}`}
            data-flow-diagram-stage
            className="m-0 mb-2 self-end text-[0.6875rem] font-semibold tracking-[0.09em] uppercase text-muted"
            style={{ gridColumn: cardColumn(stageIndex), gridRow: "1" }}
          >
            {stage.title}
          </p>
        ))}
        {model.stages.map((stage, stageIndex) =>
          stage.nodes.map((node, nodeIndex) => (
            <Node
              key={node.id}
              node={node}
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
        )}
        {model.stages.map((stage, stageIndex) => {
          if (stageIndex === lastStage) {
            return null;
          }
          const connectorColumn = `${stageIndex * 2 + 2}`;
          const next = model.stages[stageIndex + 1];
          if (next === undefined) {
            return null;
          }
          if (next.nodes.length <= 1) {
            const target = next.nodes[0];
            const edge = target === undefined ? undefined : edgeInto(target.id);
            if (edge === undefined) {
              return null;
            }
            return (
              <Link
                key={`link-${stageIndex}`}
                edge={edge}
                style={{
                  gridColumn: connectorColumn,
                  gridRow: `2 / span ${laneCount}`,
                }}
              />
            );
          }
          // The explicit one-to-many fork: a stub leaves the source at the
          // stack's center, and every target row gets its own rail-and-arrow
          // branch, so a lone arrow never stands beside a stack.
          return [
            <div
              key={`stub-${stageIndex}`}
              data-flow-diagram-fork-stub
              className="flow-diagram-fork-stub w-1/2 justify-self-start self-center"
              style={{
                gridColumn: connectorColumn,
                gridRow: `2 / span ${laneCount}`,
              }}
            />,
            ...next.nodes.map((node, nodeIndex) => {
              const label = edgeInto(node.id)?.label;
              return (
                <div
                  key={`branch-${node.id}`}
                  data-flow-diagram-branch={branchPosition({
                    index: nodeIndex,
                    count: next.nodes.length,
                  })}
                  className="flow-diagram-fork-branch relative self-stretch"
                  style={{
                    gridColumn: connectorColumn,
                    gridRow: `${nodeIndex + 2}`,
                  }}
                >
                  <span className="flow-diagram-fork-rail" aria-hidden />
                  {label === undefined ? null : (
                    // The branch's own segment runs from the rail to the
                    // card, so its verb floats over that right half.
                    <span className="absolute top-[calc(50%-1.35rem)] left-3/4 -translate-x-1/2 text-[0.6875rem] whitespace-nowrap text-muted">
                      {label}
                    </span>
                  )}
                </div>
              );
            }),
          ];
        })}
      </div>
      {model.footer === undefined ? null : (
        <p
          data-flow-diagram-footer
          className="mt-[0.9rem] mb-0 text-center text-[0.8125rem] text-muted"
        >
          {hastContentToReact(model.footer)}
        </p>
      )}
    </div>
  );
};
