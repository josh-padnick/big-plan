// Exposes HttpEndpoint's component definition and renders its compiled API
// contract as an always-expanded, static endpoint review card.

import type { Element, ElementContent, Text } from "hast";
import { LOCK_ICON } from "../../../icons/lucide/lock.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../component-contract.js";
import {
  compileHttpEndpointComponent,
  type CompiledHttpEndpoint,
  type CompiledHttpParam,
  type CompiledHttpRequest,
  type CompiledHttpResponse,
} from "./compile-http-endpoint.js";

const text = (value: string): Text => ({ type: "text", value });

const SECTION_LABEL_CLASSES =
  "text-[0.6875rem] leading-4 font-bold tracking-[0.08em] uppercase text-muted";
const CHIP_CLASSES =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] leading-4 font-bold uppercase";

// Splits brace-delimited placeholders from the literal path without treating
// the authored string as markup.
const renderPathChildren = (path: string): ReadonlyArray<ElementContent> =>
  path
    .split(/(\{[^{}]+\})/u)
    .filter((part) => part !== "")
    .map((part) =>
      /^\{[^{}]+\}$/u.test(part)
        ? {
            type: "element",
            tagName: "span",
            properties: {
              className: ["http-endpoint-placeholder", "rounded-sm", "px-0.5"],
            },
            children: [text(part)],
          }
        : text(part),
    );

const renderSectionLabel = (label: string): Element => ({
  type: "element",
  tagName: "div",
  properties: { className: SECTION_LABEL_CLASSES.split(" ") },
  children: [text(label)],
});

// Renders one parameter as a definition pair so its identity and prose remain
// semantically connected even in the script-free document.
const renderParam = (param: CompiledHttpParam): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["border-b", "border-edge", "py-3", "last:border-b-0"],
    "data-http-param-location": param.location,
  },
  children: [
    {
      type: "element",
      tagName: "dt",
      properties: {
        className: ["flex", "flex-wrap", "items-baseline", "gap-2"],
      },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
          },
          children: [text(param.name)],
        },
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "rounded-full",
              "bg-surface",
              "px-2",
              "py-0.5",
              "text-[0.625rem]",
              "leading-4",
              "font-bold",
              "uppercase",
              "text-muted",
            ],
          },
          children: [text(param.location)],
        },
        ...(param.dataType === undefined
          ? []
          : [
              {
                type: "element",
                tagName: "span",
                properties: { className: ["text-xs", "text-muted"] },
                children: [text(param.dataType)],
              } satisfies Element,
            ]),
        ...(param.required
          ? [
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: ["text-[0.6875rem]", "font-bold", "text-ink"],
                },
                children: [text("required")],
              } satisfies Element,
            ]
          : []),
      ],
    },
    {
      type: "element",
      tagName: "dd",
      properties: {
        className: ["mt-1.5", "text-sm", "text-muted", "[&>:last-child]:mb-0"],
      },
      children: [...param.children],
    },
  ],
});

const renderParameters = (
  params: ReadonlyArray<CompiledHttpParam>,
): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: ["border-t", "border-edge", "px-4", "py-4"],
  },
  children: [
    renderSectionLabel("Parameters"),
    {
      type: "element",
      tagName: "dl",
      properties: { className: ["mt-1"] },
      children: params.map(renderParam),
    },
  ],
});

const renderRequest = (request: CompiledHttpRequest): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: ["border-t", "border-edge", "px-4", "py-4"],
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["mb-3", "flex", "flex-wrap", "items-center", "gap-2"],
      },
      children: [
        renderSectionLabel("Request"),
        ...(request.contentType === undefined
          ? []
          : [
              // Media types stay lowercase monospace, the way every API
              // reference prints them; the uppercase chip is for labels.
              {
                type: "element",
                tagName: "span",
                properties: {
                  className: [
                    "inline-flex",
                    "items-center",
                    "rounded-full",
                    "bg-surface",
                    "px-2",
                    "py-0.5",
                    "font-mono",
                    "text-[0.6875rem]",
                    "leading-4",
                    "text-muted",
                  ],
                },
                children: [text(request.contentType)],
              } satisfies Element,
            ]),
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: { className: ["[&>:last-child]:mb-0"] },
      children: [...request.children],
    },
  ],
});

