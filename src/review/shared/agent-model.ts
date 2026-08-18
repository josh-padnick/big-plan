export type AgentModelIdentity = {
  readonly name: string;
  /**
   * How hard the connector was told to think, when it reports it. Free text
   * rather than an enum: the levels are the connector's vocabulary, not ours,
   * and inventing a fixed set here would either drop a level a connector uses
   * or invite a guess at which of ours it meant.
   */
  readonly effort?: string;
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
  const name = value.name.trim();
  if (name === "" || name.length > 80) return undefined;
  const effort =
    "effort" in value && typeof value.effort === "string"
      ? value.effort.trim()
      : "";
  return effort === "" || effort.length > 24 ? { name } : { name, effort };
};
