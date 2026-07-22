// Compiles HttpEndpoint's authored attributes and scoped children into a
// render-ready model while collecting every endpoint-contract diagnostic.

import type { Element, ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "../component-contract.js";
import type { DiagnosticCollector } from "../diagnostics.js";

export type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export type HttpParamLocation = "path" | "query" | "header" | "body";

const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const PARAM_LOCATIONS: ReadonlyArray<HttpParamLocation> = [
  "path",
  "query",
  "header",
  "body",
];

export type HttpStatusClass =
  "informational" | "success" | "redirect" | "client-error" | "server-error";

export type CompiledHttpParam = {
  readonly name: string;
  readonly location: HttpParamLocation;
  readonly dataType?: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledHttpRequest = {
  readonly contentType?: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledHttpResponse = {
  readonly status: string;
  readonly statusClass: HttpStatusClass;
  readonly label?: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledHttpEndpoint = {
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary?: string;
  readonly auth?: string;
  readonly deprecated: boolean;
  readonly description: ReadonlyArray<ElementContent>;
  readonly params: ReadonlyArray<CompiledHttpParam>;
  readonly request?: CompiledHttpRequest;
  readonly responses: ReadonlyArray<CompiledHttpResponse>;
};

const HTTP_ENDPOINT_SCHEMA = {
  method: { kind: "enum", values: HTTP_METHODS, required: true },
  path: { kind: "string", required: true, nonEmpty: true },
  summary: { kind: "string" },
  auth: { kind: "string" },
  deprecated: { kind: "booleanShorthand" },
} satisfies ComponentAttributeSchema;

const PARAM_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
  in: { kind: "enum", values: PARAM_LOCATIONS, required: true },
  type: { kind: "string" },
  required: { kind: "booleanShorthand" },
  default: { kind: "string" },
} satisfies ComponentAttributeSchema;

const REQUEST_SCHEMA = {
  contentType: { kind: "string" },
} satisfies ComponentAttributeSchema;

const RESPONSE_SCHEMA = {
  status: { kind: "string", required: true },
  label: { kind: "string" },
} satisfies ComponentAttributeSchema;

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const isWhitespace = (node: ElementContent): boolean =>
  node.type === "text" && /^\s*$/u.test(node.value);

const isFence = (node: ElementContent): boolean =>
  isElement(node) &&
  node.tagName === "pre" &&
  node.children.some((child) => isElement(child) && child.tagName === "code");

const isParamLocation = (value: string): value is HttpParamLocation =>
  PARAM_LOCATIONS.some((location) => location === value);

// Counts fences recursively so response prose cannot hide an extra fenced
// example inside a quote or list item.
const countFences = (children: ReadonlyArray<ElementContent>): number => {
  let count = 0;
  for (const child of children) {
    if (isFence(child)) {
      count += 1;
    } else if (isElement(child)) {
      count += countFences(child.children);
    }
  }
  return count;
};

/** Maps an HTTP status to the palette class used by the renderer. */
export const httpStatusClass = (status: string): HttpStatusClass => {
  switch (status[0]) {
    case "2":
      return "success";
    case "3":
      return "redirect";
    case "4":
      return "client-error";
    case "5":
      return "server-error";
    default:
      return "informational";
  }
};

// Validates one parameter and preserves its Markdown description for the
// renderer, using harmless fallbacks only after diagnostics are recorded.
const compileParam = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledHttpParam => {
  const validated = validateComponentAttributes({
    component: "Param",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: PARAM_SCHEMA,
  });
  if (validated.default !== undefined && validated.required === true) {
    diagnostics.add({
      message: 'Attribute "default" is only valid on an optional Param',
      position: child.position,
    });
  }
  return {
    name: validated.name ?? "",
    location: validated.in ?? "query",
    ...(validated.type === undefined ? {} : { dataType: validated.type }),
    required: validated.required === true,
    ...(validated.default === undefined || validated.required === true
      ? {}
      : { defaultValue: validated.default }),
    children: child.children.filter((node) => !isWhitespace(node)),
  };
};

// Validates the request header and enforces its one-fence-only body contract.
const compileRequest = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledHttpRequest => {
  const validated = validateComponentAttributes({
    component: "Request",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: REQUEST_SCHEMA,
  });
  const children = child.children.filter((node) => !isWhitespace(node));
  const onlyChild = children[0];
  if (children.length !== 1 || onlyChild === undefined || !isFence(onlyChild)) {
    diagnostics.add({
      message:
        "Request expects exactly one fenced code block and no other content",
      position: child.position,
    });
  }
  return {
    ...(validated.contentType === undefined
      ? {}
      : { contentType: validated.contentType }),
    children,
  };
};

// Validates one response and limits its otherwise-free Markdown body to one
// fenced example, wherever that fence is nested.
const compileResponse = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledHttpResponse => {
  const validated = validateComponentAttributes({
    component: "Response",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: RESPONSE_SCHEMA,
  });
  const status = validated.status ?? "";
  if (validated.status !== undefined && !/^[1-5]\d\d$/u.test(status)) {
    diagnostics.add({
      message:
        'Attribute "status" on Response must be a three-digit HTTP status from 100 to 599',
      position: child.position,
    });
  }
  if (countFences(child.children) > 1) {
    diagnostics.add({
      message: "Response bodies cannot contain more than one fenced code block",
      position: child.position,
    });
  }
  return {
    status,
    statusClass: httpStatusClass(status),
    ...(validated.label === undefined ? {} : { label: validated.label }),
    children: child.children.filter((node) => !isWhitespace(node)),
  };
};

// Diagnoses duplicate parameter identities and returns the location-grouped
// order expected by the review card without disturbing authored order.
const groupParams = ({
  entries,
  diagnostics,
}: {
  readonly entries: ReadonlyArray<{
    readonly child: ScopedChild;
    readonly param: CompiledHttpParam;
  }>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<CompiledHttpParam> => {
  const identities = new Set<string>();
  for (const { child } of entries) {
    const authoredName = child.attributes["name"];
    const authoredLocation = child.attributes["in"];
    if (
      typeof authoredName !== "string" ||
      authoredName.trim() === "" ||
      typeof authoredLocation !== "string" ||
      !isParamLocation(authoredLocation)
    ) {
      continue;
    }
    const identity = `${authoredLocation}\u0000${authoredName}`;
    if (identities.has(identity)) {
      diagnostics.add({
        message: `Duplicate Param "${authoredName}" in "${authoredLocation}"`,
        position: child.position,
      });
    }
    identities.add(identity);
  }
  return PARAM_LOCATIONS.flatMap((location) =>
    entries
      .filter(({ param }) => param.location === location)
      .map(({ param }) => param),
  );
};

/** Compiles one HttpEndpoint component into the model consumed by rendering. */
export const compileHttpEndpointComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledHttpEndpoint => {
  const validated = validateComponentAttributes({
    component: "HttpEndpoint",
    attributes,
    position,
    diagnostics,
    schema: HTTP_ENDPOINT_SCHEMA,
  });
  const paramEntries = scopedChildren
    .filter((child) => child.name === "Param")
    .map((child) => ({
      child,
      param: compileParam({ child, diagnostics }),
    }));
  const requestChildren = scopedChildren.filter(
    (child) => child.name === "Request",
  );
  const requests = requestChildren.map((child) =>
    compileRequest({ child, diagnostics }),
  );
  for (const duplicate of requestChildren.slice(1)) {
    diagnostics.add({
      message: "HttpEndpoint cannot contain more than one Request",
      position: duplicate.position,
    });
  }
  const responseEntries = scopedChildren
    .filter((child) => child.name === "Response")
    .map((child) => ({
      child,
      response: compileResponse({ child, diagnostics }),
    }));
  const statuses = new Set<string>();
  for (const { child, response } of responseEntries) {
    if (!/^[1-5]\d\d$/u.test(response.status)) {
      continue;
    }
    if (statuses.has(response.status)) {
      diagnostics.add({
        message: `Duplicate Response status "${response.status}"`,
        position: child.position,
      });
    }
    statuses.add(response.status);
  }

  return {
    method: validated.method ?? "GET",
    path: validated.path ?? "",
    ...(validated.summary === undefined ? {} : { summary: validated.summary }),
    ...(validated.auth === undefined ? {} : { auth: validated.auth }),
    deprecated: validated.deprecated === true,
    description: children.filter((node) => !isWhitespace(node)),
    params: groupParams({ entries: paramEntries, diagnostics }),
    ...(requests[0] === undefined ? {} : { request: requests[0] }),
    responses: responseEntries.map(({ response }) => response),
  };
};
