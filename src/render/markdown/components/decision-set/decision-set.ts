// Exposes DecisionSet's recursive scoped grammar and renders its compiled
// decisions as a fully static review surface with native detail disclosure.

import type { Element, Text } from "hast";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { MINUS_ICON } from "../../../icons/lucide/minus.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import {
  type ComponentDefinition,
  type ComponentRenderer,
  type ScopedChildDefinition,
} from "../component-contract.js";
import { renderBadgePill } from "../shared/badge-pill/badge-pill.js";
import {
  renderCardSection,
  renderSectionLabel,
} from "../shared/labeled-section/labeled-section.js";
import {
  compileDecisionSetComponent,
  type CompiledDecision,
  type CompiledDecisionOption,
  type CompiledDecisionSet,
  type CompiledDecisionTradeoff,
  type DecisionStatus,
} from "./compile-decision-set.js";

const text = (value: string): Text => ({ type: "text", value });

const statusPill = (status: DecisionStatus): Element =>
  renderBadgePill({
    label: status,
    classNames: ["decision-set-status-pill", `decision-set-status-${status}`],
    properties: { "data-decision-status": status },
  });

const countLabel = ({
  decisions,
  openCount,
}: {
  readonly decisions: number;
  readonly openCount: number;
}): string => {
  const decisionCount = `${decisions} decision${decisions === 1 ? "" : "s"}`;
  return openCount === 0
    ? decisionCount
    : `${decisionCount} · ${openCount} open`;
};

// The signed glyph is decorative because the text remains the complete
// tradeoff; tint and icon provide redundant scanning cues.
const renderTradeoff = (tradeoff: CompiledDecisionTradeoff): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: [
      "decision-set-tradeoff",
      `decision-set-tradeoff-${tradeoff.kind}`,
      "flex",
      "items-start",
      "gap-2",
      "rounded-sm",
      "px-2.5",
      "py-2",
      "text-sm",
      "[&>svg]:mt-0.5",
      "[&>svg]:size-3.5",
      "[&>svg]:shrink-0",
    ],
    "data-decision-tradeoff": tradeoff.kind,
  },
  children: [
    renderLucideIcon({
      icon: tradeoff.kind === "pro" ? CHECK_ICON : MINUS_ICON,
      hidden: false,
    }),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["min-w-0", "[&>:last-child]:mb-0"] },
      children: [...tradeoff.children],
    },
  ],
});

const optionMarker = (chosen: boolean): Element => ({
  type: "element",
  tagName: "span",
  properties: {
    className: [
      "decision-set-option-marker",
      ...(chosen ? ["decision-set-option-marker-chosen"] : []),
      "inline-flex",
      "size-5",
      "shrink-0",
      "items-center",
      "justify-center",
      "rounded-full",
      "border",
      "[&_svg]:size-3",
    ],
    ariaHidden: "true",
  },
  children: chosen
    ? [renderLucideIcon({ icon: CHECK_ICON, hidden: false })]
    : [],
});

// A chosen card remains structurally identical to the alternatives; state
// classes alter emphasis without hiding any rejected option.
const renderOption = ({
  option,
  muted,
}: {
  readonly option: CompiledDecisionOption;
  readonly muted: boolean;
}): Element => ({
  type: "element",
  tagName: "article",
  properties: {
    id: option.id,
    className: [
      "decision-set-option",
      ...(option.recommended ? ["decision-set-option-recommended"] : []),
      ...(option.chosen ? ["decision-set-option-chosen"] : []),
      ...(muted ? ["decision-set-option-muted"] : []),
      "rounded-md",
      "border",
      "border-edge",
      "bg-surface",
      "px-3.5",
      "py-3",
    ],
    "data-option": "",
    ...(option.recommended ? { "data-option-recommended": "" } : {}),
    ...(option.chosen ? { "data-option-chosen": "" } : {}),
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["flex", "min-w-0", "items-start", "gap-2.5"],
      },
      children: [
        optionMarker(option.chosen),
        {
          type: "element",
          tagName: "div",
          properties: { className: ["min-w-0", "flex-1"] },
          children: [
            {
              type: "element",
              tagName: "div",
              properties: {
                className: ["flex", "flex-wrap", "items-center", "gap-2"],
              },
              children: [
                {
                  type: "element",
                  tagName: "h4",
                  properties: {
                    className: ["m-0", "text-sm", "font-semibold", "text-ink"],
                  },
                  children: [text(option.title)],
                },
                ...(option.recommended
                  ? [
                      renderBadgePill({
                        label: "Recommended",
                        classNames: ["decision-set-recommended-pill"],
                      }),
                    ]
                  : []),
              ],
            },
            ...(option.summary === undefined
              ? []
              : [
                  {
                    type: "element",
                    tagName: "p",
                    properties: {
                      className: ["mt-1", "mb-0", "text-sm", "text-muted"],
                    },
                    children: [text(option.summary)],
                  } satisfies Element,
                ]),
          ],
        },
      ],
    },
    ...(option.tradeoffs.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "ul",
            properties: {
              className: [
                "mt-3",
                "mb-0",
                "grid",
                "list-none",
                "gap-1.5",
                "p-0",
              ],
            },
            children: option.tradeoffs.map(renderTradeoff),
          } satisfies Element,
        ]),
    ...(option.detail.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "details",
            properties: {
              className: [
                "decision-set-details",
                "mt-3",
                "border-t",
                "border-edge",
                "pt-2.5",
              ],
            },
            children: [
              {
                type: "element",
                tagName: "summary",
                properties: {
                  className: [
                    "cursor-pointer",
                    "text-xs",
                    "font-semibold",
                    "text-muted",
                  ],
                },
                children: [text("Details")],
              },
              {
                type: "element",
                tagName: "div",
                properties: {
                  className: [
                    "mt-2.5",
                    "text-sm",
                    "text-muted",
                    "[&>:last-child]:mb-0",
                  ],
                },
                children: [...option.detail],
              },
            ],
          } satisfies Element,
        ]),
  ],
});

