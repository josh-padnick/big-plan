// Turns what a connector declared about itself into what the card shows.
//
// The protocol asks an agent for the provider's own canonical model id -
// `grok-4.6`, not `Grok 4.6` - because an id is the one form the agent can
// state without composing it, and composition is where invention creeps in.
// Presentation is this layer's job instead: the catalog maps a declared id to
// a vendor mark and the name that vendor writes.
//
// Everything here is a lookup, never a transformation. An id the catalog does
// not hold renders exactly as declared: not title-cased, not hyphen-stripped,
// not expanded. Re-casing an unknown id would be Big Plan asserting how a
// vendor writes its own name, which is the same class of invention as guessing
// the vendor outright.
//
// Lookups are tolerant by normalizing both sides the same way, so a connector
// still following the older display-name instruction resolves to the same
// entry as one sending the canonical id.

export type AgentModelVendor = "openai" | "claude" | "grok" | "mistral";

/** Lowercase, and every run of non-alphanumerics becomes one hyphen. */
const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

type ModelEntry = {
  readonly vendor: AgentModelVendor;
  readonly display: string;
};

// Keyed by normalized declaration. Both the canonical id and the display form
// the earlier prompt asked for normalize to the same key, so both resolve.
const MODEL_CATALOG: ReadonlyMap<string, ModelEntry> = new Map([
  ["grok-4-6", { vendor: "grok" as const, display: "Grok 4.6" }],
  ["grok-4", { vendor: "grok" as const, display: "Grok 4" }],
  ["claude-fable-5", { vendor: "claude" as const, display: "Claude Fable 5" }],
  ["claude-opus-5", { vendor: "claude" as const, display: "Claude Opus 5" }],
  [
    "claude-sonnet-5",
    { vendor: "claude" as const, display: "Claude Sonnet 5" },
  ],
  [
    "claude-haiku-4-5",
    { vendor: "claude" as const, display: "Claude Haiku 4.5" },
  ],
  ["gpt-5-6-sol", { vendor: "openai" as const, display: "GPT-5.6-sol" }],
  ["gpt-5-6-luna", { vendor: "openai" as const, display: "GPT-5.6-Luna" }],
  ["mistral-large", { vendor: "mistral" as const, display: "Mistral Large" }],
]);

// A vendor's family, for a model the catalog has no entry for. It decides the
// mark alone: the name still renders exactly as declared.
//
// "gpt" alone is not enough: EleutherAI's GPT-J and GPT-NeoX are real,
// unrelated models. Only OpenAI's own gpt-4* and gpt-5* naming families are
// recognized by name; a bare or differently numbered "gpt" resolves to no
// vendor rather than guessing.
//
// A vendor earns an entry here only once the catalog holds a mark faithful to
// its published one. A vendor with no entry shows a name alone, which is the
// whole answer: a generic robot beside "DeepSeek" tells the reader nothing they
// did not already read, and a mark drawn from memory tells them something false.
const VENDOR_MARKERS: ReadonlyArray<readonly [AgentModelVendor, RegExp]> = [
  ["openai", /openai|\bgpt-?[45](?!all)/i],
  ["claude", /claude/i],
  ["grok", /grok/i],
  ["mistral", /\bmistral|\bmixtral|\bcodestral|\bdevstral|\bmagistral/i],
];

/** Finds the vendor a declared model names, or undefined when unknown. */
export const agentModelVendor = (
  declared: string,
): AgentModelVendor | undefined =>
  MODEL_CATALOG.get(normalize(declared))?.vendor ??
  VENDOR_MARKERS.find(([, pattern]) => pattern.test(declared))?.[0];

/** The name to print for a declared model: the catalog's, or the declaration. */
export const agentModelDisplayName = (declared: string): string =>
  MODEL_CATALOG.get(normalize(declared))?.display ?? declared;

// Clients follow the same rule as models. The declaration carries a version -
// `claude-code 2.1.217` - because the connector knows it; the card drops it,
// since which build is running is a fact about the agent's machine rather than
// about the conversation the reviewer is having.
const CLIENT_CATALOG: ReadonlyMap<string, string> = new Map([
  ["claude-code", "Claude Code"],
  ["claude-cli", "Claude Code"],
  ["grok-cli", "Grok CLI"],
  ["codex", "Codex"],
  ["codex-cli", "Codex"],
  ["gemini-cli", "Gemini CLI"],
  ["cursor", "Cursor"],
  ["big-plan", "Big Plan"],
]);

/** The name to print for a declared client, version dropped when recognized. */
export const agentClientDisplayName = (declared: string): string => {
  const withoutVersion = declared.replace(/[\s@/]+v?\d[\w.+-]*$/u, "");
  return CLIENT_CATALOG.get(normalize(withoutVersion)) ?? declared;
};
