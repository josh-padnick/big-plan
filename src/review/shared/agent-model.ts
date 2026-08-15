export type AgentModelIdentity = {
  readonly name: string;
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
  return name === "" || name.length > 80 ? undefined : { name };
};
