// Renders QuickDecision through the shared semantic decision presentation.

import { decisionCardMarkdown } from "../_model/decision-markdown.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";
import type { CompiledDecisionCard } from "../_model/decision-card.js";

export const quickDecisionMarkdown: ComponentMarkdownRenderer<
  CompiledDecisionCard
> = (model) => decisionCardMarkdown(model);
