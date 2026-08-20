// Proves the one join the approve dialog and toolbar read: counts, the
// footnote, and which unanswered decisions actually block.

import { describe, expect, it } from "vitest";
import {
  approveFootnote,
  approveIsPrimary,
  deriveOpenItems,
  openRequestsFromExchange,
  type OpenChangeSet,
} from "./open-items.js";
import type { ReviewInput } from "./input-contract.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";

const changeSet = (overrides: Partial<OpenChangeSet> = {}): OpenChangeSet => ({
  id: "req1req1req1req1",
  label: "Retry backoff",
  from: FROM,
  to: TO,
  placeIds: ["p1", "p2"],
  ...overrides,
});

const input = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  inputId: "decision-one",
  label: "Which release path?",
  isCritical: false,
  state: "unanswered",
  detail: "No answer recorded",
  ...overrides,
});

describe("deriveOpenItems", () => {
  it("promotes Approve when every change set is accepted", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set([`${FROM}:${TO}:p1`, `${FROM}:${TO}:p2`]),
      inputs: [input({ state: "answered", detail: "Answered: Gradual" })],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
    expect(approveFootnote(items)).toBeUndefined();
    expect(items.changeSets.open).toEqual([]);
  });

  it("demotes Approve while a change set is open, even with unanswered decisions", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set(),
      inputs: [input()],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(false);
    expect(approveFootnote(items)).toBe(
      "Approval treats all change sets as accepted and reports unanswered decisions as not answered.",
    );
  });

  it("treats a change set with no loaded places as still open", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet({ placeIds: [] })],
      accepted: new Set(),
      inputs: [],
      requests: [],
    });
    expect(items.changeSets.open).toHaveLength(1);
    expect(approveIsPrimary(items)).toBe(false);
  });

  it("separates critical unanswered decisions from advisory ones", () => {
    const items = deriveOpenItems({
      changeSets: [],
      accepted: new Set(),
      inputs: [
        input({ inputId: "critical", isCritical: true }),
        input({ inputId: "advisory" }),
        input({
          inputId: "done",
          state: "answered",
          detail: "Answered: Yes",
        }),
      ],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
    expect(items.decisions.blockingCritical.map((row) => row.inputId)).toEqual([
      "critical",
    ]);
    expect(items.decisions.unanswered.map((row) => row.inputId)).toEqual([
      "critical",
      "advisory",
    ]);
    expect(approveFootnote(items)).toBeDefined();
  });
});

describe("openRequestsFromExchange", () => {
  it("lists only requests that have not reached a terminal state", () => {
    expect(
      openRequestsFromExchange([
        {
          requestId: "aaaaaaaaaaaaaaaa",
          kind: "chat",
          body: "Please start.",
        },
        {
          requestId: "bbbbbbbbbbbbbbbb",
          kind: "feedback",
          canceledAt: "2026-08-19T18:00:00.000Z",
        },
        {
          requestId: "cccccccccccccccc",
          kind: "reply",
          answeredAt: "2026-08-19T18:00:00.000Z",
        },
      ]),
    ).toEqual([{ requestId: "aaaaaaaaaaaaaaaa", label: "Please start." }]);
  });
});
