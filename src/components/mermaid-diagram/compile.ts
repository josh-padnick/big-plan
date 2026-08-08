// Compiles one MermaidDiagram into semantic nodes, edges, stable review
// anchors, and two sanitized SVG variants prepared by the document renderer.
// This module never computes coordinates; official Mermaid owns layout.

import type { Element, ElementContent } from "hast";
import { meaningfulChildren } from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import {
  mermaidEdgeAnchor,
  mermaidFigureAnchor,
  mermaidFooterAnchor,
  mermaidNodeAnchor,
} from "./anchors.js";
import {
  parseMermaidSource,
  type MermaidDiagramType,
  type MermaidNodeShape,
  type ParsedMermaid,
} from "./parse.js";
import {
  isMermaidRenderFailure,
  rewriteMermaidSvgTargets,
  type MermaidRenderResult,
} from "./renderer.js";

export type CompiledMermaidDiagramNode = {
  readonly id: string;
  readonly label: string;
  readonly shape: MermaidNodeShape;
  readonly anchor: string;
};

export type CompiledMermaidDiagramEdge = {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style: ParsedMermaid["edges"][number]["style"];
  readonly anchor: string;
};

export type CompiledMermaidDiagram = {
  readonly anchor: string;
  readonly type: MermaidDiagramType | undefined;
  readonly interactive: boolean;
  readonly direction: ParsedMermaid["direction"];
  readonly source: string;
  readonly nodes: ReadonlyArray<CompiledMermaidDiagramNode>;
  readonly edges: ReadonlyArray<CompiledMermaidDiagramEdge>;
  readonly lightSvg: string;
  readonly darkSvg: string;
  readonly footer?: ReadonlyArray<ElementContent>;
  readonly footerAnchor?: string;
};

const COMPONENT_SCHEMA = {} satisfies ComponentAttributeSchema;
const isElement = (node: ElementContent | undefined): node is Element =>
  node?.type === "element";

const textOf = (node: ElementContent): string => {
  if (node.type === "text") return node.value;
  if (!isElement(node)) return "";
  return node.children.map(textOf).join("");
};

const linePosition = ({
  position,
  fenceLine,
  line,
}: {
  readonly position: ComponentCompilerInput["position"];
  readonly fenceLine: number | undefined;
  readonly line: number;
}): ComponentCompilerInput["position"] => {
  if (position === undefined) return position;
  const documentLine =
    fenceLine === undefined ? position.start.line + line - 1 : fenceLine + line;
  return {
    ...position,
    start: { ...position.start, line: documentLine },
    end: { ...position.end, line: documentLine },
  };
};

