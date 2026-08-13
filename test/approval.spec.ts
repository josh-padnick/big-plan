// Proves durable decision answers through the complete live review runtime,
// including reload, retraction, stale replay, and visible persistence failure.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveSnapshotDigest,
  messageAgentRequest,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "../src/review/agent-exchange.js";
import {
  claimAgentRequest,
  publishAgentResponse,
} from "../src/review/request-mailbox.js";
import { writeSnapshot } from "../src/review/store.js";
import { expect, test, type Page } from "./fixtures";

const PLAN = `# Durable decision answers

Choose the release path before implementation begins.

<Decision question="Which release path should we use?">

<Option title="Gradual rollout" recommended summary="Start with one group.">
<Consideration label="Risk" verdict="Low" tone="good" />
</Option>

<Option title="Immediate rollout" summary="Release everywhere together.">
<Consideration label="Risk" verdict="High" tone="bad" />
</Option>

</Decision>
`;

const answerGradualRollout = async (page: Page): Promise<void> => {
  const decision = page.locator("[data-decision]").first();
  await decision.getByRole("radio", { name: "Gradual rollout" }).check();
  await decision.getByRole("button", { name: "Confirm choice" }).click();
};

const startCompiledReviewRuntime = async (planPath: string) => {
  // Playwright wraps JSX values during source transformation, so component
  // journeys use the built renderer exactly as the shipped runtime does.
  const { startReviewRuntime } = await import("../dist/review/server.js");
  return startReviewRuntime({ planPath });
};

test("should persist, retract, and invalidate a confirmed decision answer", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approval-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await page.goto(runtime.url);
    const decision = page.locator("[data-decision]").first();

    await test.step("a confirmed answer survives reload", async () => {
      const staged = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/inputs") &&
          response.request().method() === "POST",
      );
      await answerGradualRollout(page);
      expect((await staged).ok()).toBe(true);
      await expect(
        decision.locator("[data-decision-answer-caption]"),
      ).toHaveText("Saved with this review.");

      await page.reload();
      await expect(
        page.locator("[data-decision]").first().getByRole("radio", {
          name: "Gradual rollout",
        }),
      ).toBeChecked();
      await expect(
        page
          .locator("[data-decision]")
          .first()
          .locator("[data-decision-answer]"),
      ).toBeVisible();
      await expect(
        page
          .locator("[data-decision]")
          .first()
          .locator("[data-decision-answer-caption]"),
      ).toHaveText("Saved with this review.");
    });

    await test.step("changing the answer retracts it durably", async () => {
      const retracted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/inputs") &&
          response.request().method() === "POST",
      );
      await page
        .locator("[data-decision]")
        .first()
        .getByRole("button", { name: "Change" })
        .click();
      expect((await retracted).ok()).toBe(true);
      await page.reload();
      await expect(
        page
          .locator("[data-decision]")
          .first()
          .locator("[data-decision-footer]"),
      ).toBeVisible();
      await expect(
        page
          .locator("[data-decision]")
          .first()
          .locator("[data-decision-answer]"),
      ).toBeHidden();
    });

    await test.step("a reworded question does not replay the old answer", async () => {
      const staged = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/inputs") &&
          response.request().method() === "POST",
      );
      await answerGradualRollout(page);
      expect((await staged).ok()).toBe(true);

      const request = messageAgentRequest({
        kind: "chat",
        requestId: "1111111111111111",
        sessionId: runtime.sessionId,
        planId: runtime.planId,
        premiseSnapshot: deriveSnapshotDigest(PLAN),
        createdAt: new Date().toISOString(),
        body: "Clarify the release decision.",
      });
      await writeAgentRequest({ store: runtime.store, request });
      const claimed = await claimAgentRequest({
        store: runtime.store,
        requestId: request.requestId,
        baselineSnapshot: request.premiseSnapshot,
        now: new Date().toISOString(),
      });
      const revised = PLAN.replace(
        "Which release path should we use?",
        "How should the release reach users?",
      );
      const resultSnapshot = deriveSnapshotDigest(revised);
      await writeFile(planPath, revised);
      await writeSnapshot({
        store: runtime.store,
        snapshot: resultSnapshot,
        source: revised,
      });
      await publishAgentResponse({
        store: runtime.store,
        response: validateAgentResponseDraft({
          value: {
            requestId: request.requestId,
            message: "Clarified the decision question.",
          },
          request: claimed,
          commentsById: new Map(),
          changedBlocks: new Set(),
          currentSnapshot: resultSnapshot,
          now: new Date().toISOString(),
        }),
      });

      const revisedDecision = page.locator("[data-decision]").first();
      await expect(revisedDecision).toContainText(
        "How should the release reach users?",
        { timeout: 15_000 },
      );
      await expect(
        revisedDecision.locator("[data-decision-footer]"),
      ).toBeVisible();
      await expect(
        revisedDecision.locator("[data-decision-answer]"),
      ).toBeHidden();
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep a failed decision save visible after its toast is dismissed", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approval-failure-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  let markFirstAttemptStarted = (): void => undefined;
  let releaseFirstAttempt = (): void => undefined;
  const firstAttemptStarted = new Promise<void>((resolve) => {
    markFirstAttemptStarted = resolve;
  });
  const firstAttemptGate = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve;
  });
  let attempts = 0;
  try {
    await page.route("**/api/inputs", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        markFirstAttemptStarted();
        await firstAttemptGate;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{",
      });
    });
    await page.goto(runtime.url);
    await answerGradualRollout(page);
    await firstAttemptStarted;
    const decision = page.locator("[data-decision]").first();
    await expect(decision.locator("[data-decision-answer-caption]")).toHaveText(
      "Saving with this review...",
    );
    releaseFirstAttempt();

    await expect(page.getByText("Decision answer not saved")).toBeVisible({
      timeout: 10_000,
    });
    await expect(decision.locator("[data-decision-answer-caption]")).toHaveText(
      "Not saved yet. Big Plan is retrying automatically.",
    );
    await page.getByRole("button", { name: "Close toast" }).click();
    await expect(page.getByText("Decision answer not saved")).toBeHidden();
    await expect(decision.locator("[data-decision-answer-caption]")).toHaveText(
      "Not saved yet. Big Plan is retrying automatically.",
    );

    await page.unroute("**/api/inputs");
    await expect(decision.locator("[data-decision-answer-caption]")).toHaveText(
      "Saved with this review.",
      { timeout: 10_000 },
    );
  } finally {
    releaseFirstAttempt();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
