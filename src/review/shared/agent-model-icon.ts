// Recognizes a known vendor family inside a connector-reported model name, so
// the badge can show that vendor's own mark. This never guesses the identity
// itself - the name is exactly what the connector reported - it only decides
// which known vendor's mark, if any, that already-reported name names.

export type AgentModelVendor = "openai" | "claude" | "grok";

// "gpt" alone is not enough: EleutherAI's GPT-J and GPT-NeoX are real,
// unrelated models. Only OpenAI's own gpt-4* and gpt-5* naming families are
// recognized by name; a bare or differently numbered "gpt" falls back to the
// generic icon instead of guessing.
const VENDOR_MARKERS: ReadonlyArray<readonly [AgentModelVendor, RegExp]> = [
  ["openai", /openai|\bgpt-?[45]/i],
  ["claude", /claude/i],
  ["grok", /grok/i],
];

/** Finds the vendor a reported model name names, or undefined when unknown. */
export const agentModelVendor = (name: string): AgentModelVendor | undefined =>
  VENDOR_MARKERS.find(([, pattern]) => pattern.test(name))?.[0];
