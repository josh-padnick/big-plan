// Exposes GrpcMethod's component definition and renders its compiled service
// contract as an always-expanded, static RPC review card headed by the
// authentic proto signature.

import type { Element, ElementContent, Text } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../component-contract.js";
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import { renderReviewChecklist } from "../shared/review-checklist/review-checklist.js";
import {
  renderCardSection,
  renderDefinitionEntry,
  renderDefinitionList,
  renderSectionLabel,
} from "../shared/labeled-section/labeled-section.js";
import {
  compileGrpcMethodComponent,
  type CompiledGrpcError,
  type CompiledGrpcField,
  type CompiledGrpcMethod,
  type GrpcStreamingKind,
} from "./compile-grpc-method.js";

const text = (value: string): Text => ({ type: "text", value });

const KIND_LABELS: Readonly<Record<GrpcStreamingKind, string>> = {
  unary: "Unary",
  serverStreaming: "Server streaming",
  clientStreaming: "Client streaming",
  bidiStreaming: "Bidirectional streaming",
};

const keyword = (value: string): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["text-muted"] },
  children: [text(value)],
});

// The stream keyword is the load-bearing signal Google's reference drops;
// here it is both present and tinted so streaming reads at a glance.
const streamKeyword = (): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["grpc-method-stream", "font-semibold"] },
  children: [text("stream ")],
});

// Renders the literal proto signature with the stream keywords placed by the
// declared kind, so the header states what the .proto would say.
const renderSignature = (model: CompiledGrpcMethod): Element => ({
  type: "element",
  tagName: "span",
  properties: { className: ["grpc-method-signature", "font-mono", "text-sm"] },
  children: [
    keyword("rpc "),
    {
      type: "element",
      tagName: "span",
      properties: {
        className: [
          "font-semibold",
          ...(model.deprecated ? ["text-muted", "line-through"] : []),
        ],
      },
      children: [text(model.name)],
    },
    keyword("("),
    ...(model.kind === "clientStreaming" || model.kind === "bidiStreaming"
      ? [streamKeyword()]
      : []),
    text(model.request),
    keyword(") returns ("),
    ...(model.kind === "serverStreaming" || model.kind === "bidiStreaming"
      ? [streamKeyword()]
      : []),
    text(model.response),
    keyword(")"),
  ],
});

// Renders one message field as a definition pair; proto3 requiredness stays
// prose inside the description, matching the ecosystem.
const renderField = (field: CompiledGrpcField): Element =>
  renderDefinitionEntry({
    properties: { "data-grpc-field": field.side },
    term: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
        },
        children: [text(field.name)],
      },
      ...(field.fieldType === undefined
        ? []
        : [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["font-mono", "text-xs", "text-muted"] },
              children: [text(field.fieldType)],
            } satisfies Element,
          ]),
    ],
    body: field.children,
  });

const renderFieldSection = ({
  label,
  fields,
}: {
  readonly label: string;
  readonly fields: ReadonlyArray<CompiledGrpcField>;
}): Element =>
  renderCardSection({
    children: [
      renderSectionLabel(label),
      renderDefinitionList({ entries: fields.map(renderField) }),
    ],
  });

const renderError = (error: CompiledGrpcError): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["border-b", "border-edge", "py-3", "last:border-b-0"],
    "data-grpc-error": error.code,
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mb-2", "flex", "flex-wrap", "items-center", "gap-2"],
      },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "grpc-method-error-code",
              "inline-flex",
              "items-center",
              "rounded-full",
              "px-2",
              "py-0.5",
              "font-mono",
              "text-[0.6875rem]",
              "leading-4",
              "font-bold",
            ],
          },
          children: [text(error.code)],
        },
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: { className: ["text-sm", "[&>:last-child]:mb-0"] },
      children: [...error.children],
    },
  ],
});

const renderErrors = (errors: ReadonlyArray<CompiledGrpcError>): Element =>
  renderCardSection({
    children: [
      renderSectionLabel("Errors"),
      {
        type: "element",
        tagName: "div",
        properties: { className: ["mt-1"] },
        children: errors.map(renderError),
      },
    ],
  });

const renderProto = (proto: ReadonlyArray<ElementContent>): Element =>
  renderCardSection({
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["mb-3"] },
        children: [renderSectionLabel("Proto")],
      },
      {
        type: "element",
        tagName: "div",
        properties: { className: ["[&>:last-child]:mb-0"] },
        children: [...proto],
      },
    ],
  });

// Builds the complete card while omitting every empty optional region; a
// header-only method is a legitimate compact way to enumerate a service.
const renderGrpcMethodFigure = ({
  model,
}: {
  readonly model: CompiledGrpcMethod;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: [
      "grpc-method",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
    ],
    "data-grpc-method": "",
    "data-grpc-kind": model.kind,
    ...(model.deprecated ? { "data-grpc-deprecated": "" } : {}),
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
          properties: { className: ["font-mono", "text-xs", "text-muted"] },
          children: [text(model.service)],
        },
        {
          type: "element",
          tagName: "div",
          properties: {
            className: ["mt-1", "flex", "flex-wrap", "items-center", "gap-2.5"],
          },
          children: [
            renderSignature(model),
            renderBadgePill({
              label: KIND_LABELS[model.kind],
              classNames: [
                "grpc-method-kind-pill",
                `grpc-method-kind-${model.kind.toLowerCase()}`,
              ],
            }),
            ...(model.deprecated
              ? [
                  renderBadgePill({
                    label: "Deprecated",
                    classNames: ["grpc-method-deprecated"],
                  }),
                ]
              : []),
          ],
        },
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
    ...(model.requestFields.length === 0
      ? []
      : [
          renderFieldSection({
            label: "Request fields",
            fields: model.requestFields,
          }),
        ]),
    ...(model.responseFields.length === 0
      ? []
      : [
          renderFieldSection({
            label: "Response fields",
            fields: model.responseFields,
          }),
        ]),
    ...(model.errors.length === 0 ? [] : [renderErrors(model.errors)]),
    ...(model.proto === undefined ? [] : [renderProto(model.proto)]),
    ...(model.review === undefined
      ? []
      : [renderReviewChecklist({ review: model.review })]),
  ],
});

/** Compiles and renders one GrpcMethod component. */
export const renderGrpcMethod: ComponentRenderer = (input) =>
  renderGrpcMethodFigure({ model: compileGrpcMethodComponent(input) });

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Field" | "Error" | "Proto" | "Review",
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

/** Declares GrpcMethod's renderer and direct-child contract blocks. */
export const GRPC_METHOD_COMPONENT_DEFINITION = {
  render: renderGrpcMethod,
  scopedChildren: {
    Field: scopedChild("Field"),
    Error: scopedChild("Error"),
    Proto: scopedChild("Proto"),
    Review: scopedChild("Review"),
  },
} satisfies ComponentDefinition;
