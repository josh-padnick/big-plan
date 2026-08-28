// Owns the semantic Markdown shared by the three decision component slices,
// including the same weighted-total calculation the React view consumes.

import {
  markdownBullet,
  markdownFromHast,
  markdownHeading,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownContext,
} from "./markdown-export.js";
import {
  weightedDecisionTotal,
  type CompiledDecisionCard,
  type CompiledDecisionCardCriterion,
  type CompiledDecisionCardOption,
} from "./decision-card.js";

const statusLabel = (model: CompiledDecisionCard): string =>
  model.status === "open" && model.interaction === "audit"
    ? "Proposed"
    : `${model.status[0]?.toUpperCase() ?? ""}${model.status.slice(1)}`;

const criterionLabel = (criterion: CompiledDecisionCardCriterion): string =>
  markdownInlineText(
    `${criterion.title}${criterion.impact === undefined ? "" : ` (impact ${criterion.impact}/5)`}`,
  );

const optionLabels = (
  option: CompiledDecisionCardOption,
): ReadonlyArray<string> => [
  ...(option.chosen ? ["Chosen"] : []),
  ...(option.recommended ? ["Recommended"] : []),
];

/** Renders one decision card without browser-only selection state. */
export const decisionCardMarkdown = (
  model: CompiledDecisionCard,
  { headingOffset }: ComponentMarkdownContext,
): string => {
  const outcome =
    model.chosenOption ?? model.options.find((option) => option.recommended);
  const sections: Array<string> = [
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: `Decision: ${markdownInlineText(model.question)}`,
    }),
    `**Status:** ${statusLabel(model)}${model.isCritical ? " · Critical" : ""}`,
  ];
  const context = markdownFromHast(model.context);
  if (context !== "") sections.push(context);
  if (outcome !== undefined) {
    sections.push(
      `**${outcome.chosen ? "Decision" : "Recommendation"}:** ${markdownInlineText(outcome.title)}`,
    );
  }

  if (model.criteria.length > 0) {
    // The rendered card carries each criterion's rationale in a disclosure on
    // its title; the export has no disclosure, so the rationale becomes its
    // own list beside the matrix rather than being lost.
    const defined = model.criteria
      .map((criterion) => ({
        criterion,
        detail: markdownFromHast(criterion.detail),
      }))
      .filter((entry) => entry.detail !== "");
    if (defined.length > 0) {
      sections.push(
        [
          "**Criteria**",
          ...defined.map((entry) =>
            markdownBullet(
              `**${markdownInlineText(entry.criterion.title)}**${entry.criterion.impact === undefined ? "" : ` (impact ${entry.criterion.impact}/5)`} — ${entry.detail}`,
            ),
          ),
        ].join("\n"),
      );
    }
    const headers = [
      "Criterion",
      ...model.options.map((option) => markdownInlineText(option.title)),
    ];
    const rows = model.criteria.map((criterion, criterionIndex) => [
      criterionLabel(criterion),
      ...model.options.map((option) => {
        const consideration = option.considerations[criterionIndex];
        if (consideration === undefined) return "—";
        const score =
          consideration.score === undefined
            ? ""
            : ` · score ${consideration.score}/5`;
        return markdownInlineText(
          `${consideration.verdict} (${consideration.tone}${score})`,
        );
      }),
    ]);
    sections.push(markdownTable({ headers, rows }));
  }

  if (model.scoring === "weighted") {
    sections.push(
      [
        "**Normalized weighted totals**",
        ...model.options.map((option) => {
          const total = weightedDecisionTotal({ model, option });
          return `- ${markdownInlineText(option.title)}: ${total.percent}% (${total.numerator} ÷ ${total.denominator})`;
        }),
      ].join("\n"),
      // Its own block: lazy continuation would otherwise read the shared
      // method as the last option's score.
      "Method: Σ(impact × option score) ÷ Σ(impact × 5), normalized to 100%.",
    );
  }

  sections.push(
    ...model.options.map((option) => {
      const labels = optionLabels(option);
      const content: Array<string> = [
        markdownHeading({
          level: 4,
          offset: headingOffset,
          text: `Option: ${markdownInlineText(option.title)}${labels.length === 0 ? "" : ` — ${labels.join(", ")}`}`,
        }),
      ];
      if (option.summary !== undefined) {
        content.push(markdownInlineText(option.summary));
      }
      option.considerations.forEach((consideration, index) => {
        if (consideration === undefined) return;
        const criterion = model.criteria[index];
        const detail = markdownFromHast(consideration.detail);
        const label =
          criterion === undefined
            ? `Criterion ${index + 1}`
            : markdownInlineText(criterion.title);
        content.push(
          markdownBullet(
            `**${label}:** ${markdownInlineText(consideration.verdict)} (${consideration.tone})${detail === "" ? "" : ` — ${detail}`}`,
          ),
        );
      });
      const detail = markdownFromHast(option.detail);
      if (detail !== "") content.push(detail);
      return content.join("\n\n");
    }),
  );

  const details = markdownFromHast(model.detail);
  if (details !== "") {
    sections.push(
      `${markdownHeading({ level: 4, offset: headingOffset, text: "Details" })}\n\n${details}`,
    );
  }
  if (model.reversibility !== undefined) {
    const detail = markdownFromHast(model.reversibility.detail);
    sections.push(
      `**Reversibility:** ${model.reversibility.rating}${detail === "" ? "" : ` — ${detail}`}`,
    );
  }
  return sections.join("\n\n");
};
