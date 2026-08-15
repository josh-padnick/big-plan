// Proves runtime session ordering applies each newest response once and drops
// older responses that arrive after it.

import { describe, expect, it } from "vitest";
import type { RuntimeSession } from "../shared/review-wire.js";
import { createRuntimeSessionOrder } from "./runtime-session-order.js";

const sessionAt = (expiresAtMs: number): RuntimeSession => ({
  plan: "/plans/checkout.mdx",
  authoritative: true,
  idleTimeoutMs: 1_800_000,
  expiresAtMs,
});

describe("runtime session order", () => {
  it("should apply the first result from a clean owner", () => {
    const order = createRuntimeSessionOrder();
    const session = sessionAt(1_000);

    expect(order.decide({ sequence: order.issueRequest(), session })).toEqual({
      kind: "apply",
      session,
    });
  });

  it("should apply a newer sequence", () => {
    const order = createRuntimeSessionOrder();
    const firstSession = sessionAt(1_000);
    const newerSession = sessionAt(2_000);

    expect(
      order.decide({
        sequence: order.issueRequest(),
        session: firstSession,
      }),
    ).toEqual({ kind: "apply", session: firstSession });
    expect(
      order.decide({
        sequence: order.issueRequest(),
        session: newerSession,
      }),
    ).toEqual({ kind: "apply", session: newerSession });
  });

  it("should drop an older sequence that arrives later", () => {
    const order = createRuntimeSessionOrder();
    const olderSequence = order.issueRequest();
    const newerSequence = order.issueRequest();

    expect(
      order.decide({ sequence: newerSequence, session: sessionAt(2_000) }),
    ).toMatchObject({ kind: "apply" });
    expect(
      order.decide({ sequence: olderSequence, session: sessionAt(1_000) }),
    ).toEqual({ kind: "drop" });
  });

  it("should drop an equal sequence after it has applied", () => {
    const order = createRuntimeSessionOrder();
    const sequence = order.issueRequest();

    expect(order.decide({ sequence, session: sessionAt(1_000) })).toMatchObject(
      { kind: "apply" },
    );
    expect(order.decide({ sequence, session: sessionAt(2_000) })).toEqual({
      kind: "drop",
    });
  });
});
