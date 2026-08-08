// Framework-free semantic gate for MermaidDiagram. Flowchart/graph sources
// receive source-derived node and edge semantics downstream; supported non-flow
// types are checked here before rendering derives semantics from their labels.

export type MermaidDirection = "TB" | "TD" | "BT" | "RL" | "LR";
export type MermaidDiagramType =
  | "flowchart"
  | "graph"
  | "sequenceDiagram"
  | "classDiagram"
  | "stateDiagram"
  | "stateDiagram-v2"
  | "erDiagram"
  | "gantt"
  | "journey"
  | "pie"
  | "mindmap"
  | "timeline"
  | "gitGraph";
export type MermaidNodeShape =
  | "rect"
  | "round"
  | "circle"
  | "diamond"
  | "hexagon"
  | "stadium"
  | "cylinder"
  | "subroutine"
  | "parallelogram"
  | "trapezoid"
  | "asymmetric";

export type ParsedMermaidNode = {
  readonly id: string;
  readonly label: string;
  readonly shape: MermaidNodeShape;
  readonly line: number;
  readonly declared: boolean;
};

export type ParsedMermaidEdge = {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style: "solid" | "dotted" | "thick" | "open" | "cross";
  readonly line: number;
};

export type MermaidParseDiagnostic = {
  readonly line: number;
  readonly message: string;
};

export type ParsedMermaid = {
  readonly type: MermaidDiagramType | undefined;
  readonly direction: MermaidDirection | undefined;
  readonly interactive: boolean;
  readonly nodes: ReadonlyArray<ParsedMermaidNode>;
  readonly edges: ReadonlyArray<ParsedMermaidEdge>;
  readonly diagnostics: ReadonlyArray<MermaidParseDiagnostic>;
};

const DIRECTIONS = new Set<MermaidDirection>(["TB", "TD", "BT", "RL", "LR"]);

const RESERVED_NODE_ID_PATTERN =
  /^(?:style|linkStyle|interpolate|classDef|class|graph|flowchart|swimlane-beta|subgraph|end)(?:-|$)/u;

const STATIC_DIAGRAM_TYPES = new Set<MermaidDiagramType>([
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "gantt",
  "journey",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
]);

const STATIC_INTERACTION_STATEMENT_PATTERN =
  /(?:^|;)\s*(?:click|href|link|links|properties|details|accTitle|accDescr)\b/iu;
const STATIC_STYLE_STATEMENT_PATTERN =
  /(?:^|;)\s*(?:classDef|style|linkStyle|cssClass)\b|:::/iu;
const SEQUENCE_STYLE_STATEMENT_PATTERN = /(?:^|;)\s*(?:rect|box)\b/iu;
const GANTT_STYLE_STATEMENT_PATTERN = /(?:^|;)\s*todayMarker\b/iu;
const STATIC_CLASS_STATEMENT_PATTERN = /^(?:class)\s+(\S+)(.*)$/iu;
const HTML_LABEL_PATTERN = /<\/?[A-Za-z][^>]*>/u;

