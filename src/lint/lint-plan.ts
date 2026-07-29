// Owns validate-only authoring lint: one small public interface over the
// ordered rule collection and its shared Markdown parse.

import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { markdownTableFormatRule } from "./rules/markdown-table-format.js";
import { planLedeRule } from "./rules/plan-lede.js";
import { sectionVocabularyRule } from "./rules/section-vocabulary.js";
import type { PlanLintDiagnostic, PlanLintRule } from "./types.js";

export type { PlanLintDiagnostic } from "./types.js";

const RULES: ReadonlyArray<PlanLintRule> = [
  markdownTableFormatRule,
  planLedeRule,
  sectionVocabularyRule,
];

/** Runs every authoring lint rule in stable registry order. */
export const lintPlan = ({
  markdown,
}: {
  readonly markdown: string;
}): ReadonlyArray<PlanLintDiagnostic> => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx);
  const tree = processor.parse(markdown);
  return RULES.flatMap((rule) =>
    rule
      .check({ markdown, tree })
      .map((finding) => ({ ruleId: rule.id, ...finding })),
  );
};
