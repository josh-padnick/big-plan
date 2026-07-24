// Exposes BigDecision's recursive scoped grammar and renders one weighty
// decision as a standalone static review card with native detail disclosure.

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
  compileBigDecisionComponent,
  type BigDecisionStatus,
  type CompiledBigDecision,
  type CompiledBigDecisionOption,
  type CompiledBigDecisionTradeoff,
} from "./compile-big-decision.js";

const text = (value: string): Text => ({ type: "text", value });

const statusPill = (status: BigDecisionStatus): Element =>
  renderBadgePill({
    label: status,
    classNames: ["big-decision-status-pill", `big-decision-status-${status}`],
    properties: { "data-decision-status": status },
  });

// Only the signed glyph carries the pro or con color; the text stays plain
// prose ink so the list reads as tradeoffs rather than a code diff.
const renderTradeoff = (tradeoff: CompiledBigDecisionTradeoff): Element => ({
  type: "element",
  tagName: "li",
  properties: {
    className: [
      "big-decision-tradeoff",
      `big-decision-tradeoff-${tradeoff.kind}`,
      "flex",
      "items-start",
      "gap-2",
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
      "big-decision-option-marker",
      ...(chosen ? ["big-decision-option-marker-chosen"] : []),
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
  readonly option: CompiledBigDecisionOption;
  readonly muted: boolean;
}): Element => ({
  type: "element",
  tagName: "article",
  properties: {
    id: option.id,
    className: [
      "big-decision-option",
      ...(option.recommended ? ["big-decision-option-recommended"] : []),
      ...(option.chosen ? ["big-decision-option-chosen"] : []),
      ...(muted ? ["big-decision-option-muted"] : []),
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
                  tagName: "p",
                  properties: {
                    className: ["m-0", "text-sm", "font-semibold", "text-ink"],
                  },
                  children: [text(option.title)],
                },
                ...(option.recommended
                  ? [
                      renderBadgePill({
                        label: "Recommended",
                        classNames: ["big-decision-recommended-pill"],
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
                "big-decision-details",
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

const outcomeStrip = (option: CompiledBigDecisionOption): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [
      "big-decision-outcome",
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

// One standalone bordered card: the header owns the status pill and question,
// and the options section reuses the shared review-card section grammar.
const renderBigDecisionFigure = ({
  model,
}: {
  readonly model: CompiledBigDecision;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    id: model.id,
    className: [
      "big-decision",
      "mb-5",
      "min-w-0",
      "overflow-hidden",
      "rounded-md",
      "border",
      "border-edge",
      "bg-paper",
    ],
    "data-big-decision": "",
    "data-decision-state": model.status,
  },
  children: [
    {
      type: "element",
      tagName: "figcaption",
      properties: { className: ["bg-header", "px-4", "py-3"] },
      children: [
        statusPill(model.status),
        {
          type: "element",
          tagName: "p",
          properties: {
            className: [
              "mt-2",
              "mb-0",
              "text-base",
              "font-semibold",
              "text-ink",
            ],
          },
          children: [text(model.question)],
        },
      ],
    },
    ...(model.context.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: ["px-4", "py-4", "text-sm", "[&>:last-child]:mb-0"],
            },
            children: [...model.context],
          } satisfies Element,
        ]),
    ...(model.chosenOption === undefined
      ? []
      : [outcomeStrip(model.chosenOption)]),
    renderCardSection({
      properties: { "data-decision-options": "" },
      children: [
        renderSectionLabel("Options"),
        {
          type: "element",
          tagName: "div",
          properties: { className: ["mt-2.5", "grid", "gap-2.5"] },
          children: model.options.map((option) =>
            renderOption({
              option,
              muted: model.status === "decided" && !option.chosen,
            }),
          ),
        },
      ],
    }),
  ],
});

/** Compiles and renders one BigDecision component. */
export const renderBigDecision: ComponentRenderer = (input) =>
  renderBigDecisionFigure({ model: compileBigDecisionComponent(input) });

const bodyPolicy = (name: "Option" | "Pro" | "Con") => ({
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

/** Declares BigDecision's renderer and recursively scoped authoring grammar. */
export const BIG_DECISION_COMPONENT_DEFINITION = {
  render: renderBigDecision,
  scopedChildren: { Option: optionDefinition() },
} satisfies ComponentDefinition;
