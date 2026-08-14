// Proves durable decision answers through the complete live review runtime:
// reload, retraction, clearing, the currency of an edited decision, the
// bootstrap window before authority is known, and a visible persistence
// failure.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

<Decision question="Who owns the rollback?">

<Option title="The release engineer" recommended summary="One named owner.">
<Consideration label="Speed" verdict="Fast" tone="good" />
</Option>

<Option title="The on-call rotation" summary="Whoever is paged.">
<Consideration label="Speed" verdict="Slower" tone="mixed" />
</Option>

</Decision>
`;

// The captions say what a recorded answer means, so they are asserted as whole
// sentences rather than as the presence of a word.
const SAVED_CAPTION =
  "Saved with this review. Your agent receives it when you approve the plan.";
const READING_CAPTION =
  "Noted for this reading session. It is not recorded for your agent.";

const releaseDecision = (page: Page) => page.locator("[data-decision]").first();
const rollbackDecision = (page: Page) => page.locator("[data-decision]").nth(1);

const answerGradualRollout = async (page: Page): Promise<void> => {
  const decision = releaseDecision(page);
  await decision.getByRole("radio", { name: "Gradual rollout" }).check();
  await decision.getByRole("button", { name: "Confirm choice" }).click();
};

const startCompiledReviewRuntime = async (planPath: string) => {
  // Playwright wraps JSX values during source transformation, so component
  // journeys use the built renderer exactly as the shipped runtime does.
  const { startReviewRuntime } = await import("../dist/review/server.js");
  return startReviewRuntime({ planPath });
};

const isInputOperation = (
  response: {
    readonly url: () => string;
    readonly request: () => {
      readonly method: () => string;
      readonly postDataJSON: () => unknown;
    };
  },
  operation: "stage" | "retract",
): boolean => {
  if (
    !response.url().endsWith("/api/inputs") ||
    response.request().method() !== "POST"
  ) {
    return false;
  }
  const body = response.request().postDataJSON();
  return typeof body === "object" && body !== null && "op" in body
    ? body.op === operation
    : false;
};

// A writable review is open once the session has answered and the answers
// record has been read, because those two responses are what decides whether a
// confirm is written and what the cards already show.
const openWritableReview = async (page: Page, url: string): Promise<void> => {
  const session = page.waitForResponse((response) =>
    response.url().endsWith("/api/session"),
  );
  const answers = page.waitForResponse((response) =>
    response.url().endsWith("/api/review-state"),
  );
  await page.goto(url);
  expect((await session).ok()).toBe(true);
  expect((await answers).ok()).toBe(true);
};

const storedAnswers = async (inputsPath: string): Promise<unknown> => {
  const stored: unknown = JSON.parse(await readFile(inputsPath, "utf8"));
  return typeof stored === "object" && stored !== null && "answers" in stored
    ? stored.answers
    : undefined;
};

test("should persist, retract, and clear a confirmed decision answer", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approval-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);

    await test.step("a confirmed answer survives reload", async () => {
      const staged = page.waitForResponse((response) =>
        isInputOperation(response, "stage"),
      );
      await answerGradualRollout(page);
      expect((await staged).ok()).toBe(true);
      await expect(
        releaseDecision(page).locator("[data-decision-answer-caption]"),
      ).toHaveText(SAVED_CAPTION);

      await page.reload();
      await expect(
        releaseDecision(page).getByRole("radio", { name: "Gradual rollout" }),
      ).toBeChecked();
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeVisible();
      await expect(
        releaseDecision(page).locator("[data-decision-answer-caption]"),
      ).toHaveText(SAVED_CAPTION);
    });

    await test.step("an answers response older than the applied one is ignored", async () => {
      let markReadStarted = (): void => undefined;
      let releaseRead = (): void => undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let delayed = false;
      await page.route("**/api/review-state", async (route) => {
        if (!delayed) {
          delayed = true;
          markReadStarted();
          await readGate;
        }
        await route.continue();
      });
      try {
        await page.goto(runtime.url);
        await readStarted;
        const staged = page.waitForResponse((response) =>
          isInputOperation(response, "stage"),
        );
        const decision = releaseDecision(page);
        await decision
          .getByRole("radio", { name: "Immediate rollout" })
          .check();
        await decision.getByRole("button", { name: "Confirm choice" }).click();
        expect((await staged).ok()).toBe(true);
        releaseRead();
        await expect(
          decision.locator("[data-decision-answer-caption]"),
        ).toHaveText(SAVED_CAPTION);
        // The delayed read was answered before the write and carries the older
        // revision, so it must not put the previous option back on the card.
        await expect(
          decision.getByRole("radio", { name: "Immediate rollout" }),
        ).toBeChecked();
      } finally {
        releaseRead();
        await page.unroute("**/api/review-state");
      }
    });

    await test.step("changing the answer retracts it durably", async () => {
      const retracted = page.waitForResponse((response) =>
        isInputOperation(response, "retract"),
      );
      await releaseDecision(page)
        .getByRole("button", { name: "Change" })
        .click();
      expect((await retracted).ok()).toBe(true);
      await page.reload();
      await expect(
        releaseDecision(page).locator("[data-decision-footer]"),
      ).toBeVisible();
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeHidden();
    });

    await test.step("clearing leaves the decision unanswered on purpose", async () => {
      await openWritableReview(page, runtime.url);
      const staged = page.waitForResponse((response) =>
        isInputOperation(response, "stage"),
      );
      await answerGradualRollout(page);
      expect((await staged).ok()).toBe(true);

      const decision = releaseDecision(page);
      const clear = decision.getByRole("button", { name: "Clear answer" });
      await expect(clear).toBeHidden();
      await decision.getByRole("button", { name: "Change" }).click();
      await expect(clear).toBeVisible();

      // Clearing is an action beside the options; the options themselves stay
      // answers to "which one?", with no entry standing for having none.
      await expect(decision.getByRole("radio")).toHaveCount(3);
      for (const name of [
        "Gradual rollout",
        "Immediate rollout",
        "Suggest another option",
      ]) {
        await expect(decision.getByRole("radio", { name })).toHaveCount(1);
      }

      await clear.click();
      await expect(
        decision.getByRole("radio", { name: "Gradual rollout" }),
      ).not.toBeChecked();
      await expect(clear).toBeHidden();
      await expect(decision.locator("[data-decision-answer]")).toBeHidden();

      await page.reload();
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeHidden();
      expect(await storedAnswers(runtime.store.inputsPath)).toEqual([]);
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should mask an answer whose decision changed and restore it with the wording", async ({
  page,
}) => {
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-approval-currency-"),
  );
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  const reworded = PLAN.replace(
    "Which release path should we use?",
    "How should the release reach users?",
  );
  const publishRevision = async ({
    requestId,
    source,
    baseline,
    message,
  }: {
    readonly requestId: string;
    readonly source: string;
    readonly baseline: string;
    readonly message: string;
  }): Promise<void> => {
    const request = messageAgentRequest({
      kind: "chat",
      requestId,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
      premiseSnapshot: baseline,
      createdAt: new Date().toISOString(),
      body: message,
    });
    await writeAgentRequest({ store: runtime.store, request });
    const claimed = await claimAgentRequest({
      store: runtime.store,
      requestId: request.requestId,
      baselineSnapshot: baseline,
      now: new Date().toISOString(),
    });
    const resultSnapshot = deriveSnapshotDigest(source);
    await writeFile(planPath, source);
    await writeSnapshot({
      store: runtime.store,
      snapshot: resultSnapshot,
      source,
    });
    await publishAgentResponse({
      store: runtime.store,
      response: validateAgentResponseDraft({
        value: { requestId: request.requestId, message },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: resultSnapshot,
        now: new Date().toISOString(),
      }),
    });
  };
  try {
    await openWritableReview(page, runtime.url);
    const staged = page.waitForResponse((response) =>
      isInputOperation(response, "stage"),
    );
    await answerGradualRollout(page);
    expect((await staged).ok()).toBe(true);

    await test.step("a reworded question masks its answer and keeps the record", async () => {
      await publishRevision({
        requestId: "1111111111111111",
        source: reworded,
        baseline: deriveSnapshotDigest(PLAN),
        message: "Clarify the release decision.",
      });

      await expect(releaseDecision(page)).toContainText(
        "How should the release reach users?",
        { timeout: 15_000 },
      );
      await expect(
        releaseDecision(page).locator("[data-decision-footer]"),
      ).toBeVisible();
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeHidden();
      // Masked, never deleted: the record is what makes the restore below a
      // recovery rather than a re-answer.
      expect(await storedAnswers(runtime.store.inputsPath)).toMatchObject([
        { optionTitle: "Gradual rollout" },
      ]);
    });

    await test.step("restoring the exact wording shows the original answer again", async () => {
      await publishRevision({
        requestId: "2222222222222222",
        source: PLAN,
        baseline: deriveSnapshotDigest(reworded),
        message: "Restore the original decision wording.",
      });

      await expect(releaseDecision(page)).toContainText(
        "Which release path should we use?",
        { timeout: 15_000 },
      );
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        releaseDecision(page).getByRole("radio", { name: "Gradual rollout" }),
      ).toBeChecked();
    });

    await test.step("an edit the ids survive says on the card that the answer stopped applying", async () => {
      await publishRevision({
        requestId: "3333333333333333",
        source: PLAN.replace(
          "Start with one group.",
          "Start with the beta group.",
        ),
        baseline: deriveSnapshotDigest(PLAN),
        message: "Sharpen the gradual rollout summary.",
      });

      const notice = releaseDecision(page).locator(
        "[data-decision-superseded]",
      );
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice).toHaveText(
        "This decision changed after you answered it. Answer it again to record your choice.",
      );
      await expect(
        releaseDecision(page).locator("[data-decision-answer]"),
      ).toBeHidden();

      const restaged = page.waitForResponse((response) =>
        isInputOperation(response, "stage"),
      );
      await answerGradualRollout(page);
      expect((await restaged).ok()).toBe(true);
      await expect(notice).toBeHidden();
      await expect(
        releaseDecision(page).locator("[data-decision-answer-caption]"),
      ).toHaveText(SAVED_CAPTION);
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should hold a confirm made before the session answers, then save it", async ({
  page,
}) => {
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-approval-authority-"),
  );
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  let markSessionRequestStarted = (): void => undefined;
  let releaseSessionRequest = (): void => undefined;
  const sessionRequestStarted = new Promise<void>((resolve) => {
    markSessionRequestStarted = resolve;
  });
  const sessionRequestGate = new Promise<void>((resolve) => {
    releaseSessionRequest = resolve;
  });
  let inputWrites = 0;
  try {
    // A saved answer from an earlier visit is what the bootstrap window must
    // not disturb while a new confirm is being held.
    await openWritableReview(page, runtime.url);
    const seeded = page.waitForResponse((response) =>
      isInputOperation(response, "stage"),
    );
    await rollbackDecision(page)
      .getByRole("radio", { name: "The release engineer" })
      .check();
    await rollbackDecision(page)
      .getByRole("button", { name: "Confirm choice" })
      .click();
    expect((await seeded).ok()).toBe(true);

    await page.route("**/api/session", async (route) => {
      markSessionRequestStarted();
      await sessionRequestGate;
      await route.continue();
    });
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/inputs") &&
        request.method() === "POST"
      ) {
        inputWrites += 1;
      }
    });
    await page.goto(runtime.url);
    await sessionRequestStarted;

    await answerGradualRollout(page);
    await expect(
      releaseDecision(page).locator("[data-decision-answer-caption]"),
    ).toHaveText("Saving with this review...");
    expect(inputWrites).toBe(0);
    // The earlier answer stays on the page while this one waits.
    await expect(
      rollbackDecision(page).getByRole("radio", {
        name: "The release engineer",
      }),
    ).toBeChecked();

    const staged = page.waitForResponse((response) =>
      isInputOperation(response, "stage"),
    );
    releaseSessionRequest();
    expect((await staged).ok()).toBe(true);
    await expect(
      releaseDecision(page).locator("[data-decision-answer-caption]"),
    ).toHaveText(SAVED_CAPTION);

    await page.unroute("**/api/session");
    await page.reload();
    await expect(
      releaseDecision(page).getByRole("radio", { name: "Gradual rollout" }),
    ).toBeChecked();
    await expect(
      rollbackDecision(page).getByRole("radio", {
        name: "The release engineer",
      }),
    ).toBeChecked();
  } finally {
    releaseSessionRequest();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should turn a held confirm into a reading-session answer when read-only", async ({
  page,
}) => {
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-approval-readonly-"),
  );
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  let markSessionRequestStarted = (): void => undefined;
  let releaseSessionRequest = (): void => undefined;
  const sessionRequestStarted = new Promise<void>((resolve) => {
    markSessionRequestStarted = resolve;
  });
  const sessionRequestGate = new Promise<void>((resolve) => {
    releaseSessionRequest = resolve;
  });
  let inputWrites = 0;
  try {
    await page.route("**/api/session", async (route) => {
      markSessionRequestStarted();
      await sessionRequestGate;
      await route.continue();
    });
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/inputs") &&
        request.method() === "POST"
      ) {
        inputWrites += 1;
      }
    });
    await page.goto(runtime.url);
    await sessionRequestStarted;
    const replacement = await startCompiledReviewRuntime(planPath);
    try {
      await answerGradualRollout(page);
      expect(inputWrites).toBe(0);

      releaseSessionRequest();
      await expect(
        page.getByRole("button", { name: /Using read-only session/ }),
      ).toBeVisible();
      await expect(
        releaseDecision(page).locator("[data-decision-answer-caption]"),
      ).toHaveText(READING_CAPTION);
      expect(inputWrites).toBe(0);

      // Once the session is known read-only the card stops offering an answer
      // at all: the controls are inert and say why beside themselves.
      const decision = releaseDecision(page);
      await expect(
        decision.getByRole("button", { name: "Change" }),
      ).toBeDisabled();
      await expect(
        decision.locator("[data-decision-locked-note]:visible").first(),
      ).toHaveText("This review is read-only, so no answer can be recorded.");

      // The decision nobody answered is the one that shows what a read-only
      // review offers: nothing to pick, nothing to confirm, and the reason why.
      const unanswered = rollbackDecision(page);
      await expect(
        unanswered.getByRole("button", { name: "Confirm choice" }),
      ).toBeDisabled();
      for (const name of [
        "The release engineer",
        "The on-call rotation",
        "Suggest another option",
      ]) {
        await expect(unanswered.getByRole("radio", { name })).toBeDisabled();
      }
      await expect(
        unanswered.locator("[data-decision-locked-note]:visible").first(),
      ).toHaveText("This review is read-only, so no answer can be recorded.");
      expect(inputWrites).toBe(0);
    } finally {
      releaseSessionRequest();
      await replacement.close();
    }
  } finally {
    releaseSessionRequest();
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
    await openWritableReview(page, runtime.url);
    await answerGradualRollout(page);
    await firstAttemptStarted;
    const decision = releaseDecision(page);
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
      SAVED_CAPTION,
      { timeout: 10_000 },
    );
  } finally {
    releaseFirstAttempt();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
