// Exposes BigDecision's criteria-matrix grammar and renders one weighty
// decision as a standalone comparison card: options as columns, decision
// criteria as rows, terse verdict cells with inline info disclosures.

import type { Element, ElementContent, Text } from "hast";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { INFO_ICON } from "../../../icons/lucide/info.js";
import { MINUS_ICON } from "../../../icons/lucide/minus.js";
import { TRIANGLE_ALERT_ICON } from "../../../icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../../icons/lucide/undo-2.js";
import { X_ICON } from "../../../icons/lucide/x.js";
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
  type BigDecisionTone,
  type CompiledBigDecision,
  type CompiledBigDecisionCriterion,
  type CompiledBigDecisionOption,
  type CompiledBigDecisionScore,
} from "./compile-big-decision.js";

const text = (value: string): Text => ({ type: "text", value });

const TONE_ICONS = {
  good: CHECK_ICON,
  bad: X_ICON,
  mixed: TRIANGLE_ALERT_ICON,
  neutral: MINUS_ICON,
} satisfies Record<BigDecisionTone, typeof CHECK_ICON>;

const statusPill = (status: BigDecisionStatus): Element =>
  renderBadgePill({
    label: status,
    classNames: ["big-decision-status-pill", `big-decision-status-${status}`],
    properties: { "data-decision-status": status },
  });

// A native inline disclosure behind the info glyph: opening it expands the
// owning cell in place, which survives the matrix's scroll container where a
// floating popover would clip.
const renderInfoDisclosure = (
  detail: ReadonlyArray<ElementContent>,
): ReadonlyArray<Element> => {
  if (detail.length === 0) {
    return [];
  }
  return [
    {
      type: "element",
      tagName: "details",
      properties: { className: ["big-decision-info"] },
      children: [
        {
          type: "element",
          tagName: "summary",
          properties: {
            className: [
              "inline-flex",
              "cursor-pointer",
              "align-middle",
              "text-muted",
              "[&>svg]:size-3.5",
            ],
          },
          children: [
            renderLucideIcon({ icon: INFO_ICON, hidden: false }),
            {
              type: "element",
              tagName: "span",
              properties: { className: ["sr-only"] },
              children: [text("More detail")],
            },
          ],
        },
        {
          type: "element",
          tagName: "div",
          properties: {
            className: [
              "big-decision-info-body",
              "mt-1.5",
              "max-w-60",
              "text-xs",
              "font-normal",
              "text-muted",
              "[&>:last-child]:mb-0",
            ],
          },
          children: [...detail],
        },
      ],
    },
  ];
};

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

// One option header card: the selectable identity a reader clicks, whether it
// sits at the top of a matrix column or in the no-criteria stacked fallback.
const renderOptionHead = ({
  option,
  muted,
}: {
  readonly option: CompiledBigDecisionOption;
  readonly muted: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    id: option.id,
    className: [
      "big-decision-option",
      ...(option.chosen ? ["big-decision-option-chosen"] : []),
      ...(muted ? ["big-decision-option-muted"] : []),
      "flex",
      "h-full",
      "min-w-44",
      "items-start",
      "gap-2.5",
      "rounded-md",
      "border",
      "border-edge",
      "bg-surface",
      "px-3",
      "py-2.5",
      "text-left",
      "font-normal",
    ],
    "data-option": "",
    ...(option.recommended ? { "data-option-recommended": "" } : {}),
    ...(option.chosen ? { "data-option-chosen": "" } : {}),
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
                "data-option-title": "",
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
});

const renderScoreCell = (
  score: CompiledBigDecisionScore | undefined,
): Element => ({
  type: "element",
  tagName: "td",
  properties: {
    className: ["align-top", "px-3", "py-2.5"],
    ...(score === undefined ? {} : { "data-score-tone": score.tone }),
  },
  children:
    score === undefined
      ? [text("-")]
      : [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: [
                `big-decision-tone-${score.tone}`,
                "flex",
                "items-start",
                "gap-1.5",
                "[&>svg]:mt-0.5",
                "[&>svg]:size-3.5",
                "[&>svg]:shrink-0",
              ],
            },
            children: [
              renderLucideIcon({ icon: TONE_ICONS[score.tone], hidden: false }),
              {
                type: "element",
                tagName: "span",
                properties: { className: ["min-w-0"] },
                children: [
                  text(score.verdict),
                  ...(score.detail.length === 0 ? [] : [text(" ")]),
                  ...renderInfoDisclosure(score.detail),
                ],
              },
            ],
          },
        ],
});

const renderCriterionHeader = (
  criterion: CompiledBigDecisionCriterion,
): Element => ({
  type: "element",
  tagName: "th",
  properties: {
    scope: "row",
    id: criterion.id,
    className: [
      "big-decision-criterion",
      "min-w-36",
      "align-top",
      "px-3",
      "py-2.5",
      "text-left",
      "text-sm",
      "font-medium",
      "text-ink",
    ],
  },
  children: [
    text(criterion.title),
    ...(criterion.detail.length === 0 ? [] : [text(" ")]),
    ...renderInfoDisclosure(criterion.detail),
  ],
});