const outcomeStrip = (option: CompiledDecisionOption): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [
      "decision-set-outcome",
      "mx-4",
      "mb-4",
      "flex",
      "items-center",
      "gap-2",
      "rounded-md",
      "px-3",
      "py-2.5",
      "text-sm",
      "font-semibold",
      "[&_svg]:size-4",
      "[&_svg]:shrink-0",
    ],
    "data-decision-outcome": "",
  },
  children: [
    renderLucideIcon({ icon: CHECK_ICON, hidden: false }),
    text(`Chosen: ${option.title}`),
  ],
});

const renderDecision = (decision: CompiledDecision): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    id: decision.id,
    className: [
      "decision-set-decision",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
      "bg-paper",
    ],
    "data-decision": "",
    "data-decision-state": decision.status,
  },
  children: [
    {
      type: "element",
      tagName: "header",
      properties: { className: ["bg-header", "px-4", "py-3"] },
      children: [
        statusPill(decision.status),
        {
          type: "element",
          tagName: "h3",
          properties: {
            className: [
              "mt-2",
              "mb-0",
              "text-base",
              "font-semibold",
              "text-ink",
            ],
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
              className: ["px-4", "py-4", "text-sm", "[&>:last-child]:mb-0"],
            },
            children: [...decision.context],
          } satisfies Element,
        ]),
    ...(decision.chosenOption === undefined
      ? []
      : [outcomeStrip(decision.chosenOption)]),
    renderCardSection({
      properties: { "data-decision-options": "" },
      children: [
        renderSectionLabel("Options"),
        {
          type: "element",
          tagName: "div",
          properties: { className: ["mt-2.5", "grid", "gap-2.5"] },
          children: decision.options.map((option) =>
            renderOption({
              option,
              muted: decision.status === "decided" && !option.chosen,
            }),
          ),
        },
      ],
    }),
  ],
});

const renderDecisionSetFigure = ({
  model,
}: {
  readonly model: CompiledDecisionSet;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: [
      "decision-set",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
    ],
    "data-decision-set": "",
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
          "bg-header",
          "px-4",
          "py-3",
        ],
      },
      children: [
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
              "decision-set-summary",
              "text-xs",
              "font-semibold",
              "text-muted",
            ],
          },
          children: [
            text(
              countLabel({
                decisions: model.decisions.length,
                openCount: model.openCount,
              }),
            ),
          ],
        },
      ],
    },
    ...(model.intro.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: ["px-4", "py-4", "[&>:last-child]:mb-0"],
            },
            children: [...model.intro],
          } satisfies Element,
        ]),
    {
      type: "element",
      tagName: "div",
      properties: {
        className: ["grid", "gap-3", "border-t", "border-edge", "p-3"],
      },
      children: model.decisions.map(renderDecision),
    },
  ],
});

/** Compiles and renders one DecisionSet component. */
export const renderDecisionSet: ComponentRenderer = (input) =>
  renderDecisionSetFigure({ model: compileDecisionSetComponent(input) });

const bodyPolicy = (name: "Decision" | "Option" | "Pro" | "Con") => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

const tradeoffDefinition = (name: "Pro" | "Con"): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy(name),
});

const optionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Option"),
  scopedChildren: {
    Pro: tradeoffDefinition("Pro"),
    Con: tradeoffDefinition("Con"),
  },
});

const decisionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Decision"),
  scopedChildren: { Option: optionDefinition() },
});

/** Declares DecisionSet's renderer and recursively scoped authoring grammar. */
export const DECISION_SET_COMPONENT_DEFINITION = {
  render: renderDecisionSet,
  scopedChildren: { Decision: decisionDefinition() },
} satisfies ComponentDefinition;
