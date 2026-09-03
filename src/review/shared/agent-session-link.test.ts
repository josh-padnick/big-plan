import { describe, expect, it } from "vitest";
import {
  agentSessionAffordance,
  agentSessionReference,
} from "./agent-session-link.js";

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
    "javascript:alert(1)",
    "data:text/html,not-a-chat",
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

describe("agentSessionReference", () => {
  it("should copy the bare id a URL carries, not the URL", () => {
    // The reviewer matches the id their own tool printed; the whole URL is a
    // mouthful to check four characters of, and it still opens from its own link
    // (BIG-281). The id is the conversation segment of the address - the linked
    // interfaces and a CLI's own path alike.
    expect(
      agentSessionReference({
        sessionUrl: "https://claude.ai/code/session_abc",
        writerId: "writer-1",
      }),
    ).toEqual({ handle: "session_abc", copyValue: "session_abc" });
    expect(
      agentSessionReference({
        sessionUrl: "https://localhost:4000/session/abc",
        writerId: "writer-1",
      }),
    ).toEqual({ handle: "abc", copyValue: "abc" });
    // A query on the address is not part of the id.
    expect(
      agentSessionReference({
        sessionUrl: "https://claude.ai/code/8ad2b97a?tab=diff",
      }),
    ).toEqual({ handle: "8ad2b97a", copyValue: "8ad2b97a" });
  });

  it("should keep the whole string when it is not a URL with a path", () => {
    // A declaration is never dropped: something not URL-shaped is its own id.
    expect(agentSessionReference({ sessionUrl: "8ad2b97a-fb30-41bb" })).toEqual(
      { handle: "8ad2b97a-fb30-41bb", copyValue: "8ad2b97a-fb30-41bb" },
    );
  });

  it("should not copy a URL that carries no bare session id", () => {
    expect(
      agentSessionReference({
        sessionUrl: "https://claude.ai/?token=value",
        writerId: "writer-1",
      }),
    ).toEqual({ handle: "https://claude.ai/?token=value" });
  });

  it("should copy a declared handle when no URL was declared", () => {
    expect(
      agentSessionReference({
        sessionId: "session-2e29",
        writerId: "writer-1",
      }),
    ).toEqual({ handle: "session-2e29", copyValue: "session-2e29" });
  });

  it("should prefer a declared bare id over the URL's segment", () => {
    // A declared id is already the bare id; there is nothing to derive.
    expect(
      agentSessionReference({
        sessionUrl: "https://grok.com/chat/one",
        sessionId: "two",
      }),
    ).toEqual({ handle: "two", copyValue: "two" });
  });

  it("should name a session by its roster id with nothing to copy", () => {
    // A roster id names an agent inside Big Plan and nothing outside it, so it
    // is shown but not offered - there is nowhere to paste it.
    expect(agentSessionReference({ writerId: "writer-1" })).toEqual({
      handle: "writer-1",
    });
  });

  it("should resolve to nothing when there is no session and no roster id", () => {
    expect(agentSessionReference({})).toBeUndefined();
  });
});
