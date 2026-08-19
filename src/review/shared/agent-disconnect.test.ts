import { describe, expect, it } from "vitest";
import { agentDisconnectAddresses } from "./agent-disconnect.js";

describe("agent disconnect addressing", () => {
  it("should address the agent when the directive names its connection loop", () => {
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", requestedAtMs: 10 },
        writerId: "1111",
      }),
    ).toBe(true);
  });

  it("should address the agent when the directive names the token it claimed with", () => {
    // `agent note` and `agent respond` never learn their loop's writer id, so
    // the token is the only handle a mid-turn process can be found by.
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", claimToken: "abcd", requestedAtMs: 10 },
        claimToken: "abcd",
      }),
    ).toBe(true);
  });

  it("should not address an agent that attached after the disconnect", () => {
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", claimToken: "abcd", requestedAtMs: 10 },
        writerId: "2222",
        claimToken: "efgh",
      }),
    ).toBe(false);
  });

  it("should address nobody when the directive names nobody", () => {
    // A directive that matched on absence would be a standing order against
    // every agent that ever attaches to the review.
    expect(agentDisconnectAddresses({ directive: { requestedAtMs: 10 } })).toBe(
      false,
    );
    expect(
      agentDisconnectAddresses({
        directive: { requestedAtMs: 10 },
        writerId: "1111",
      }),
    ).toBe(false);
  });

  it("should not address an agent whose own ids are absent", () => {
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", claimToken: "abcd", requestedAtMs: 10 },
      }),
    ).toBe(false);
  });
});