const renderResponse = (response: CompiledHttpResponse): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: ["border-b", "border-edge", "py-3", "last:border-b-0"],
    "data-http-response": response.status,
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
              ...CHIP_CLASSES.split(" "),
              "http-endpoint-status-pill",
              `http-endpoint-status-${response.statusClass}`,
            ],
            "data-http-status-class": response.statusClass,
          },
          children: [text(response.status)],
        },
        ...(response.label === undefined
          ? []
          : [
              {
                type: "element",
                tagName: "span",
                properties: { className: ["text-sm", "text-muted"] },
                children: [text(response.label)],
              } satisfies Element,
            ]),
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["text-sm", "[&>:last-child]:mb-0"],
      },
      children: [...response.children],
    },
  ],
});

const renderResponses = (
  responses: ReadonlyArray<CompiledHttpResponse>,
): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: ["border-t", "border-edge", "px-4", "py-4"],
  },
  children: [
    renderSectionLabel("Responses"),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["mt-1"] },
      children: responses.map(renderResponse),
    },
  ],
});

// Builds the complete card while omitting every empty optional region, making
// a header-only endpoint a deliberate and useful compact rendering.
const renderHttpEndpointFigure = ({
  model,
}: {
  readonly model: CompiledHttpEndpoint;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: [
      "http-endpoint",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
    ],
    "data-http-endpoint": "",
    "data-http-method": model.method,
    ...(model.deprecated ? { "data-http-deprecated": "" } : {}),
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
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  ...CHIP_CLASSES.split(" "),
                  "http-endpoint-method-pill",
                  `http-endpoint-method-${model.method.toLowerCase()}`,
                ],
              },
              children: [text(model.method)],
            },
            {
              type: "element",
              tagName: "span",
              properties: {
                className: [
                  "http-endpoint-path",
                  "font-mono",
                  "text-sm",
                  "font-semibold",
                  ...(model.deprecated ? ["text-muted", "line-through"] : []),
                ],
              },
              children: [...renderPathChildren(model.path)],
            },
            ...(model.summary === undefined
              ? []
              : [
                  {
                    type: "element",
                    tagName: "span",
                    properties: { className: ["text-sm", "text-muted"] },
                    children: [text(model.summary)],
                  } satisfies Element,
                ]),
            ...(model.deprecated
              ? [
                  {
                    type: "element",
                    tagName: "span",
                    properties: {
                      className: [
                        ...CHIP_CLASSES.split(" "),
                        "http-endpoint-deprecated",
                      ],
                    },
                    children: [text("Deprecated")],
                  } satisfies Element,
                ]
              : []),
          ],
        },
        ...(model.auth === undefined
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
                  text(model.auth),
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
            properties: {
              className: ["px-4", "py-4", "[&>:last-child]:mb-0"],
            },
            children: [...model.description],
          } satisfies Element,
        ]),
    ...(model.params.length === 0 ? [] : [renderParameters(model.params)]),
    ...(model.request === undefined ? [] : [renderRequest(model.request)]),
    ...(model.responses.length === 0 ? [] : [renderResponses(model.responses)]),
  ],
});

/** Compiles and renders one HttpEndpoint component. */
export const renderHttpEndpoint: ComponentRenderer = (input) =>
  renderHttpEndpointFigure({ model: compileHttpEndpointComponent(input) });

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Param" | "Request" | "Response",
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

/** Declares HttpEndpoint's renderer and direct-child API contract blocks. */
export const HTTP_ENDPOINT_COMPONENT_DEFINITION = {
  render: renderHttpEndpoint,
  scopedChildren: {
    Param: scopedChild("Param"),
    Request: scopedChild("Request"),
    Response: scopedChild("Response"),
  },
} satisfies ComponentDefinition;
