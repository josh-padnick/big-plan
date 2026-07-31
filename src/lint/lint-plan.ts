// Owns validate-only authoring lint: one small public interface over the
// ordered rule collection and its shared Markdown parse.

import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { collectionGroupingRule } from "./rules/collection-grouping.js";
import { ledeLengthRule } from "./rules/lede-length.js";
import { ledePresenceRule } from "./rules/lede-presence.js";
import { ledeStyleRule } from "./rules/lede-style.js";
import { markdownTableFormatRule } from "./rules/markdown-table-format.js";
import { quickSummarySingletonRule } from "./rules/quick-summary-singleton.js";
import { slideLeadingTitleRule } from "./rules/slide-leading-title.js";
import { subtitleDuplicationRule } from "./rules/subtitle-duplication.js";
import { tableOfContentsMatchesSectionsRule } from "./rules/table-of-contents-matches-sections.js";
import { titleLengthRule } from "./rules/title-length.js";
import type { PlanLintDiagnostic, PlanLintRule } from "./types.js";

export type { PlanLintDiagnostic } from "./types.js";

const RULES: ReadonlyArray<PlanLintRule> = [
  markdownTableFormatRule,
  titleLengthRule,
  ledePresenceRule,
  ledeStyleRule,
  ledeLengthRule,
  quickSummarySingletonRule,
  tableOfContentsMatchesSectionsRule,
  slideLeadingTitleRule,
  subtitleDuplicationRule,
  collectionGroupingRule,
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
