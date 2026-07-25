// Exposes BigDecision's criteria-matrix grammar and renders one weighty
// decision as a standalone comparison card: options as columns, decision
// criteria as rows, terse verdict cells with inline info disclosures.

import type { Element, ElementContent, Text } from "hast";
import { CHECK_ICON } from "../../../icons/lucide/check.js";
import { CIRCLE_QUESTION_MARK_ICON } from "../../../icons/lucide/circle-question-mark.js";
import { INFO_ICON } from "../../../icons/lucide/info.js";
import { MAXIMIZE_2_ICON } from "../../../icons/lucide/maximize-2.js";
import { MINIMIZE_2_ICON } from "../../../icons/lucide/minimize-2.js";
import { MINUS_ICON } from "../../../icons/lucide/minus.js";
import { TRIANGLE_ALERT_ICON } from "../../../icons/lucide/triangle-alert.js";
import { UNDO_2_ICON } from "../../../icons/lucide/undo-2.js";
import { X_ICON } from "../../../icons/lucide/x.js";
import { renderLucideIcon } from "../../../icons/lucide-icon.js";
import type { LucideIcon } from "../../../icons/lucide-icon.js";
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
  type BigDecisionReversibilityRating,
  type BigDecisionStatus,
  type BigDecisionTone,
  type CompiledBigDecision,
  type CompiledBigDecisionCriterion,
  type CompiledBigDecisionOption,
  type CompiledBigDecisionReversibility,
  type CompiledBigDecisionScore,
} from "./compile-big-decision.js";

const text = (value: string): Text => ({ type: "text", value });

// Matches the file-tree control look so figure chrome reads as one family.
const EXPAND_BUTTON_CLASSES =
  "big-decision-expand inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-surface p-0 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";

// Full screen stays unavailable without JavaScript; the in-column matrix
// scrolls horizontally on its own, so the static document loses nothing.
const expandButton = (): Element => ({
  type: "element",
  tagName: "button",
  properties: {
    type: "button",
    className: EXPAND_BUTTON_CLASSES.split(" "),
    ariaLabel: "View decision full screen",
    title: "View decision full screen",
    hidden: true,
    "data-decision-expand": "",
  },
  children: [
    renderLucideIcon({ icon: MAXIMIZE_2_ICON, hidden: false }),
    renderLucideIcon({ icon: MINIMIZE_2_ICON, hidden: true }),
  ],
});

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
  icon: LucideIcon = INFO_ICON,
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
            renderLucideIcon({ icon, hidden: false }),
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
    "data-option-control": "",
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
      "flex-1",
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
                id: option.titleId,
                className: ["m-0", "text-sm", "font-semibold", "text-ink"],
                "data-option-title": "",
              },
              children: [text(option.title)],
            },
          ],
        },
        ...(option.summary === undefined
          ? []
          : [
              {
                type: "element",
                tagName: "p",
                properties: {
                  id: option.summaryId,
                  className: ["mt-1", "mb-0", "text-sm", "text-muted"],
                  "data-option-description": "",
                },
                children: [text(option.summary)],
              } satisfies Element,
            ]),
        ...(option.detail.length === 0
          ? []
          : [
              {
                type: "element",
                tagName: "details",
                properties: {
                  className: ["big-decision-details", "mt-1.5"],
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
                    children: [text("Details")],
                  },
                  {
                    type: "element",
                    tagName: "div",
                    properties: {
                      id: option.detailId,
                      className: [
                        "mt-1.5",
                        "text-xs",
                        "text-muted",
                        "[&>:last-child]:mb-0",
                      ],
                      "data-option-description": "",
                    },
                    children: [...option.detail],
                  },
                ],
              } satisfies Element,
            ]),
      ],
    },
  ],
});

