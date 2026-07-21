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
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import { renderReviewChecklist } from "../shared/review-checklist/review-checklist.js";
import {
  renderCardSection,
  renderDefinitionEntry,
  renderDefinitionList,
  renderSectionLabel,
} from "../shared/labeled-section/labeled-section.js";
import {
  compileHttpEndpointComponent,
  type CompiledHttpEndpoint,
  type CompiledHttpParam,
  type CompiledHttpRequest,
  type CompiledHttpResponse,
} from "./compile-http-endpoint.js";

const text = (value: string): Text => ({ type: "text", value });

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

// Renders one parameter as a definition pair so its identity and prose remain
// semantically connected even in the script-free document. The location badge
// is gone: each parameter now lives under an explicit location section, so a
// per-row badge would restate the section label.
const renderParam = (param: CompiledHttpParam): Element =>
  renderDefinitionEntry({
    properties: { "data-http-param-location": param.location },
    term: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["font-mono", "text-[0.8125rem]", "font-semibold"],
        },
        children: [text(param.name)],
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
        : [
            // Optional-ness is a visual property beside the name, never a
            // separate cell; an authored default rides right next to it.
            {
              type: "element",
              tagName: "span",
              properties: { className: ["text-[0.6875rem]", "text-muted"] },
              children: [text("optional")],
            } satisfies Element,
            ...(param.defaultValue === undefined
              ? []
              : [
                  {
                    type: "element",
                    tagName: "span",
                    properties: {
                      className: ["text-[0.6875rem]", "text-muted"],
                    },
                    children: [
                      text("default "),
                      {
                        type: "element",
                        tagName: "span",
                        properties: { className: ["font-mono"] },
                        children: [text(param.defaultValue)],
                      } satisfies Element,
                    ],
                  } satisfies Element,
                ]),
          ]),
    ],
    body: param.children,
  });

// Each non-body location gets its own labeled section, so where a parameter
// travels is stated by the section instead of inferred from a badge.
const PARAM_GROUPS: ReadonlyArray<{
  readonly location: CompiledHttpParam["location"];
  readonly label: string;
}> = [
  { location: "path", label: "Path parameters" },
  { location: "query", label: "Query parameters" },
  { location: "header", label: "Headers" },
];

const renderParamGroups = (
  params: ReadonlyArray<CompiledHttpParam>,
): ReadonlyArray<Element> =>
  PARAM_GROUPS.flatMap(({ location, label }) => {
    const grouped = params.filter((param) => param.location === location);
    return grouped.length === 0
      ? []
      : [
          renderCardSection({
            children: [
              renderSectionLabel(label),
              renderDefinitionList({ entries: grouped.map(renderParam) }),
            ],
          }),
        ];
  });

// Media types stay lowercase monospace, the way every API reference prints
// them; the uppercase chip is for labels.
const contentTypeChip = (contentType: string): Element => ({
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
  children: [text(contentType)],
});

// The Request section states what the body IS: its declared type and media
// type up front, the body fields describing that type's parameters, then the
// example demonstrating it. Body Params live here, not among the transport
// parameters, because they describe the payload's shape.
const renderRequest = ({
  request,
  bodyParams,
}: {
  readonly request?: CompiledHttpRequest;
  readonly bodyParams: ReadonlyArray<CompiledHttpParam>;
}): Element =>
  renderCardSection({
    children: [
      {
        type: "element",
        tagName: "div",
        properties: {
          className: ["mb-3", "flex", "flex-wrap", "items-center", "gap-2"],
        },
        children: [
          renderSectionLabel("Request body"),
          ...(request?.bodyType === undefined
            ? []
            : [
                {
                  type: "element",
                  tagName: "span",
                  properties: {
                    className: [
                      "font-mono",
                      "text-[0.8125rem]",
                      "font-semibold",
                    ],
                    "data-http-body-type": "",
                  },
                  children: [text(request.bodyType)],
                } satisfies Element,
              ]),
          ...(request?.contentType === undefined
            ? []
            : [contentTypeChip(request.contentType)]),
        ],
      },
      ...(bodyParams.length === 0
        ? []
        : [
            {
              type: "element",
              tagName: "div",
              properties: { className: ["mb-3"] },
              children: [
                renderDefinitionList({
                  entries: bodyParams.map(renderParam),
                }),
              ],
            } satisfies Element,
          ]),
      ...(request === undefined || request.children.length === 0
        ? []
        : [
            {
              type: "element",
              tagName: "div",
              properties: { className: ["[&>:last-child]:mb-0"] },
              children: [...request.children],
            } satisfies Element,
          ]),
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
        renderBadgePill({
          label: response.status,
          classNames: [
            "http-endpoint-status-pill",
            `http-endpoint-status-${response.statusClass}`,
          ],
          properties: { "data-http-status-class": response.statusClass },
        }),
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
): Element =>
  renderCardSection({
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
            renderBadgePill({
              label: model.method,
              classNames: [
                "http-endpoint-method-pill",
                `http-endpoint-method-${model.method.toLowerCase()}`,
              ],
            }),
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
                  renderBadgePill({
                    label: "Deprecated",
                    classNames: ["http-endpoint-deprecated"],
                  }),
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
    ...renderParamGroups(model.params),
    ...(model.request === undefined &&
    !model.params.some((param) => param.location === "body")
      ? []
      : [
          renderRequest({
            ...(model.request === undefined ? {} : { request: model.request }),
            bodyParams: model.params.filter(
              (param) => param.location === "body",
            ),
          }),
        ]),
    ...(model.responses.length === 0 ? [] : [renderResponses(model.responses)]),
    ...(model.review === undefined
      ? []
      : [renderReviewChecklist({ review: model.review })]),
  ],
});

/** Compiles and renders one HttpEndpoint component. */
export const renderHttpEndpoint: ComponentRenderer = (input) =>
  renderHttpEndpointFigure({ model: compileHttpEndpointComponent(input) });

// Uses per-child message text while keeping one declarative body policy shape.
const scopedChild = (
  name: "Param" | "Request" | "Response" | "Review",
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
    Review: scopedChild("Review"),
  },
} satisfies ComponentDefinition;
