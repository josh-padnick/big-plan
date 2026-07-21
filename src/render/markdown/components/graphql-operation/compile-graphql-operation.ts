// Compiles GraphqlOperation's authored attributes and scoped children into a
// render-ready model while collecting every operation-contract diagnostic.

import type { Element, ElementContent } from "hast";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
  type ScopedChild,
} from "../component-contract.js";
import type { DiagnosticCollector } from "../diagnostics.js";

export type GraphqlOperationKind = "query" | "mutation" | "subscription";

const OPERATION_KINDS: ReadonlyArray<GraphqlOperationKind> = [
  "query",
  "mutation",
  "subscription",
];

export type CompiledGraphqlArgument = {
  readonly name: string;
  readonly argumentType: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGraphqlReturns = {
  readonly returnType: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGraphqlExample = {
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledGraphqlOperation = {
  readonly kind: GraphqlOperationKind;
  readonly name: string;
  readonly access?: string;
  readonly deprecated: boolean;
  readonly deprecationReason?: string;
  readonly description: ReadonlyArray<ElementContent>;
  readonly args: ReadonlyArray<CompiledGraphqlArgument>;
  readonly returns?: CompiledGraphqlReturns;
  readonly operation?: CompiledGraphqlExample;
  readonly variables?: CompiledGraphqlExample;
  readonly response?: CompiledGraphqlExample;
};

const GRAPHQL_OPERATION_SCHEMA = {
  kind: { kind: "enum", values: OPERATION_KINDS, required: true },
  name: { kind: "string", required: true, nonEmpty: true },
  access: { kind: "string" },
  deprecated: { kind: "booleanShorthand" },
  deprecationReason: { kind: "string" },
} satisfies ComponentAttributeSchema;

const ARGUMENT_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
  type: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const RETURNS_SCHEMA = {
  type: { kind: "string", required: true, nonEmpty: true },
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

// Enforces the shared example-child contract: exactly one fence declaring the
// expected language and nothing else.
const compileExampleChild = ({
  child,
  language,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly language: string;
  readonly diagnostics: DiagnosticCollector;
}): CompiledGraphqlExample => {
  validateComponentAttributes({
    component: child.name,
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: EMPTY_SCHEMA,
  });
  const children = child.children.filter((node) => !isWhitespace(node));
  const onlyChild = children[0];
  if (
    children.length !== 1 ||
    onlyChild === undefined ||
    fenceLanguage(onlyChild) !== language
  ) {
    diagnostics.add({
      message: `${child.name} expects exactly one fenced code block with language ${language} and no other content`,
      position: child.position,
    });
  }
  return { children };
};

// Validates one argument and preserves its Markdown description; the GraphQL
// `!` and `[...]` markers ride inside the literal type text.
const compileArgument = ({
  child,
  diagnostics,
}: {
  readonly child: ScopedChild;
  readonly diagnostics: DiagnosticCollector;
}): CompiledGraphqlArgument => {
  const validated = validateComponentAttributes({
    component: "Argument",
    attributes: child.attributes,
    position: child.position,
    diagnostics,
    schema: ARGUMENT_SCHEMA,
  });
  return {
    name: validated.name ?? "",
    argumentType: validated.type ?? "",
    children: child.children.filter((node) => !isWhitespace(node)),
  };
};

// Reports every child past the first for a single-instance scoped name.
const diagnoseExtras = ({
  children,
  message,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly message: string;
  readonly diagnostics: DiagnosticCollector;
}): void => {
  for (const duplicate of children.slice(1)) {
    diagnostics.add({ message, position: duplicate.position });
  }
};

/** Compiles one GraphqlOperation component into the render model. */
export const compileGraphqlOperationComponent = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
}: Parameters<ComponentRenderer>[0]): CompiledGraphqlOperation => {
  const validated = validateComponentAttributes({
    component: "GraphqlOperation",
    attributes,
    position,
    diagnostics,
    schema: GRAPHQL_OPERATION_SCHEMA,
  });
  if (
    validated.deprecationReason !== undefined &&
    validated.deprecated !== true
  ) {
    diagnostics.add({
      message:
        'Attribute "deprecationReason" requires the "deprecated" attribute',
      position,
    });
  }

  const argumentChildren = scopedChildren.filter(
    (child) => child.name === "Argument",
  );
  const names = new Set<string>();
  for (const child of argumentChildren) {
    const authoredName = child.attributes["name"];
    if (typeof authoredName !== "string" || authoredName.trim() === "") {
      continue;
    }
    if (names.has(authoredName)) {
      diagnostics.add({
        message: `Duplicate Argument "${authoredName}"`,
        position: child.position,
      });
    }
    names.add(authoredName);
  }
  const args = argumentChildren.map((child) =>
    compileArgument({ child, diagnostics }),
  );

  const returnsChildren = scopedChildren.filter(
    (child) => child.name === "Returns",
  );
  diagnoseExtras({
    children: returnsChildren,
    message: "GraphqlOperation cannot contain more than one Returns",
    diagnostics,
  });
  const returnsChild = returnsChildren[0];
  const returnsValidated =
    returnsChild === undefined
      ? undefined
      : validateComponentAttributes({
          component: "Returns",
          attributes: returnsChild.attributes,
          position: returnsChild.position,
          diagnostics,
          schema: RETURNS_SCHEMA,
        });

  const exampleFor = (
    name: "Operation" | "Variables" | "Response",
    language: string,
  ): CompiledGraphqlExample | undefined => {
    const matches = scopedChildren.filter((child) => child.name === name);
    diagnoseExtras({
      children: matches,
      message: `GraphqlOperation cannot contain more than one ${name}`,
      diagnostics,
    });
    const first = matches[0];
    return first === undefined
      ? undefined
      : compileExampleChild({ child: first, language, diagnostics });
  };
  const operation = exampleFor("Operation", "graphql");
  const variables = exampleFor("Variables", "json");
  const response = exampleFor("Response", "json");
  if (variables !== undefined && operation === undefined) {
    const variablesChild = scopedChildren.find(
      (child) => child.name === "Variables",
    );
    diagnostics.add({
      message: "Variables requires an Operation example beside it",
      position: variablesChild?.position ?? position,
    });
  }

  return {
    kind: validated.kind ?? "query",
    name: validated.name ?? "",
    ...(validated.access === undefined ? {} : { access: validated.access }),
    deprecated: validated.deprecated === true,
    ...(validated.deprecationReason === undefined
      ? {}
      : { deprecationReason: validated.deprecationReason }),
    description: children.filter((node) => !isWhitespace(node)),
    args,
    ...(returnsChild === undefined || returnsValidated === undefined
      ? {}
      : {
          returns: {
            returnType: returnsValidated.type ?? "",
            children: returnsChild.children.filter(
              (node) => !isWhitespace(node),
            ),
          },
        }),
    ...(operation === undefined ? {} : { operation }),
    ...(variables === undefined ? {} : { variables }),
    ...(response === undefined ? {} : { response }),
  };
};
