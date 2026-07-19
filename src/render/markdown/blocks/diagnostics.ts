// Defines the positional diagnostic contract shared by MDX parsing and typed
// block validation, plus collection and unknown-error normalization helpers.

import type { Root } from "hast";

type NodePosition = Root["position"];

export type BlockDiagnostic = {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
};

export type DiagnosticCollector = {
  readonly diagnostics: ReadonlyArray<BlockDiagnostic>;
  readonly add: (input: {
    readonly message: string;
    readonly position?: NodePosition;
  }) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Reads a numeric field only after narrowing an unknown parser value.
const numberProperty = ({
  value,
  property,
}: {
  readonly value: unknown;
  readonly property: string;
}): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const candidate = value[property];
  return typeof candidate === "number" ? candidate : undefined;
};

/** Creates an ordered collector so compilation can report every diagnostic. */
export const createDiagnosticCollector = (): DiagnosticCollector => {
  const diagnostics: Array<BlockDiagnostic> = [];
  return {
    diagnostics,
    add: ({ message, position }) => {
      diagnostics.push({
        message,
        ...(position?.start.line === undefined
          ? {}
          : { line: position.start.line }),
        ...(position?.start.column === undefined
          ? {}
          : { column: position.start.column }),
      });
    },
  };
};

// Prefers micromark's structured location, then its rendered range and name.
const pointFromError = (
  error: Record<string, unknown>,
): { readonly line?: number; readonly column?: number } => {
  const place = error["place"];
  const placeStart = isRecord(place) ? place["start"] : undefined;
  const line =
    numberProperty({ value: place, property: "line" }) ??
    numberProperty({ value: placeStart, property: "line" }) ??
    numberProperty({ value: error, property: "line" });
  const column =
    numberProperty({ value: place, property: "column" }) ??
    numberProperty({ value: placeStart, property: "column" }) ??
    numberProperty({ value: error, property: "column" });
  if (line !== undefined || column !== undefined) {
    return { line, column };
  }

  const reason = error["reason"];
  const reasonMatch =
    typeof reason === "string" ? /\((\d+):(\d+)(?:-|\))/u.exec(reason) : null;
  if (reasonMatch !== null) {
    const matchedLine = reasonMatch[1];
    const matchedColumn = reasonMatch[2];
    return {
      ...(matchedLine === undefined ? {} : { line: Number(matchedLine) }),
      ...(matchedColumn === undefined ? {} : { column: Number(matchedColumn) }),
    };
  }

  const name = error["name"];
  const match = typeof name === "string" ? /^(\d+):(\d+)/u.exec(name) : null;
  if (match === null) {
    return {};
  }
  const matchedLine = match[1];
  const matchedColumn = match[2];
  return {
    ...(matchedLine === undefined ? {} : { line: Number(matchedLine) }),
    ...(matchedColumn === undefined ? {} : { column: Number(matchedColumn) }),
  };
};

/** Normalizes parser failures without depending on micromark error classes. */
export const diagnosticFromParseError = (error: unknown): BlockDiagnostic => {
  if (!isRecord(error)) {
    return { message: "Unable to parse MDX" };
  }
  const reason = error["reason"];
  const message = error["message"];
  const normalizedMessage =
    typeof reason === "string"
      ? reason
      : typeof message === "string"
        ? message
        : "Unable to parse MDX";
  return { message: normalizedMessage, ...pointFromError(error) };
};