const SHAPES: ReadonlyArray<{
  readonly open: string;
  readonly close: string;
  readonly shape: MermaidNodeShape;
}> = [
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "((", close: "))", shape: "circle" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[/", close: "/]", shape: "parallelogram" },
  { open: "[\\", close: "\\]", shape: "parallelogram" },
  { open: "[/", close: "\\]", shape: "trapezoid" },
  { open: "[\\", close: "/]", shape: "trapezoid" },
  { open: ">", close: "]", shape: "asymmetric" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
];

const EDGE_OPERATORS: ReadonlyArray<{
  readonly token: string;
  readonly style: ParsedMermaidEdge["style"];
}> = [
  { token: "<-.->", style: "dotted" },
  { token: "<==>", style: "thick" },
  { token: "<-->", style: "solid" },
  { token: "-.->", style: "dotted" },
  { token: "==>", style: "thick" },
  { token: "-->", style: "solid" },
  { token: "--o", style: "open" },
  { token: "--x", style: "cross" },
  { token: "---", style: "solid" },
  { token: "===", style: "thick" },
];

const TEXT_EDGE_FORMS: ReadonlyArray<{
  readonly open: string;
  readonly closes: ReadonlyArray<{
    readonly token: string;
    readonly style: ParsedMermaidEdge["style"];
  }>;
}> = [
  {
    open: "--",
    closes: [
      { token: "-->", style: "solid" },
      { token: "--o", style: "open" },
      { token: "--x", style: "cross" },
      { token: "---", style: "solid" },
    ],
  },
  { open: "==", closes: [{ token: "==>", style: "thick" }] },
  { open: "-.", closes: [{ token: ".->", style: "dotted" }] },
];

const unquote = (label: string): string => {
  const trimmed = label.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
};

const actionable = (line: number, message: string): MermaidParseDiagnostic => ({
  line,
  message,
});

type NodeToken = {
  readonly id: string;
  readonly label: string;
  readonly shape: MermaidNodeShape;
  readonly declared: boolean;
  readonly next: number;
};

const parseNodeToken = ({
  line,
  source,
  start,
}: {
  readonly line: number;
  readonly source: string;
  readonly start: number;
}): NodeToken | MermaidParseDiagnostic => {
  const idMatch = /^[A-Za-z](?:[A-Za-z0-9_]|-(?![-.>]))*/u.exec(
    source.slice(start),
  );
  if (idMatch === null) {
    return actionable(line, "Expected a node id such as source[Plan source]");
  }
  const id = idMatch[0];
  if (RESERVED_NODE_ID_PATTERN.test(id)) {
    return actionable(
      line,
      'Node id "' + id + '" is reserved by Mermaid; choose another id',
    );
  }
  let next = start + id.length;
  const candidates = SHAPES.filter(({ open }) => source.startsWith(open, next));
  if (candidates.length === 0) {
    return { id, label: id, shape: "rect", declared: false, next };
  }
  let shape: (typeof SHAPES)[number] | undefined;
  let close = -1;
  for (const candidate of candidates) {
    const found = source.indexOf(candidate.close, next + candidate.open.length);
    if (found === -1) continue;
    if (
      shape === undefined ||
      found < close ||
      (found === close && candidate.open.length > shape.open.length)
    ) {
      shape = candidate;
      close = found;
    }
  }
  if (shape === undefined) {
    return actionable(line, `Node "${id}" has an unterminated label`);
  }
  const contentStart = next + shape.open.length;
  const label = unquote(source.slice(contentStart, close));
  if (label === "") {
    return actionable(line, `Node "${id}" needs a non-empty label`);
  }
  if (/[<>]/u.test(label)) {
    return actionable(
      line,
      "HTML labels are disabled; use plain text inside the node shape",
    );
  }
  next = close + shape.close.length;
  return { id, label, shape: shape.shape, declared: true, next };
};

const isDiagnostic = (
  value: NodeToken | MermaidParseDiagnostic,
): value is MermaidParseDiagnostic => "message" in value;

const hasStaticClassAssignment = ({
  line,
  type,
}: {
  readonly line: string;
  readonly type: MermaidDiagramType | undefined;
}): boolean =>
  line.split(";").some((statement) => {
    const match = STATIC_CLASS_STATEMENT_PATTERN.exec(statement.trim());
    if (match === null) return false;
    if (type !== "classDiagram") return true;
    const suffix = (match[2] ?? "").trim();
    return suffix !== "" && !suffix.startsWith("{") && !suffix.startsWith("[");
  });

const staticSourceDiagnostic = ({
  line,
  type,
}: {
  readonly line: string;
  readonly type: MermaidDiagramType | undefined;
}): string | undefined => {
  if (line.includes("@{")) {
    return "Mermaid configuration blocks are not supported in v1; use the diagram type's plain declarative syntax";
  }
  if (
    STATIC_STYLE_STATEMENT_PATTERN.test(line) ||
    (type === "sequenceDiagram" &&
      SEQUENCE_STYLE_STATEMENT_PATTERN.test(line)) ||
    (type === "gantt" && GANTT_STYLE_STATEMENT_PATTERN.test(line)) ||
    hasStaticClassAssignment({ line, type })
  ) {
    return "Mermaid style and class-assignment statements are not supported in v1; use the default diagram theme";
  }
  if (STATIC_INTERACTION_STATEMENT_PATTERN.test(line)) {
    return "Mermaid interaction and metadata statements are not supported in v1; keep the static diagram source declarative";
  }
  if (HTML_LABEL_PATTERN.test(line)) {
    return "HTML labels are disabled; use plain text in the static diagram";
  }
  return undefined;
};

const parseStatement = ({
  source,
  line,
  nodes,
  edges,
  diagnostics,
}: {
  readonly source: string;
  readonly line: number;
  readonly nodes: Map<string, ParsedMermaidNode>;
  readonly edges: Array<ParsedMermaidEdge>;
  readonly diagnostics: Array<MermaidParseDiagnostic>;
}): void => {
  let cursor = 0;
  const first = parseNodeToken({ source, line, start: cursor });
  if (isDiagnostic(first)) {
    diagnostics.push(first);
    return;
  }
  const recordNode = (token: NodeToken): void => {
    if (!token.declared) {
      if (!nodes.has(token.id)) {
        nodes.set(token.id, {
          id: token.id,
          label: token.label,
          shape: token.shape,
          line,
          declared: false,
        });
      }
      return;
    }
    const existing = nodes.get(token.id);
    if (existing?.declared === true) {
      diagnostics.push(actionable(line, `Duplicate node id "${token.id}"`));
      return;
    }
    nodes.set(token.id, {
      id: token.id,
      label: token.label,
      shape: token.shape,
      line,
      declared: true,
    });
  };
  recordNode(first);
  cursor = first.next;
  let current = first;
  while (cursor < source.length) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) return;
    const operator = EDGE_OPERATORS.find(({ token }) =>
      source.startsWith(token, cursor),
    );
    let style: ParsedMermaidEdge["style"];
    let label: string | undefined;
    if (operator !== undefined) {
      style = operator.style;
      cursor += operator.token.length;
    } else {
      const form = TEXT_EDGE_FORMS.find(({ open }) =>
        source.startsWith(open, cursor),
      );
      let close:
        | {
            readonly index: number;
            readonly token: string;
            readonly style: ParsedMermaidEdge["style"];
          }
        | undefined;
      if (form !== undefined) {
        const textStart = cursor + form.open.length;
        for (const candidate of form.closes) {
          const index = source.indexOf(candidate.token, textStart);
          if (index !== -1 && (close === undefined || index < close.index)) {
            close = { index, token: candidate.token, style: candidate.style };
          }
        }
      }
      if (form === undefined || close === undefined) {
        diagnostics.push(
          actionable(
            line,
            "Expected a supported edge operator such as -->, -.->, or ==>",
          ),
        );
        return;
      }
      label = unquote(source.slice(cursor + form.open.length, close.index));
      if (label === "") {
        diagnostics.push(actionable(line, "An edge label must not be empty"));
        return;
      }
      style = close.style;
      cursor = close.index + close.token.length;
    }
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (label === undefined && source[cursor] === "|") {
      const end = source.indexOf("|", cursor + 1);
      if (end === -1) {
        diagnostics.push(
          actionable(line, "An edge label must close with a second |"),
        );
        return;
      }
      label = unquote(source.slice(cursor + 1, end));
      if (label === "") {
        diagnostics.push(actionable(line, "An edge label must not be empty"));
        return;
      }
      cursor = end + 1;
    }
    if (label !== undefined && /[<>]/u.test(label)) {
      diagnostics.push(
        actionable(
          line,
          "HTML labels are disabled; use plain text in the edge label",
        ),
      );
      return;
    }
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    const next = parseNodeToken({ source, line, start: cursor });
    if (isDiagnostic(next)) {
      diagnostics.push(next);
      return;
    }
    recordNode(next);
    edges.push({
      from: current.id,
      to: next.id,
      ...(label === undefined ? {} : { label }),
      style,
      line,
    });
    current = next;
    cursor = next.next;
    // Chained syntax is intentionally represented as separate semantic edges.
    if (cursor < source.length && source[cursor] === ";") cursor += 1;
  }
};