// The comparison matrix: criteria as rows, options as columns, so competing
// cells sit side by side instead of a serial scroll apart.
const renderMatrix = (model: CompiledBigDecision): Element => ({
  type: "element",
  tagName: "div",
  properties: { className: ["relative", "mt-2.5", "overflow-x-auto"] },
  children: [
    {
      type: "element",
      tagName: "table",
      properties: {
        className: ["big-decision-matrix", "w-full", "border-collapse"],
      },
      children: [
        {
          type: "element",
          tagName: "thead",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "tr",
              properties: {},
              children: [
                {
                  type: "element",
                  tagName: "th",
                  properties: {
                    scope: "col",
                    className: ["px-3", "py-1.5", "text-left"],
                  },
                  children: [
                    {
                      type: "element",
                      tagName: "span",
                      properties: { className: ["sr-only"] },
                      children: [text("Criterion")],
                    },
                  ],
                },
                ...model.options.map((option): Element => ({
                  type: "element",
                  tagName: "th",
                  properties: {
                    scope: "col",
                    className: ["px-1.5", "py-1.5", "align-top"],
                  },
                  children: [
                    renderOptionHead({
                      option,
                      muted: model.status === "decided" && !option.chosen,
                    }),
                  ],
                })),
              ],
            },
          ],
        },
        {
          type: "element",
          tagName: "tbody",
          properties: {},
          children: model.criteria.map((criterion, index): Element => ({
            type: "element",
            tagName: "tr",
            properties: { className: ["big-decision-matrix-row"] },
            children: [
              renderCriterionHeader(criterion),
              ...model.options.map((option) =>
                renderScoreCell(option.scores[index]),
              ),
            ],
          })),
        },
      ],
    },
  ],
});

// The stacked fallback when a decision declares no criteria: option identity
// cards without a comparison surface.
const renderOptionStack = (model: CompiledBigDecision): Element => ({
  type: "element",
  tagName: "div",
  properties: { className: ["mt-2.5", "grid", "gap-2.5"] },
  children: model.options.map((option) =>
    renderOptionHead({
      option,
      muted: model.status === "decided" && !option.chosen,
    }),
  ),
});

// Long-form option detail collects below the comparison so every column stays
// the same height; each drawer names its option.
const renderDetailDrawers = (
  model: CompiledBigDecision,
): ReadonlyArray<Element> =>
  model.options
    .filter((option) => option.detail.length > 0)
    .map((option) => ({
      type: "element",
      tagName: "details",
      properties: {
        className: [
          "big-decision-details",
          "mt-2.5",
          "border-t",
          "border-edge",
          "pt-2.5",
        ],
        "data-option-details": option.id,
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
          children: [text(`${option.title} details`)],
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
    }));

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

// The cost of changing course later, surfaced beside the question because it
// is the fact a reviewer most needs before committing.
const reversibilityLine = (reversibility: string): Element => ({
  type: "element",
  tagName: "div",
  properties: {
    className: [
      "big-decision-reversibility",
      "flex",
      "items-start",
      "gap-2",
      "px-4",
      "pb-3.5",
      "text-sm",
      "text-muted",
      "[&>svg]:mt-0.5",
      "[&>svg]:size-3.5",
      "[&>svg]:shrink-0",
    ],
    "data-decision-reversibility": "",
  },
  children: [
    renderLucideIcon({ icon: UNDO_2_ICON, hidden: false }),
    {
      type: "element",
      tagName: "span",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["font-semibold", "text-ink"] },
          children: [text("Reversibility: ")],
        },
        text(reversibility),
      ],
    },
  ],
});

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
            "data-decision-question": "",
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
    ...(model.reversibility === undefined
      ? []
      : [reversibilityLine(model.reversibility)]),
    ...(model.chosenOption === undefined
      ? []
      : [outcomeStrip(model.chosenOption)]),
    renderCardSection({
      properties: { "data-decision-options": "" },
      children: [
        renderSectionLabel("Options"),
        model.criteria.length > 0
          ? renderMatrix(model)
          : renderOptionStack(model),
        ...renderDetailDrawers(model),
      ],
    }),
  ],
});

/** Compiles and renders one BigDecision component. */
export const renderBigDecision: ComponentRenderer = (input) =>
  renderBigDecisionFigure({ model: compileBigDecisionComponent(input) });

const bodyPolicy = (name: "Criterion" | "Option" | "Score") => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

const criterionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Criterion"),
});

const scoreDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Score"),
});

const optionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Option"),
  scopedChildren: { Score: scoreDefinition() },
});

/** Declares BigDecision's renderer and recursively scoped authoring grammar. */
export const BIG_DECISION_COMPONENT_DEFINITION = {
  render: renderBigDecision,
  scopedChildren: {
    Criterion: criterionDefinition(),
    Option: optionDefinition(),
  },
} satisfies ComponentDefinition;
