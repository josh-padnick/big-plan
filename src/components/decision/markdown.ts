// Renders Decision through the shared semantic decision presentation.

import type { CompiledDecisionCard } from "../_model/decision-card.js";
import { decisionCardMarkdown } from "../_model/decision-markdown.js";
import type { ComponentMarkdownRenderer } from "../_model/markdown-export.js";

export const decisionMarkdown: ComponentMarkdownRenderer<
  CompiledDecisionCard
> = (model) => decisionCardMarkdown(model);
