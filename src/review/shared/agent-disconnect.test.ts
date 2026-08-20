import { describe, expect, it } from "vitest";
import { agentDisconnectAddresses } from "./agent-disconnect.js";

describe("agent disconnect addressing", () => {
  it("should address the agent whose connection the directive names", () => {
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", requestedAtMs: 10 },
        writerId: "1111",
      }),
    ).toBe(true);
  });

  it("should not address an agent that attached after the disconnect", () => {
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", requestedAtMs: 10 },
        writerId: "2222",
      }),
    ).toBe(false);
  });

  it("should not address an agent whose own connection is absent", () => {
    // A directive that matched on absence would be a standing order against
    // every agent that ever attaches to the review.
    expect(
      agentDisconnectAddresses({
        directive: { writerId: "1111", requestedAtMs: 10 },
      }),
    ).toBe(false);
  });
});
