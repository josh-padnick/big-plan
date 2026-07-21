// Exposes GraphqlOperation's component definition and renders its compiled
// schema capability as an always-expanded, static operation review card.

import type { Element, Text } from "hast";
import { LOCK_ICON } from "../../../icons/lucide/lock.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../component-contract.js";
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  renderCardSection,
  renderDefinitionEntry,
  renderDefinitionList,
  renderSectionLabel,
} from "../shared/labeled-section/labeled-section.js";
import {
  compileGraphqlOperationComponent,
  type CompiledGraphqlArgument,
  type CompiledGraphqlExample,
  type CompiledGraphqlOperation,
  type CompiledGraphqlReturns,
} from "./compile-graphql-operation.js";

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

const renderArguments = (
  args: ReadonlyArray<CompiledGraphqlArgument>,
): Element =>
  renderCardSection({
    children: [
      renderSectionLabel("Arguments"),
      renderDefinitionList({ entries: args.map(renderArgument) }),
    ],
  });

const renderReturns = (returns: CompiledGraphqlReturns): Element =>
  renderCardSection({
    children: [
      renderSectionLabel("Returns"),
      renderDefinitionList({
        entries: [
          renderDefinitionEntry({
            term: [
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
                },
                children: [text(returns.returnType)],
              },
            ],
            body: returns.children,
          }),
        ],
      }),
    ],
  });

const renderExample = ({
  label,
  example,
}: {
  readonly label: string;
  readonly example: CompiledGraphqlExample;
}): Element =>
  renderCardSection({
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["mb-3"] },
        children: [renderSectionLabel(label)],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["[&>:last-child]:mb-0"] },
        children: [...example.children],
      },
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
      properties: { className: ["bg-surface", "px-4", "py-3"] },
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
    ...(model.args.length === 0 ? [] : [renderArguments(model.args)]),
    ...(model.returns === undefined ? [] : [renderReturns(model.returns)]),
    ...(model.operation === undefined
      ? []
      : [renderExample({ label: "Operation", example: model.operation })]),
    ...(model.variables === undefined
      ? []
      : [renderExample({ label: "Variables", example: model.variables })]),
    ...(model.response === undefined
      ? []
      : [renderExample({ label: "Response", example: model.response })]),
  ],
});

/** Compiles and renders one GraphqlOperation component. */
export const renderGraphqlOperation: ComponentRenderer = (input) =>
  renderGraphqlOperationFigure({
    model: compileGraphqlOperationComponent(input),
  });

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Argument" | "Returns" | "Operation" | "Variables" | "Response",
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
  scopedChildren: {
    Argument: scopedChild("Argument"),
    Returns: scopedChild("Returns"),
    Operation: scopedChild("Operation"),
    Variables: scopedChild("Variables"),
    Response: scopedChild("Response"),
  },
} satisfies ComponentDefinition;
