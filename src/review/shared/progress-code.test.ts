// Proves every stable progress code has one explicit owner and remains
// recognizable at the storage and browser boundaries.

import { describe, expect, it } from "vitest";
import {
  isProgressStepCode,
  PROGRESS_STEP_CODES,
  progressStepCodeIsAgentOwned,
  type ProgressStepCode,
} from "./progress-code.js";

const EXPECTED_OWNERS = {
  "feedback-received": "reviewer",
  "queued-comment-deleted": "reviewer",
  "reply-sent": "reviewer",
  "chat-sent": "reviewer",
  "queued-message-revised": "reviewer",
  "queued-message-deleted": "reviewer",
  "request-canceled": "reviewer",
  "plan-approved": "reviewer",
  "approval-revoked": "reviewer",
  "claim-released": "reviewer",
  "agent-disconnect-requested": "reviewer",
  "agent-primacy-answered": "reviewer",
  "push-opened": "agent",
  "request-picked-up": "agent",
  "request-reclaimed": "agent",
  "response-ready": "agent",
  "agent-note": "agent",
  "agent-disconnected": "agent",
} as const satisfies Readonly<Record<ProgressStepCode, "reviewer" | "agent">>;

describe("progress code vocabulary", () => {
  it("should validate and classify every closed-union member", () => {
    expect(new Set(PROGRESS_STEP_CODES)).toEqual(
      new Set(Object.keys(EXPECTED_OWNERS)),
    );
    for (const code of PROGRESS_STEP_CODES) {
      expect(isProgressStepCode(code)).toBe(true);
      expect(progressStepCodeIsAgentOwned(code)).toBe(
        EXPECTED_OWNERS[code] === "agent",
      );
    }
  });

  it("should reject a progress code this build does not know", () => {
    expect(isProgressStepCode("future-progress")).toBe(false);
  });
});
