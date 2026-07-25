// Exposes SmallDecisionSet's scoped question grammar and renders the compact
// numbered question list a plan poses to its reviewer at the end.

import type { Element, ElementContent, Text } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../component-contract.js";
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  compileSmallDecisionSetComponent,
  type CompiledSmallDecision,
  type CompiledSmallDecisionOption,
  type CompiledSmallDecisionSet,
} from "./compile-small-decision-set.js";

const text = (value: string): Text => ({ type: "text", value });

// The marker is decorative: the future live layer turns it into a control,
// but the static reader answers through comments or chat.
const optionMarker = (): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "small-decision-option-marker",
      "mt-0.5",
      "inline-flex",
      "size-4",
      "shrink-0",
      "rounded-full",
      "border",
    ],
    ariaHidden: "true",
  },
  children: [],
});

// One option row: title and optional Recommended tag on the first line, the
// short detail in muted prose directly beneath, no card chrome.
const renderOption = (option: CompiledSmallDecisionOption): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    id: option.id,
    className: ["flex", "min-w-0", "items-start", "gap-2.5"],
    "data-option": "",
    ...(option.recommended ? { "data-option-recommended": "" } : {}),
  },
  children: [
    optionMarker(),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["min-w-0", "flex-1"] },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: {
            className: ["flex", "flex-wrap", "items-baseline", "gap-2"],
          },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: ["text-sm", "font-semibold", "text-ink"],
                "data-option-title": "",
              },
              children: [text(option.title)],
            },
            ...(option.recommended
              ? [
                  renderBadgePill({
                    label: "Recommended",
                    classNames: ["small-decision-recommended-pill"],
                  }),
                ]
              : []),
          ],
        },
        ...(option.detail.length === 0
          ? []
          : [
              {
                type: "element",
                tagName: "div",
                properties: {
                  className: [
                    "mt-0.5",
                    "text-sm",
                    "text-muted",
                    "[&>:last-child]:mb-0",
                  ],
                },
                children: [...option.detail],
              } satisfies Element,
            ]),
      ],
    },
  ],
});

// One numbered question block: the number anchors scanning down the list the
// way plans previously numbered their open questions in prose.
const renderDecision = ({
  decision,
  index,
}: {
  readonly decision: CompiledSmallDecision;
  readonly index: number;
}): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    id: decision.id,
    className: ["px-4", "py-3.5"],
    "data-small-decision": "",
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: { className: ["flex", "min-w-0", "items-baseline", "gap-2"] },
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: [
              "small-decision-number",
              "shrink-0",
              "text-sm",
              "font-semibold",
              "tabular-nums",
            ],
          },
          children: [text(`${index + 1}.`)],
        },
        {
          type: "element",
          tagName: "p",
          properties: {
            className: ["m-0", "text-sm", "font-semibold", "text-ink"],
            "data-decision-question": "",
          },
          children: [text(decision.question)],
        },
      ],
    },
    ...(decision.context.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: [
                "mt-1.5",
                "pl-6",
                "text-sm",
                "text-muted",
                "[&>:last-child]:mb-0",
              ],
            },
            children: [...decision.context],
          } satisfies Element,
        ]),
    {
      type: "element",
      tagName: "ul",
      properties: {
        className: [
          "mt-2.5",
          "mb-0",
          "grid",
          "list-none",
          "gap-2",
          "p-0",
          "pl-6",
        ],
        "data-decision-options": "",
      },
      children: decision.options.map(renderOption),
    },
  ],
});

const headerChildren = (
  model: CompiledSmallDecisionSet,
): ReadonlyArray<ElementContent> => [
  ...(model.title === undefined
    ? []
    : [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["font-semibold", "text-ink"] },
          children: [text(model.title)],
        } satisfies Element,
      ]),
  {
    type: "element",
    tagName: "span",
    properties: {
      className: [
        "small-decision-set-summary",
        "text-xs",
        "font-semibold",
        "text-muted",
      ],
    },
    children: [
      text(
        `${model.decisions.length} question${
          model.decisions.length === 1 ? "" : "s"
        }`,
      ),
    ],
  },
];

const renderSmallDecisionSetFigure = ({
  model,
}: {
  readonly model: CompiledSmallDecisionSet;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    id: model.id,
    className: [
      "small-decision-set",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
      "bg-paper",
    ],
    "data-small-decision-set": "",
  },
  children: [
    {
      type: "element",
      tagName: "figcaption",
      properties: {
        className: [
          "flex",
          "flex-wrap",
          "items-baseline",
          "justify-between",
          "gap-2",
          "border-b",
          "border-edge",
          "bg-header",
          "px-4",
          "py-3",
        ],
      },
      children: [...headerChildren(model)],
    },
    ...(model.intro.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: [
                "border-b",
                "border-edge",
                "px-4",
                "py-3.5",
                "text-sm",
                "[&>:last-child]:mb-0",
              ],
            },
            children: [...model.intro],
          } satisfies Element,
        ]),
    {
      type: "element",
      tagName: "ol",
      properties: {
        className: ["small-decision-list", "m-0", "list-none", "p-0"],
      },
      children: model.decisions.map((decision, index) =>
        renderDecision({ decision, index }),
      ),
    },
  ],
});

/** Compiles and renders one SmallDecisionSet component. */
export const renderSmallDecisionSet: ComponentRenderer = (input) =>
  renderSmallDecisionSetFigure({
    model: compileSmallDecisionSetComponent(input),
  });

const bodyPolicy = (name: "SmallDecision" | "Option") => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

const optionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Option"),
});

const smallDecisionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("SmallDecision"),
  scopedChildren: { Option: optionDefinition() },
});

/** Declares SmallDecisionSet's renderer and scoped authoring grammar. */
export const SMALL_DECISION_SET_COMPONENT_DEFINITION = {
  render: renderSmallDecisionSet,
  scopedChildren: { SmallDecision: smallDecisionDefinition() },
} satisfies ComponentDefinition;