// Status pills decorate the option from above its box: Recommended is
// server-rendered, and the runtime Best match tag joins the same row. Matrix
// columns always reserve the row so cards top-align.
const renderOptionColumn = ({
  option,
  muted,
  reserveDecorators,
}: {
  readonly option: CompiledBigDecisionOption;
  readonly muted: boolean;
  readonly reserveDecorators: boolean;
}): Element => ({
  type: "element",
  tagName: "div",
  properties: { className: ["flex", "h-full", "min-w-0", "flex-col"] },
  children: [
    ...(reserveDecorators || option.recommended
      ? [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: [
                "big-decision-option-decorators",
                "mb-1",
                "flex",
                "min-h-[1.375rem]",
                "flex-wrap",
                "items-center",
                "gap-1.5",
              ],
              "data-option-decorators": "",
            },
            children: option.recommended
              ? [
                  renderBadgePill({
                    label: "Recommended",
                    classNames: ["big-decision-recommended-pill"],
                  }),
                ]
              : [],
          } satisfies Element,
        ]
      : []),
    renderOptionHead({ option, muted }),
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
                "[&>svg]:mt-[calc((1lh-0.875rem)/2)]",
                "[&>svg]:size-3.5",
                "[&>svg]:shrink-0",
              ],
            },
            children: [
              renderLucideIcon({ icon: TONE_ICONS[score.tone], hidden: false }),
              {
                type: "element",
                tagName: "span",
                properties: { className: ["sr-only"] },
                children: [text(`Tone: ${score.tone}.`)],
              },
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
  children:
    criterion.detail.length === 0
      ? [text(criterion.title)]
      : [
          {
            type: "element",
            tagName: "details",
            properties: {
              className: ["big-decision-info", "big-decision-criterion-help"],
            },
            children: [
              {
                type: "element",
                tagName: "summary",
                properties: { className: ["cursor-help"] },
                children: [text(criterion.title)],
              },
              {
                type: "element",
                tagName: "div",
                properties: {
                  className: [
                    "big-decision-info-body",
                    "max-w-60",
                    "text-xs",
                    "font-normal",
                    "text-muted",
                    "[&>:last-child]:mb-0",
                  ],
                },
                children: [...criterion.detail],
              },
            ],
          },
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
                    renderOptionColumn({
                      option,
                      muted: model.status === "decided" && !option.chosen,
                      reserveDecorators: true,
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
    renderOptionColumn({
      option,
      muted: model.status === "decided" && !option.chosen,
      reserveDecorators: false,
    }),
  ),
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

const REVERSIBILITY_PHRASES = {
  easy: "Easy to reverse",
  "somewhat-hard": "Somewhat hard to reverse",
  hard: "Hard to reverse",
} satisfies Record<BigDecisionReversibilityRating, string>;

// One fixed explanation ships with the component so every decision teaches
// the field the same way; authored bodies carry the decision-specific why.
const REVERSIBILITY_EXPLAINER =
  "Reversibility is what it would cost to change this decision after implementation starts. Hard-to-reverse choices deserve the most scrutiny now; easy ones can be settled quickly and revisited once there is evidence.";

// The cost of changing course later gets its own section under the options:
// a fixed rating vocabulary keeps decisions comparable, and the info
// disclosure explains why the field exists at all.
const renderReversibilitySection = (
  reversibility: CompiledBigDecisionReversibility,
): Element => ({
  type: "element",
  tagName: "section",
  properties: {
    className: ["border-t", "border-edge", "px-4", "py-4"],
    "data-decision-reversibility": "",
    "data-reversibility-rating": reversibility.rating,
  },
  children: [
    {
      type: "element",
      tagName: "div",
      properties: { className: ["flex", "items-center", "gap-1.5"] },
      children: [
        renderSectionLabel("Reversibility"),
        ...renderInfoDisclosure(
          [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: [text(REVERSIBILITY_EXPLAINER)],
            },
          ],
          CIRCLE_QUESTION_MARK_ICON,
        ),
      ],
    },
    {
      type: "element",
      tagName: "div",
      properties: {
        className: [
          `big-decision-reversibility-${reversibility.rating}`,
          "mt-2.5",
          "flex",
          "items-start",
          "gap-2",
          "text-sm",
          "[&>svg]:mt-[calc((1lh-0.875rem)/2)]",
          "[&>svg]:size-3.5",
          "[&>svg]:shrink-0",
        ],
      },
      children: [
        renderLucideIcon({ icon: UNDO_2_ICON, hidden: false }),
        {
          type: "element",
          tagName: "span",
          properties: { className: ["min-w-0"] },
          children: [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["font-semibold", "text-ink"] },
              children: [text(REVERSIBILITY_PHRASES[reversibility.rating])],
            },
            ...(reversibility.detail.length === 0
              ? []
              : [
                  {
                    type: "element",
                    tagName: "div",
                    properties: {
                      className: ["mt-1", "text-muted", "[&>:last-child]:mb-0"],
                    },
                    children: [...reversibility.detail],
                  } satisfies Element,
                ]),
          ],
        },
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
      properties: {
        className: [
          "flex",
          "items-start",
          "justify-between",
          "gap-3",
          "bg-header",
          "px-4",
          "py-3",
        ],
      },
      children: [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["min-w-0"] },
          children: [
            ...(model.status === "open" ? [] : [statusPill(model.status)]),
            {
              type: "element",
              tagName: "p",
              properties: {
                className: [
                  "mt-2",
                  "mb-0",
                  "first:mt-0",
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
        expandButton(),
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
    ...(model.detail.length === 0
      ? []
      : [
          {
            type: "element",
            tagName: "div",
            properties: { className: ["px-4", "pb-3.5"] },
            children: [
              {
                type: "element",
                tagName: "details",
                properties: {
                  className: ["big-decision-details"],
                  "data-decision-details": "",
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
                        "mt-2",
                        "text-sm",
                        "text-muted",
                        "[&>:last-child]:mb-0",
                      ],
                    },
                    children: [...model.detail],
                  },
                ],
              } satisfies Element,
            ],
          } satisfies Element,
        ]),
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
      ],
    }),
    ...(model.reversibility === undefined
      ? []
      : [renderReversibilitySection(model.reversibility)]),
  ],
});

/** Compiles and renders one BigDecision component. */
export const renderBigDecision: ComponentRenderer = (input) =>
  renderBigDecisionFigure({ model: compileBigDecisionComponent(input) });

const bodyPolicy = (
  name: "Criterion" | "Details" | "Option" | "Reversibility" | "Score",
) => ({
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

const reversibilityDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Reversibility"),
});

/** Declares BigDecision's renderer and recursively scoped authoring grammar. */
export const BIG_DECISION_COMPONENT_DEFINITION = {
  render: renderBigDecision,
  scopedChildren: {
    Criterion: criterionDefinition(),
    Details: {
      kind: "scoped-child",
      markdownBody: bodyPolicy("Details"),
    },
    Option: optionDefinition(),
    Reversibility: reversibilityDefinition(),
  },
} satisfies ComponentDefinition;
