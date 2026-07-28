// Exposes GraphqlOperation's component definition and renders its compiled
// schema capability as an always-expanded, static operation review card.

import type { Element, Text } from "hast";
import { LOCK_ICON } from "../../../icons/lucide/lock.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../../../../model/component-contract.js";
import { renderGraphqlOperationStatic } from "../../../../react/graphql-operation/graphql-operation.js";
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  renderCardSection,
  renderDefinitionEntry,
  renderDefinitionList,
  renderExampleBlock,
  renderSectionLabel,
} from "../shared/labeled-section/labeled-section.js";
import {
  compileGraphqlOperationComponent,
  type CompiledGraphqlArgument,
  type CompiledGraphqlExample,
  type CompiledGraphqlField,
  type CompiledGraphqlOperation,
  type CompiledGraphqlResponse,
  type CompiledGraphqlReturns,
} from "../../../../model/compile-graphql-operation.js";

const text = (value: string): Text => ({ type: "text", value });

const monoType = (value: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["font-mono", "text-xs", "text-muted"] },
  children: [text(value)],
});

// Renders one argument as a definition pair; the literal GraphQL type keeps
// its `!` and `[...]` markers because that is how the ecosystem states
// requiredness.
const renderArgument = (argument: CompiledGraphqlArgument): Element =>
  renderDefinitionEntry({
    properties: { "data-graphql-argument": argument.name },
    term: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
        },
        children: [text(argument.name)],
      },
      monoType(argument.argumentType),
    ],
    body: argument.children,
  });

// One expanded field: literal type beside the name, an authored default
// beside that, and the markdown description beneath.
const renderField = (field: CompiledGraphqlField): Element =>
  renderDefinitionEntry({
    properties: { "data-graphql-field": field.side },
    term: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
        },
        children: [text(field.name)],
      },
      monoType(field.fieldType),
      ...(field.defaultValue === undefined
        ? []
        : [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["text-[0.6875rem]", "text-muted"] },
              children: [
                text("default "),
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["font-mono"] },
                  children: [text(field.defaultValue)],
                } satisfies Element,
              ],
            } satisfies Element,
          ]),
    ],
    body: field.children,
  });

// One level of expansion, indented under the argument or return entry it
// details, so the reader gets the shape without leaving the card.
const renderFieldExpansion = (
  fields: ReadonlyArray<CompiledGraphqlField>,
): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["mt-1", "border-l", "border-edge", "pl-4"],
  },
  children: [renderDefinitionList({ entries: fields.map(renderField) })],
});

const renderArguments = ({
  args,
  inputFields,
}: {
  readonly args: ReadonlyArray<CompiledGraphqlArgument>;
  readonly inputFields: ReadonlyArray<CompiledGraphqlField>;
}): Element =>
  renderCardSection({
    children: [
      renderSectionLabel("Arguments"),
      renderDefinitionList({ entries: args.map(renderArgument) }),
      ...(inputFields.length === 0 ? [] : [renderFieldExpansion(inputFields)]),
    ],
  });

const renderReturns = ({
  returns,
  payloadFields,
}: {
  readonly returns?: CompiledGraphqlReturns;
  readonly payloadFields: ReadonlyArray<CompiledGraphqlField>;
}): Element =>
  renderCardSection({
    children: [
      renderSectionLabel("Returns"),
      ...(returns === undefined
        ? []
        : [
            renderDefinitionList({
              entries: [
                renderDefinitionEntry({
                  term: [
                    {
                      type: "element",
                      tagName: "span",
                      properties: {
                        className: [
                          "font-mono",
                          "text-[0.8125rem]",
                          "font-semibold",
                        ],
                      },
                      children: [text(returns.returnType)],
                    },
                  ],
                  body: returns.children,
                }),
              ],
            }),
          ]),
      ...(payloadFields.length === 0
        ? []
        : [renderFieldExpansion(payloadFields)]),
    ],
  });

// Operation, variables, and responses form one executable example, so they
// share one labeled section instead of three sibling sections.
const renderExampleSection = ({
  operation,
  variables,
  responses,
}: {
  readonly operation?: CompiledGraphqlExample;
  readonly variables?: CompiledGraphqlExample;
  readonly responses: ReadonlyArray<CompiledGraphqlResponse>;
}): Element =>
  renderCardSection({
    properties: { "data-graphql-example": "" },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["mb-3"] },
        children: [renderSectionLabel("Example")],
      },
      ...(operation === undefined
        ? []
        : renderExampleBlock({
            label: "Operation",
            children: operation.children,
          })),
      ...(variables === undefined
        ? []
        : renderExampleBlock({
            label: "Variables",
            children: variables.children,
          })),
      ...responses.flatMap((response) =>
        renderExampleBlock({
          label: response.label ?? "Response",
          children: response.children,
        }),
      ),
    ],
  });

