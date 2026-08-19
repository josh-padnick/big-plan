import { describe, expect, it } from "vitest";
import {
  decodeAgentModelIdentity,
  selectAgentModelIdentity,
} from "./agent-model.js";

const ESCAPE = "";

describe("decodeAgentModelIdentity", () => {
  it("should keep a declaration as it was declared", () => {
    expect(
      decodeAgentModelIdentity({
        name: "claude-fable-5",
        effort: "high",
        client: "claude-code 2.1.217",
        sessionUrl: "https://claude.ai/code/abc",
      }),
    ).toEqual({
      name: "claude-fable-5",
      effort: "high",
      client: "claude-code 2.1.217",
      sessionUrl: "https://claude.ai/code/abc",
    });
  });

  it("should refuse terminal formatting a connector's environment carried in", () => {
    // The captain's own session declared this: a terminal wrote colour into the
    // variable, and the card rendered `claude-opus-5[1m]` as though a vendor
    // had named a model that way.
    expect(
      decodeAgentModelIdentity({
        name: `claude-opus-5${ESCAPE}[1m`,
        client: `${ESCAPE}[32mclaude-code 2.1.235${ESCAPE}[0m`,
      }),
    ).toEqual({ name: "claude-opus-5", client: "claude-code 2.1.235" });
  });

  it("should strip terminal control strings and private CSI sequences", () => {
    expect(
      decodeAgentModelIdentity({
        name: `${ESCAPE}]0;terminal title\u0007claude-opus-5`,
        client: `${ESCAPE}[?25lclaude-code 2.1.235`,
        effort: `${ESCAPE}Pignored${ESCAPE}\\high`,
      }),
    ).toEqual({
      name: "claude-opus-5",
      client: "claude-code 2.1.235",
      effort: "high",
    });
  });

  it("should retain a session declaration for the affordance classifier", () => {
    expect(
      decodeAgentModelIdentity({
        name: "grok-4.6",
        sessionUrl: "javascript:alert(1)",
      }),
    ).toEqual({ name: "grok-4.6", sessionUrl: "javascript:alert(1)" });
    expect(
      decodeAgentModelIdentity({
        sessionUrl: "vscode://anthropic.claude/session/abc",
      }),
    ).toEqual({ sessionUrl: "vscode://anthropic.claude/session/abc" });
    expect(decodeAgentModelIdentity({ sessionUrl: "01H9" })).toEqual({
      sessionUrl: "01H9",
    });
  });

  it("should report a declaration that names only the client", () => {
    expect(decodeAgentModelIdentity({ client: "grok-cli 0.2.99" })).toEqual({
      client: "grok-cli 0.2.99",
    });
  });

  it("should report a declaration that names only the session", () => {
    expect(
      decodeAgentModelIdentity({ sessionUrl: "https://claude.ai/code/abc" }),
    ).toEqual({ sessionUrl: "https://claude.ai/code/abc" });
    expect(decodeAgentModelIdentity({ sessionId: "01H9" })).toEqual({
      sessionId: "01H9",
    });
  });

  it("should drop a field that fails its own check without losing the rest", () => {
    expect(
      decodeAgentModelIdentity({
        name: "x".repeat(81),
        client: "codex 0.9",
      }),
    ).toEqual({ client: "codex 0.9" });
  });

  it("should refuse a declaration where nothing survives", () => {
    expect(decodeAgentModelIdentity({})).toBeUndefined();
    expect(decodeAgentModelIdentity({ name: "   " })).toBeUndefined();
    expect(decodeAgentModelIdentity({ name: "x".repeat(81) })).toBeUndefined();
  });
});

describe("selectAgentModelIdentity", () => {
  it("should select one partial declaration without filling it from presence", () => {
    expect(
      selectAgentModelIdentity({
        claimed: { client: "grok-cli 0.2.99" },
        presence: {
          name: "claude-fable-5",
          effort: "max",
          sessionId: "01H9",
        },
      }),
    ).toEqual({ client: "grok-cli 0.2.99" });
  });

  it("should use presence when no request has claimed the work", () => {
    expect(
      selectAgentModelIdentity({
        presence: { name: "claude-fable-5" },
      }),
    ).toEqual({ name: "claude-fable-5" });
  });

  it("should refuse a presence declaration made about other work", () => {
    expect(
      selectAgentModelIdentity({
        claimedRequestId: "1111111111111111",
        presence: { name: "claude-fable-5", client: "claude-code 2.1.217" },
      }),
    ).toBeUndefined();
    expect(
      selectAgentModelIdentity({
        claimedRequestId: "1111111111111111",
        presence: { name: "claude-fable-5" },
        presenceRequestId: "2222222222222222",
      }),
    ).toBeUndefined();
  });

  it("should keep presence naming the pickup it is working on", () => {
    expect(
      selectAgentModelIdentity({
        claimedRequestId: "1111111111111111",
        presence: { name: "claude-fable-5" },
        presenceRequestId: "1111111111111111",
      }),
    ).toEqual({ name: "claude-fable-5" });
  });
});
