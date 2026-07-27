// Compiles GrpcMethod's authored attributes and scoped children into a
// render-ready model while collecting every method-contract diagnostic.

import type { Element, ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "./component-contract.js";
import type { DiagnosticCollector } from "./diagnostics.js";

export type GrpcStreamingKind =
  "unary" | "serverStreaming" | "clientStreaming" | "bidiStreaming";

const STREAMING_KINDS: ReadonlyArray<GrpcStreamingKind> = [
  "unary",
  "serverStreaming",
  "clientStreaming",
  "bidiStreaming",
];

export type GrpcFieldSide = "request" | "response";

const FIELD_SIDES: ReadonlyArray<GrpcFieldSide> = ["request", "response"];

// The canonical google.rpc.Code error names (AIP-193), excluding OK because a
// success code is not an error contract.
const GRPC_ERROR_CODES = [
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
] as const;

export type GrpcErrorCode = (typeof GRPC_ERROR_CODES)[number];

export type CompiledGrpcField = {
  readonly side: GrpcFieldSide;
  readonly name: string;
  readonly fieldType?: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGrpcError = {
  readonly code: GrpcErrorCode;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGrpcExample = {
  readonly label?: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGrpcMethod = {
  readonly service: string;
  readonly name: string;
  readonly request: string;
  readonly response: string;
  readonly kind: GrpcStreamingKind;
  readonly deprecated: boolean;
  readonly description: ReadonlyArray<ElementContent>;
  readonly requestFields: ReadonlyArray<CompiledGrpcField>;
  readonly responseFields: ReadonlyArray<CompiledGrpcField>;
  readonly errors: ReadonlyArray<CompiledGrpcError>;
  readonly examples: ReadonlyArray<CompiledGrpcExample>;
  readonly proto?: ReadonlyArray<ElementContent>;
};

const GRPC_METHOD_SCHEMA = {
  service: { kind: "string", required: true, nonEmpty: true },
  name: { kind: "string", required: true, nonEmpty: true },
  request: { kind: "string", required: true, nonEmpty: true },
  response: { kind: "string", required: true, nonEmpty: true },
  kind: { kind: "enum", values: STREAMING_KINDS },
  deprecated: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const FIELD_SCHEMA = {
  in: { kind: "enum", values: FIELD_SIDES, required: true },
  name: { kind: "string", required: true, nonEmpty: true },
  type: { kind: "string" },
} satisfies ComponentAttributeSchema;

const ERROR_SCHEMA = {
  code: { kind: "enum", values: GRPC_ERROR_CODES, required: true },
} satisfies ComponentAttributeSchema;

const EXAMPLE_SCHEMA = {
  label: { kind: "string" },
} satisfies ComponentAttributeSchema;

const EMPTY_SCHEMA = {} satisfies ComponentAttributeSchema;

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

// Reads the declared fence language from a pre > code child, if any.
const fenceLanguage = (node: ElementContent): string | undefined => {
  if (!isElement(node) || node.tagName !== "pre") {
    return undefined;
  }
  const code = node.children.find(
    (child) => isElement(child) && child.tagName === "code",
  );
  if (code === undefined || !isElement(code)) {
    return undefined;
  }
  const classes = Array.isArray(code.properties["className"])
    ? code.properties["className"]
    : [];
  for (const entry of classes) {
    if (typeof entry === "string" && entry.startsWith("language-")) {
      return entry.slice("language-".length);
    }
  }
  return undefined;
};

const isFieldSide = (value: string): value is GrpcFieldSide =>
  FIELD_SIDES.some((side) => side === value);

// Validates one field and preserves its Markdown description; proto3
// requiredness stays prose inside the body, matching the ecosystem.
const compileField = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledGrpcField => {
  const validated = validateComponentAttributes({
    component: "Field",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: FIELD_SCHEMA,
  });
  return {
    side: validated.in ?? "request",
    name: validated.name ?? "",
    ...(validated.type === undefined ? {} : { fieldType: validated.type }),
    children: child.children.filter((node) => !isWhitespace(node)),
  };
};

/** Compiles one GrpcMethod component into the render model. */
export const compileGrpcMethodComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledGrpcMethod => {
  const validated = validateComponentAttributes({
    component: "GrpcMethod",
    attributes,
    position,
    diagnostics,
    schema: GRPC_METHOD_SCHEMA,
  });

  const fieldChildren = scopedChildren.filter(
    (child) => child.name === "Field",
  );
  const identities = new Set<string>();
  for (const child of fieldChildren) {
    const authoredName = child.attributes["name"];
    const authoredSide = child.attributes["in"];
    if (
      typeof authoredName !== "string" ||
      authoredName.trim() === "" ||
      typeof authoredSide !== "string" ||
      !isFieldSide(authoredSide)
    ) {
      continue;
    }
    const identity = `${authoredSide}\u0000${authoredName}`;
    if (identities.has(identity)) {
      diagnostics.add({
        message: `Duplicate Field "${authoredName}" in "${authoredSide}"`,
        position: child.position,
      });
    }
    identities.add(identity);
  }
  const fields = fieldChildren.map((child) =>
    compileField({ child, diagnostics }),
  );

  const errorChildren = scopedChildren.filter(
    (child) => child.name === "Error",
  );
  const codes = new Set<string>();
  const errors: Array<CompiledGrpcError> = [];
  for (const child of errorChildren) {
    const errorValidated = validateComponentAttributes({
      component: "Error",
      attributes: child.attributes,
      position: child.position,
      diagnostics,
      schema: ERROR_SCHEMA,
    });
    const code = errorValidated.code;
    if (code === undefined) {
      continue;
    }
    if (codes.has(code)) {
      diagnostics.add({
        message: `Duplicate Error code "${code}"`,
        position: child.position,
      });
    }
    codes.add(code);
    errors.push({
      code,
      children: child.children.filter((node) => !isWhitespace(node)),
    });
  }

  // Examples repeat so a request payload can sit beside the stream trace
  // that teaches how a streaming method behaves over time.
  const examples = scopedChildren
    .filter((child) => child.name === "Example")
    .map((child) => {
      const exampleValidated = validateComponentAttributes({
        component: "Example",
        attributes: child.attributes,
        position: child.position,
        diagnostics,
        schema: EXAMPLE_SCHEMA,
      });
      const exampleBody = child.children.filter((node) => !isWhitespace(node));
      const onlyChild = exampleBody[0];
      if (
        exampleBody.length !== 1 ||
        onlyChild === undefined ||
        fenceLanguage(onlyChild) === undefined
      ) {
        diagnostics.add({
          message:
            "Example expects exactly one fenced code block and no other content",
          position: child.position,
        });
      }
      return {
        ...(exampleValidated.label === undefined
          ? {}
          : { label: exampleValidated.label }),
        children: exampleBody,
      };
    });

  const protoChildren = scopedChildren.filter(
    (child) => child.name === "Proto",
  );
  for (const duplicate of protoChildren.slice(1)) {
    diagnostics.add({
      message: "GrpcMethod cannot contain more than one Proto",
      position: duplicate.position,
    });
  }
  const protoChild = protoChildren[0];
  let proto: ReadonlyArray<ElementContent> | undefined;
  if (protoChild !== undefined) {
    validateComponentAttributes({
      component: "Proto",
      attributes: protoChild.attributes,
      position: protoChild.position,
      diagnostics,
      schema: EMPTY_SCHEMA,
    });
    const protoBody = protoChild.children.filter((node) => !isWhitespace(node));
    const onlyChild = protoBody[0];
    if (
      protoBody.length !== 1 ||
      onlyChild === undefined ||
      fenceLanguage(onlyChild) !== "proto"
    ) {
      diagnostics.add({
        message:
          "Proto expects exactly one fenced code block with language proto and no other content",
        position: protoChild.position,
      });
    }
    proto = protoBody;
  }

  return {
    service: validated.service ?? "",
    name: validated.name ?? "",
    request: validated.request ?? "",
    response: validated.response ?? "",
    kind: validated.kind ?? "unary",
    deprecated: validated.deprecated === true,
    description: children.filter((node) => !isWhitespace(node)),
    requestFields: fields.filter((field) => field.side === "request"),
    responseFields: fields.filter((field) => field.side === "response"),
    errors,
    examples,
    ...(proto === undefined ? {} : { proto }),
  };
};
