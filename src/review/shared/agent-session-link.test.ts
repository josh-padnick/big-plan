import { describe, expect, it } from "vitest";
import { agentSessionAffordance } from "./agent-session-link.js";

describe("agentSessionAffordance", () => {
  it.each([
    ["https://claude.ai/code/abc123", "claude-code-web"],
    ["https://claude.com/code/abc123?tab=diff", "claude-code-web"],
    ["https://chatgpt.com/codex/task_01", "codex-web"],
    ["https://grok.com/chat/8ad2b97a", "grok-web"],
    ["https://grok.com/c/8ad2b97a", "grok-web"],
  ] as const)("should link %j as %s", (sessionUrl, interfaceId) => {
    expect(agentSessionAffordance({ sessionUrl })).toEqual({
      kind: "link",
      href: sessionUrl,
      interfaceId,
    });
  });

  it.each([
    // The right host, but not a conversation on it.
    "https://claude.ai/",
    "https://claude.ai/settings",
    "https://chatgpt.com/c/abc123",
    // An interface Big Plan has no shape for. A CLI's own session address is
    // the case this exists for: it is real, and it does not open in a browser.
    "https://localhost:4000/session/abc",
    "https://internal.example/agent/42",
    // Not https at all. The card cannot know whether the reader's machine has
    // the application a custom scheme would reach.
    "vscode://anthropic.claude/session/abc",
    "http://claude.ai/code/abc123",
    // Not a URL.
    "8ad2b97a-fb30-41bb-bd12",
  ])("should offer %j as an identifier instead of a link", (sessionUrl) => {
    expect(agentSessionAffordance({ sessionUrl })).toEqual({
      kind: "identifier",
      value: sessionUrl,
    });
  });

  it("should offer a bare id as an identifier", () => {
    expect(agentSessionAffordance({ sessionId: "8ad2b97a-fb30" })).toEqual({
      kind: "identifier",
      value: "8ad2b97a-fb30",
    });
  });

  it("should prefer a declared URL over a declared id", () => {
    expect(
      agentSessionAffordance({
        sessionUrl: "https://grok.com/chat/one",
        sessionId: "two",
      }),
    ).toEqual({
      kind: "link",
      href: "https://grok.com/chat/one",
      interfaceId: "grok-web",
    });
  });

  it("should offer nothing when nothing was declared", () => {
    expect(agentSessionAffordance({})).toEqual({ kind: "none" });
  });
});