const addDiagnostics = ({
  parsed,
  position,
  fenceLine,
  diagnostics,
}: {
  readonly parsed: ParsedMermaid;
  readonly position: ComponentCompilerInput["position"];
  readonly fenceLine: number | undefined;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  for (const diagnostic of parsed.diagnostics) {
    diagnostics.add({
      message: diagnostic.message,
      position: linePosition({ position, fenceLine, line: diagnostic.line }),
    });
  }
};

const isMermaidFence = (child: ElementContent): child is Element =>
  isElement(child) &&
  child.tagName === "pre" &&
  child.children.some(
    (nested) =>
      isElement(nested) &&
      nested.tagName === "code" &&
      (Array.isArray(nested.properties.className)
        ? nested.properties.className.includes("language-mermaid")
        : nested.properties.className === "language-mermaid"),
  );

const readBody = ({
  children,
  position,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ElementContent>;
  readonly position: ComponentCompilerInput["position"];
  readonly diagnostics: DiagnosticCollector;
}): {
  readonly source: string;
  readonly fenceLine: number | undefined;
  readonly footer: ReadonlyArray<ElementContent> | undefined;
  readonly canRender: boolean;
} => {
  const meaningful = meaningfulChildren(children);
  const allFences = meaningful.filter(
    (child): child is Element => isElement(child) && child.tagName === "pre",
  );
  const fences = meaningful.filter(isMermaidFence);
  const fence = fences[0];
  if (fences.length !== 1 || fence === undefined) {
    diagnostics.add({
      message: "MermaidDiagram needs exactly one fenced ```mermaid block",
      position,
    });
  }
  if (allFences.some((candidate) => candidate !== fence)) {
    diagnostics.add({
      message:
        "MermaidDiagram does not accept additional fenced code blocks; keep only the one ```mermaid block",
      position,
    });
  }
  if (fence === undefined) {
    return {
      source: "",
      fenceLine: undefined,
      footer: undefined,
      canRender: false,
    };
  }
  const fenceLine = fence.position?.start.line;
  const code = fence.children.find(
    (child) =>
      isElement(child) &&
      child.tagName === "code" &&
      (Array.isArray(child.properties.className)
        ? child.properties.className.includes("language-mermaid")
        : child.properties.className === "language-mermaid"),
  );
  const source = isElement(code) ? textOf(code).trim() : "";
  const metadata = isElement(code) ? code.data?.["meta"] : undefined;
  const canRender = typeof metadata !== "string" || metadata.trim() === "";
  if (!canRender) {
    diagnostics.add({
      message:
        "Mermaid fence metadata is not supported; use exactly ```mermaid on the opening line",
      position: code?.position ?? fence.position ?? position,
    });
  }
  const loose = meaningful.filter(
    (child) =>
      child !== fence && !(isElement(child) && child.tagName === "pre"),
  );
  if (loose.length === 0) {
    return { source, fenceLine, footer: undefined, canRender };
  }
  const paragraph = loose[0];
  if (
    loose.length !== 1 ||
    paragraph === undefined ||
    !isElement(paragraph) ||
    paragraph.tagName !== "p" ||
    meaningful.indexOf(paragraph) < meaningful.indexOf(fence)
  ) {
    diagnostics.add({
      message:
        "The MermaidDiagram footer is one short paragraph after the mermaid fence",
      position,
    });
    return { source, fenceLine, footer: undefined, canRender };
  }
  return { source, fenceLine, footer: paragraph.children, canRender };
};

/** Compiles the MermaidDiagram authoring contract. */
export const compileMermaidDiagramComponent = ({
  attributes,
  children,
  position,
  diagnostics,
  ids,
  validationOnly,
  renderArtifacts,
}: ComponentCompilerInput): CompiledMermaidDiagram => {
  validateComponentAttributes({
    component: "MermaidDiagram",
    attributes,
    position,
    diagnostics,
    schema: COMPONENT_SCHEMA,
  });
  const { source, fenceLine, footer, canRender } = readBody({
    children,
    position,
    diagnostics,
  });
  const parsed = parseMermaidSource(source);
  addDiagnostics({ parsed, position, fenceLine, diagnostics });
  const ordinal = ids?.nextOrdinal({ component: "MermaidDiagram" }) ?? 1;
  const figure = mermaidFigureAnchor(ordinal);
  const nodes = parsed.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    shape: node.shape,
    anchor: mermaidNodeAnchor({ figure, id: node.id }),
  }));
  const occurrences = new Map<string, number>();
  const edges = parsed.edges.map((edge) => {
    const pair = `${edge.from}\u0000${edge.to}`;
    const occurrence = (occurrences.get(pair) ?? 0) + 1;
    occurrences.set(pair, occurrence);
    return {
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      style: edge.style,
      anchor: mermaidEdgeAnchor({
        figure,
        from: edge.from,
        to: edge.to,
        occurrence,
      }),
    };
  });
  const artifact = renderArtifacts?.get(source) as
    MermaidRenderResult | undefined;
  let lightSvg = "";
  let darkSvg = "";
  if (source !== "" && parsed.diagnostics.length === 0 && canRender) {
    if (artifact === undefined) {
      if (validationOnly !== true) {
        diagnostics.add({
          message:
            "Mermaid SVG was not prepared; compile the document through Big Plan's renderer",
          position,
        });
      }
    } else if (isMermaidRenderFailure(artifact)) {
      diagnostics.add({
        message:
          "Mermaid could not render this diagram; check that the source uses valid supported Mermaid syntax",
        position: linePosition({ position, fenceLine, line: 1 }),
      });
    } else {
      try {
        lightSvg = rewriteMermaidSvgTargets({
          svg: artifact.light,
          idNamespace: `bp-mermaid-${ordinal}`,
          nodes,
          edges,
          interactive: parsed.interactive,
          ...(parsed.interactive ? {} : { staticAnchorPrefix: figure }),
        });
        darkSvg = rewriteMermaidSvgTargets({
          svg: artifact.dark,
          idNamespace: `bp-mermaid-${ordinal}`,
          nodes,
          edges,
          interactive: parsed.interactive,
          idSuffix: "--dark",
          ...(parsed.interactive ? {} : { staticAnchorPrefix: figure }),
        });
      } catch (error: unknown) {
        const location =
          position?.start.line === undefined
            ? ""
            : ` at line ${position.start.line}${
                position.start.column === undefined
                  ? ""
                  : `, column ${position.start.column}`
              }`;
        throw new Error(
          `Internal error: Mermaid SVG review targets could not be prepared for MermaidDiagram #${ordinal}${location}`,
          { cause: error },
        );
      }
    }
  }
  return {
    anchor: figure,
    type: parsed.type,
    interactive: parsed.interactive || parsed.type !== undefined,
    direction: parsed.direction,
    source,
    nodes,
    edges,
    lightSvg,
    darkSvg,
    ...(footer === undefined
      ? {}
      : { footer, footerAnchor: mermaidFooterAnchor(figure) }),
  };
};
