// Owns the runtime's answer to "which decisions is the plan asking right now,
// and what exactly is each one asking?". The server compiles the plan, so it is
// the only party that knows the current inventory the moment the source
// changes; deriving it here is what lets the answers store stop deferring to a
// browser's reading of the document it was served.
//
// Each entry carries a digest of the decision's own compiled content. That is
// deliberately narrower than the plan: an edit three sections away must leave a
// confirmed answer alone, and an edit to this decision's question, options,
// summaries, considerations, or context must not.

import { createHash } from "node:crypto";
import {
  isAnswerableDecisionCard,
  type CompiledDecisionCard,
} from "../components/_model/decision-card.js";
import { compilePlanModel } from "../render/compile-plan-model.js";

/** One decision the plan currently asks, with the content it is asking about. */
export type DecisionInventoryEntry = {
  readonly decisionId: string;
  readonly optionIds: ReadonlySet<string>;
  readonly decisionDigest: string;
};

export type DecisionInventory = ReadonlyMap<string, DecisionInventoryEntry>;

// Positions record where a decision sits in the file, which any unrelated edit
// above it changes. Stripping them, and ordering keys by name rather than by
// the compiler's literal order, keeps the digest a statement about content.
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "position")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
};

/** Hashes one decision's whole compiled content into its currency digest. */
export const deriveDecisionDigest = (model: CompiledDecisionCard): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(model)))
    .digest("hex")
    .slice(0, 16);

// Every decision component compiles to the shared card model, and a fourth one
// would too, so recognition is by that shape rather than by a list of component
// names this module would have to be told about.
const asDecisionCard = (model: unknown): CompiledDecisionCard | undefined => {
  if (typeof model !== "object" || model === null) return undefined;
  const candidate = model as Partial<CompiledDecisionCard>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.question !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.interaction !== "string" ||
    !Array.isArray(candidate.options)
  ) {
    return undefined;
  }
  return candidate as CompiledDecisionCard;
};

/** Projects one compiled plan into the decisions whose answers it will accept. */
export const deriveDecisionInventory = ({
  markdown,
  fallbackTitle,
}: {
  readonly markdown: string;
  readonly fallbackTitle: string;
}): DecisionInventory => {
  const { components } = compilePlanModel({ markdown, fallbackTitle });
  const inventory = new Map<string, DecisionInventoryEntry>();
  for (const collected of components) {
    const model = asDecisionCard(collected.model);
    if (model === undefined || !isAnswerableDecisionCard(model)) continue;
    inventory.set(model.id, {
      decisionId: model.id,
      optionIds: new Set(model.options.map((option) => option.id)),
      decisionDigest: deriveDecisionDigest(model),
    });
  }
  return inventory;
};
