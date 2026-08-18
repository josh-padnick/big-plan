// Recognizes a known vendor family inside a connector-reported model name, so
// the badge can show that vendor's own mark. This never guesses the identity
// itself - the name is exactly what the connector reported - it only decides
// which known vendor's mark, if any, that already-reported name names.
//
// A vendor earns an entry here only once the catalog holds a mark that is
// faithful to the published one. A name with no entry shows as a name, which is
// the whole answer: a generic robot beside "DeepSeek" tells the reader nothing
// they did not already read, and a mark drawn from memory tells them something
// false.

export type AgentModelVendor = "openai" | "claude" | "grok" | "mistral";

// "gpt" alone is not enough: EleutherAI's GPT-J and GPT-NeoX are real,
// unrelated models. Only OpenAI's own gpt-4* and gpt-5* naming families are
// recognized by name; a bare or differently numbered "gpt" falls back to the
// generic icon instead of guessing.
const VENDOR_MARKERS: ReadonlyArray<readonly [AgentModelVendor, RegExp]> = [
  ["openai", /openai|\bgpt-?[45](?!all)/i],
  ["claude", /claude/i],
  ["grok", /grok/i],
  // Mistral's own families, not the word alone: "mixtral" and "codestral" are
  // theirs, and a name that merely contains "mistral" as a substring of another
  // word would not be.
  ["mistral", /\bmistral|\bmixtral|\bcodestral|\bdevstral|\bmagistral/i],
];

/** Finds the vendor a reported model name names, or undefined when unknown. */
export const agentModelVendor = (name: string): AgentModelVendor | undefined =>
  VENDOR_MARKERS.find(([, pattern]) => pattern.test(name))?.[0];