// Builds the complete card while omitting every empty optional region; a
// header-only operation is a legitimate compact way to enumerate a schema.
const renderGraphqlOperationFigure = ({
  model,
}: {
  readonly model: CompiledGraphqlOperation;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: [
      "graphql-operation",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
    ],
    "data-graphql-operation": "",
    "data-graphql-kind": model.kind,
    ...(model.deprecated ? { "data-graphql-deprecated": "" } : {}),
  },
  children: [
    {
      type: "element",
      tagName: "header",
      properties: { className: ["bg-header", "px-4", "py-3"] },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: {
            className: ["flex", "flex-wrap", "items-center", "gap-2.5"],
          },
          children: [
            renderBadgePill({
              label: model.kind,
              classNames: [
                "graphql-operation-kind-pill",
                `graphql-operation-kind-${model.kind}`,
              ],
            }),
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  "font-mono",
                  "text-sm",
                  "font-semibold",
                  ...(model.deprecated ? ["text-muted", "line-through"] : []),
                ],
              },
              children: [text(model.name)],
            },
            ...(model.deprecated
              ? [
                  renderBadgePill({
                    label: "Deprecated",
                    classNames: ["graphql-operation-deprecated"],
                  }),
                ]
              : []),
            ...(model.deprecationReason === undefined
              ? []
              : [
                  {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["text-sm", "text-muted"] },
                    children: [text(model.deprecationReason)],
                  } satisfies Element,
                ]),
          ],
        },
        ...(model.access === undefined
          ? []
          : [
              {
                type: "element",
                tagName: "div",
                properties: {
                  className: [
                    "mt-2",
                    "flex",
                    "items-center",
                    "gap-1.5",
                    "text-xs",
                    "text-muted",
                    "[&_svg]:size-3.5",
                    "[&_svg]:shrink-0",
                  ],
                },
                children: [
                  renderLucideIcon({ icon: LOCK_ICON, hidden: false }),
                  text(model.access),
                ],
              } satisfies Element,
            ]),
      ],
    },
    ...(model.description.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["px-4", "py-4", "[&>:last-child]:mb-0"] },
            children: [...model.description],
          } satisfies Element,
        ]),
    ...(model.args.length === 0 && model.inputFields.length === 0
      ? []
      : [
          renderArguments({
            args: model.args,
            inputFields: model.inputFields,
          }),
        ]),
    ...(model.returns === undefined && model.payloadFields.length === 0
      ? []
      : [
          renderReturns({
            ...(model.returns === undefined ? {} : { returns: model.returns }),
            payloadFields: model.payloadFields,
          }),
        ]),
    ...(model.operation === undefined &&
    model.variables === undefined &&
    model.responses.length === 0
      ? []
      : [
          renderExampleSection({
            ...(model.operation === undefined
              ? {}
              : { operation: model.operation }),
            ...(model.variables === undefined
              ? {}
              : { variables: model.variables }),
            responses: model.responses,
          }),
        ]),
  ],
});

/** Compiles and renders one GraphqlOperation component. */
export const renderGraphqlOperation: ComponentRenderer = (input) =>
  renderGraphqlOperationFigure({
    model: compileGraphqlOperationComponent(input),
  });

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name:
    "Argument" | "Field" | "Returns" | "Operation" | "Variables" | "Response",
): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: `${name} bodies cannot contain headings`,
      footnoteReference: `${name} bodies cannot contain footnote references`,
      footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
      registeredComponent: `${name} bodies cannot contain typed components`,
    },
  },
});

/** Declares GraphqlOperation's renderer and direct-child contract blocks. */
export const GRAPHQL_OPERATION_COMPONENT_DEFINITION = {
  render: renderGraphqlOperation,
  compile: compileGraphqlOperationComponent,
  renderStatic: (input) =>
    renderGraphqlOperationStatic(compileGraphqlOperationComponent(input)),
  scopedChildren: {
    Argument: scopedChild("Argument"),
    Field: scopedChild("Field"),
    Returns: scopedChild("Returns"),
    Operation: scopedChild("Operation"),
    Variables: scopedChild("Variables"),
    Response: scopedChild("Response"),
  },
} satisfies ComponentDefinition;
