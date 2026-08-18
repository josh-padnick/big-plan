// The connector's own description of itself, as it declared it.
//
// Every field is optional except the model, every one is stated by the agent
// rather than inferred by Big Plan, and an absent field is reported as absent
// rather than filled in. The type stays deliberately dumb: it holds strings a
// connector said, and the catalog decides how any of them are shown.
//
// It rides the slot the wire already calls `model` on presence and on a claim.
// The slot is narrower than its contents now, but these fields are one
// declaration made once by one connector, and splitting them across parallel
// wire fields would let a reader's client disagree with their model about which
// agent they came from.
export type AgentModelIdentity = {
  /**
   * The model, as the provider's own canonical API id where the agent knows it.
   * Never composed here: what arrives is what is stored.
   */
  readonly name: string;
  /**
   * How hard the connector was told to think, when it reports it. Free text
   * rather than an enum: the levels are the connector's vocabulary, not ours,
   * and inventing a fixed set here would either drop a level a connector uses
   * or invite a guess at which of ours it meant.
   */
  readonly effort?: string;
  /** Which tool is connected, for example `claude-code 2.1.217`. */
  readonly client?: string;
  /** Where the agent's own conversation can be opened, when it has a URL. */
  readonly sessionUrl?: string;
  /** An opaque handle for that conversation, when there is no URL for it. */
  readonly sessionId?: string;
};

/*
Strips terminal formatting from a declared value.

A connector reads these from an environment a terminal wrote, and a terminal
writes colour: `claude-opus-5\u001b[1m` arrives as a model name and renders as
`claude-opus-5[1m]`, which is not a name any vendor writes. Removing escape
sequences is not the same as rewriting what was declared - the card still never
re-cases or expands an id - it is refusing bytes that were never text.
*/
const withoutTerminalFormatting = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- the point is the control bytes
  value.replace(/\u001b\[[0-9;]*[a-zA-Z]|[\u0000-\u001f\u007f]/gu, "");

const readText = (
  value: object,
  key: string,
  limit: number,
): string | undefined => {
  if (!(key in value)) return undefined;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = withoutTerminalFormatting(raw).trim();
  return trimmed === "" || trimmed.length > limit ? undefined : trimmed;
};

/**
 * Accepts only a session URL the browser can safely open.
 *
 * A declared URL becomes a link the reviewer clicks, so the scheme is checked
 * rather than trusted: `javascript:` and `data:` are the reason this exists,
 * and a URL that fails the check is dropped rather than rendered inert, since a
 * link that cannot be followed is worse than no link at all.
 */
const readSessionUrl = (value: object): string | undefined => {
  const declared = readText(value, "sessionUrl", 2_048);
  if (declared === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(declared);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:"
    ? declared
    : undefined;
};

export const decodeAgentModelIdentity = (
  value: unknown,
): AgentModelIdentity | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    return undefined;
  }
  const name = withoutTerminalFormatting(value.name).trim();
  if (name === "" || name.length > 80) return undefined;
  const effort = readText(value, "effort", 24);
  const client = readText(value, "client", 80);
  const sessionUrl = readSessionUrl(value);
  const sessionId = readText(value, "sessionId", 120);
  return {
    name,
    ...(effort === undefined ? {} : { effort }),
    ...(client === undefined ? {} : { client }),
    ...(sessionUrl === undefined ? {} : { sessionUrl }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
};
