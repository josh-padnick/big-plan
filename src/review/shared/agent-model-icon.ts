// Recognizes a known vendor family inside a connector-reported model name, so
// the badge can show that vendor's own mark. This never guesses the identity
// itself - the name is exactly what the connector reported - it only decides
// which known vendor's mark, if any, that already-reported name names.

export type AgentModelVendor = "openai" | "claude" | "grok";

const VENDOR_MARKERS: ReadonlyArray<readonly [AgentModelVendor, RegExp]> = [
  ["openai", /openai/i],
  ["claude", /claude/i],
  ["grok", /grok/i],
];

/** Finds the vendor a reported model name names, or undefined when unknown. */
export const agentModelVendor = (name: string): AgentModelVendor | undefined =>
  VENDOR_MARKERS.find(([, pattern]) => pattern.test(name))?.[0];
