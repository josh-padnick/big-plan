// Covers strict identifier extraction from the real agent CLI's TOON output.

import { agentIdOf, expect, test } from "./fixtures";

test("should parse valid quoted and unquoted agent CLI identifiers", () => {
  expect(agentIdOf('agent_token: "9983087100926270"', "agent_token")).toBe(
    "9983087100926270",
  );
  expect(agentIdOf("agent_token: abcdef0123456789", "agent_token")).toBe(
    "abcdef0123456789",
  );
});

test("should reject an agent CLI identifier followed by another word character", () => {
  expect(() =>
    agentIdOf("agent_token: abcdef0123456789g", "agent_token"),
  ).toThrow("The agent CLI printed no agent_token");
});
