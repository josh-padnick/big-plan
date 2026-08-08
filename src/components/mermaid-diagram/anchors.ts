// The single owner of MermaidDiagram's stable review addresses and the
// shared data-flow vocabulary consumed by the viewer's diagram leg.

export const MERMAID_ANCHOR_ATTRIBUTE = "data-flow-anchor";
export const MERMAID_ELEMENT_ATTRIBUTE = "data-flow-element";

export type MermaidElementKind = "figure" | "node" | "edge" | "footer";

export const mermaidFigureAnchor = (ordinal: number): string =>
  `component/MermaidDiagram#${ordinal}`;

export const mermaidNodeAnchor = ({
  figure,
  id,
}: {
  readonly figure: string;
  readonly id: string;
}): string => `${figure}/node/${encodeURIComponent(id)}`;

export const mermaidEdgeAnchor = ({
  figure,
  from,
  to,
  occurrence,
}: {
  readonly figure: string;
  readonly from: string;
  readonly to: string;
  readonly occurrence: number;
}): string =>
  `${figure}/edge/${encodeURIComponent(from)}/${encodeURIComponent(to)}${
    occurrence === 1 ? "" : `/${occurrence}`
  }`;

export const mermaidFooterAnchor = (figure: string): string =>
  `${figure}/footer`;

export const mermaidStaticItemAnchor = ({
  figure,
  kind,
  label,
  occurrence,
}: {
  readonly figure: string;
  readonly kind: "node" | "edge";
  readonly label: string;
  readonly occurrence: number;
}): string =>
  `${figure}/${kind}/${encodeURIComponent(label)}${
    occurrence === 1 ? "" : `/${occurrence}`
  }`;
