// The connector's own description of itself, as it declared it.
//
// Every field is optional and independent of the others, every one is stated by
// the agent rather than inferred by Big Plan, and an absent field is reported as
// absent rather than filled in. A connector that can name its client but not its
// model is still reporting something true, so the declaration stands on any one
// field. The type stays deliberately dumb: it holds strings a connector said,
// and the catalog decides how any of them are shown.
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
  readonly name?: string;
  /**
   * How hard the connector was told to think, when it reports it. Free text
   * rather than an enum: the levels are the connector's vocabulary, not ours,
   * and inventing a fixed set here would either drop a level a connector uses
   * or invite a guess at which of ours it meant.
   */
  readonly effort?: string;
  /** Which tool is connected, for example `claude-code 2.1.217`. */
  readonly client?: string;
  /** The connector's URL-shaped or opaque address for its conversation. */
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
const CONTROL_STRING_STARTS = new Set([0x50, 0x58, 0x5d, 0x5e, 0x5f]);
const C1_CONTROL_STRING_STARTS = new Set([0x90, 0x98, 0x9d, 0x9e, 0x9f]);

/** Consumes a CSI sequence, including private parameters, through its final byte. */
const afterCsi = (value: string, start: number): number => {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) return index + 1;
  }
  return value.length;
};

/** Consumes an OSC, DCS, SOS, PM, or APC string through BEL or ST. */
const afterControlString = (value: string, start: number): number => {
  for (let index = start; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
  }
  return value.length;
};

/** Consumes one seven-bit escape sequence from its ESC byte. */
const afterEscapeSequence = (value: string, start: number): number => {
  const kind = value.charCodeAt(start + 1);
  if (kind === 0x5b) return afterCsi(value, start + 2);
  if (CONTROL_STRING_STARTS.has(kind)) {
    return afterControlString(value, start + 2);
  }
  let index = start + 1;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  return Math.min(index + 1, value.length);
};

const withoutTerminalFormatting = (value: string): string => {
  let text = "";
  for (let index = 0; index < value.length;) {
    const code = value.charCodeAt(index);
    if (code === 0x1b) {
      index = afterEscapeSequence(value, index);
    } else if (code === 0x9b) {
      index = afterCsi(value, index + 1);
    } else if (C1_CONTROL_STRING_STARTS.has(code)) {
      index = afterControlString(value, index + 1);
    } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      index += 1;
    } else {
      text += value[index];
      index += 1;
    }
  }
  return text;
};

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
 * Reads a declaration field by field, and reports it when any field survives.
 *
 * The four fields are independent, so one that fails its own check drops on its
 * own rather than taking the declaration with it: a connector that names its
 * client and its session but cannot name its model has still told the reviewer
 * who is there. A declaration where nothing survives is absent, and absence is
 * reported as absence.
 */
export const decodeAgentModelIdentity = (
  value: unknown,
): AgentModelIdentity | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const name = readText(value, "name", 80);
  const effort = readText(value, "effort", 24);
  const client = readText(value, "client", 80);
  const sessionUrl = readText(value, "sessionUrl", 2_048);
  const sessionId = readText(value, "sessionId", 120);
  const identity = {
    ...(name === undefined ? {} : { name }),
    ...(effort === undefined ? {} : { effort }),
    ...(client === undefined ? {} : { client }),
    ...(sessionUrl === undefined ? {} : { sessionUrl }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
  return Object.keys(identity).length === 0 ? undefined : identity;
};

/** Selects one connector declaration without composing fields across agents. */
export const selectAgentModelIdentity = ({
  claimed,
  presence,
}: {
  readonly claimed?: AgentModelIdentity;
  readonly presence?: AgentModelIdentity;
}): AgentModelIdentity | undefined => claimed ?? presence;