/** Parses one Mermaid flowchart/graph source without owning any geometry. */
export const parseMermaidSource = (source: string): ParsedMermaid => {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const diagnostics: Array<MermaidParseDiagnostic> = [];
  const firstLine = (lines[0] ?? "").trim();
  const flowHeader = /^(flowchart|graph)\s+(\S+)$/u.exec(firstLine);
  const firstWord = firstLine.split(/\s+/u)[0] as MermaidDiagramType;
  const type: MermaidDiagramType | undefined =
    flowHeader !== null
      ? (flowHeader[1] as MermaidDiagramType)
      : STATIC_DIAGRAM_TYPES.has(firstWord)
        ? firstWord
        : undefined;
  const interactive = type === "flowchart" || type === "graph";
  let direction: MermaidDirection | undefined = flowHeader?.[2] as
    MermaidDirection | undefined;
  if (flowHeader !== null && !DIRECTIONS.has(direction as MermaidDirection)) {
    diagnostics.push(
      actionable(
        1,
        "Mermaid flowchart and graph diagrams accept only the five directions TB, TD, BT, RL, or LR",
      ),
    );
    direction = undefined;
  } else if (type === undefined) {
    diagnostics.push(
      actionable(
        1,
        "Unsupported Mermaid diagram type; use flowchart, graph, sequenceDiagram, classDiagram, stateDiagram, stateDiagram-v2, erDiagram, gantt, journey, pie, mindmap, timeline, or gitGraph",
      ),
    );
  }
  if (!interactive && type !== undefined) {
    const message = staticSourceDiagnostic({ line: firstLine, type });
    if (message !== undefined) {
      diagnostics.push(actionable(1, message));
    }
  }
  const nodes = new Map<string, ParsedMermaidNode>();
  const edges: Array<ParsedMermaidEdge> = [];
  for (let index = 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (line === "") continue;
    const lineNumber = index + 1;
    if (line.startsWith("%%")) {
      diagnostics.push(
        actionable(
          lineNumber,
          "Mermaid comments and directives are not supported in v1; remove the %% line",
        ),
      );
      continue;
    }
    if (!interactive) {
      const message = staticSourceDiagnostic({ line, type });
      if (message !== undefined) {
        diagnostics.push(actionable(lineNumber, message));
      }
      continue;
    }
    if (/^(?:subgraph|end)\b/iu.test(line)) {
      diagnostics.push(
        actionable(
          lineNumber,
          "Subgraphs are not supported in MermaidDiagram v1; use explicit nodes and edges instead",
        ),
      );
      continue;
    }
    if (
      /^(?:classDef|class|style|linkStyle|click|href|accTitle|accDescr|direction)\b/iu.test(
        line,
      )
    ) {
      diagnostics.push(
        actionable(
          lineNumber,
          "Mermaid configuration, directives, and interaction statements are not supported in v1; use node labels and edges only",
        ),
      );
      continue;
    }
    parseStatement({
      source: line.replace(/;$/u, ""),
      line: lineNumber,
      nodes,
      edges,
      diagnostics,
    });
  }
  for (const edge of edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      diagnostics.push(
        actionable(
          edge.line,
          `Edge references unknown node id "${!nodes.has(edge.from) ? edge.from : edge.to}"`,
        ),
      );
    }
  }
  return {
    type,
    direction,
    interactive,
    nodes: [...nodes.values()],
    edges,
    diagnostics,
  };
};
