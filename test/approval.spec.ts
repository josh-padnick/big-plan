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
  outstandingAgentRequests,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "../src/review/agent-exchange.js";
import {
  claimAgentRequest,
  commitRequestTerminal,
} from "../src/review/request-mailbox.js";
import { writeSnapshot } from "../src/review/store.js";
import {
  agentIdOf,
  agentSidebar,
  agentStatusTrigger,
  closeReviewRuntime,
  expect,
  runAgentCli,
  startReviewRuntime,
  test,
  type Page,
} from "./fixtures";

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
  "Saved with this review. It survives reload and runtime restarts.";
const READING_CAPTION =
  "Noted for this reading session. It is not saved with the review.";

const releaseDecision = (page: Page) => page.locator("[data-decision]").first();
const rollbackDecision = (page: Page) => page.locator("[data-decision]").nth(1);

const answerGradualRollout = async (page: Page): Promise<void> => {
  const decision = releaseDecision(page);
  await decision.getByRole("radio", { name: "Gradual rollout" }).check();
  await decision.getByRole("button", { name: "Confirm choice" }).click();
};

const startCompiledReviewRuntime = async (
  planPath: string,
  { takeover = false }: { readonly takeover?: boolean } = {},
) => {
  // Playwright wraps JSX values during source transformation, so component
  // journeys use the built renderer exactly as the shipped runtime does.
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  return startReviewRuntime({ planPath, takeover }, startCompiledRuntime);
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
  const agentSessionId = "bbbb1111bbbb1111";
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
      activeSessionId: runtime.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
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
    await commitRequestTerminal({
      store: runtime.store,
      claimedBy: agentSessionId,
      response: validateAgentResponseDraft({
        value: { requestId: request.requestId, message },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: resultSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
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
    // Taking custody is what makes the first page read-only, and custody is
    // never taken by accident: a second runtime has to ask for it.
    const replacement = await startCompiledReviewRuntime(planPath, {
      takeover: true,
    });
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

test("should approve a plan, stamp the page, and keep the record across reload", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-ui-"));
  const planPath = join(directory, "plan.mdx");
  const source = PLAN.replace(
    "Choose the release path before implementation begins.",
    `Choose the release path before implementation begins.

## Release path

Pick the path before the work starts.

## Rollback owner

Name who can reverse the release.

## Follow-through

The approved stamp travels with this reading surface, so the rest of the page needs enough height that a reviewer can scroll it off the toolbar.

The follow-through is not extra product scope. It only gives the stamp a long page to ride.`,
  );
  await writeFile(planPath, source);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await answerGradualRollout(page);
    await expect(
      releaseDecision(page).locator("[data-decision-answer-caption]"),
    ).toHaveText(SAVED_CAPTION);
    // Answering scrolled the decision into view; the stamp geometry below is
    // about where the mark sits on an unscrolled page, and the reading surface
    // scrolls smoothly, so the reset is waited out rather than assumed.
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(1);
    await writeAgentRequest({
      store: runtime.store,
      request: messageAgentRequest({
        kind: "chat",
        requestId: "aaaaaaaaaaaaaaaa",
        sessionId: runtime.sessionId,
        planId: runtime.planId,
        premiseSnapshot: deriveSnapshotDigest(source),
        createdAt: "2026-08-13T17:00:00.000Z",
        body: "Please look at the retry queue.",
      }),
    });
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute(
      "data-review-alert-placement",
      "anchor",
    );
    const triggerBox = await page
      .getByRole("button", { name: "Approve plan" })
      .first()
      .boundingBox();
    const dialogBox = await dialog.boundingBox();
    if (triggerBox === null || dialogBox === null) {
      throw new Error("The approve control and dialog were not laid out");
    }
    expect(dialogBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height - 1);
    expect(
      Math.abs(
        dialogBox.x + dialogBox.width - (triggerBox.x + triggerBox.width),
      ),
    ).toBeLessThan(2);
    const keepReviewing = dialog.getByRole("button", {
      name: "Keep reviewing",
    });
    const approvePlan = dialog.getByRole("button", { name: "Approve plan" });
    const keepBox = await keepReviewing.boundingBox();
    const approveBox = await approvePlan.boundingBox();
    if (keepBox === null || approveBox === null) {
      throw new Error("The approve footer controls were not laid out");
    }
    expect(keepBox.x + keepBox.width).toBeLessThanOrEqual(approveBox.x);
    expect(approveBox.x - (keepBox.x + keepBox.width)).toBeLessThan(20);
    await expect(
      dialog.locator("[data-review-approve-disclosure=approve-decisions]"),
    ).toBeVisible();
    await expect(dialog.locator("[data-review-approve-message]")).toContainText(
      "This plan is approved and we are ready to begin.",
    );
    await expect(
      dialog.locator("[data-review-approve-decision-caveat]"),
    ).toHaveText("Approval will report unanswered decisions as not answered.");
    await expect(
      dialog.locator("[data-review-approve-changeset-caveat]"),
    ).toHaveCount(0);
    await expect(dialog.locator("[data-review-approve-footnote]")).toHaveCount(
      0,
    );

    const approved = page.waitForResponse((response) =>
      response.url().endsWith("/api/approve"),
    );
    const title = page.locator("article h1[data-authored-prose]").first();
    const [titleBoxBeforeApproval, tocBoxBeforeApproval] = await Promise.all([
      title.boundingBox(),
      page.locator("[data-desktop-toc]").boundingBox(),
    ]);
    if (titleBoxBeforeApproval === null || tocBoxBeforeApproval === null) {
      throw new Error("The plan title and contents were not laid out");
    }
    await dialog.getByRole("button", { name: "Approve plan" }).click();
    expect((await approved).ok()).toBe(true);

    // Approving records the answer in the plan source itself, and the page
    // rereads that revision on its own - no reload, no second gesture - so the
    // reviewer watches the question they just settled become the record of it.
    const stampedSource = await readFile(planPath, "utf8");
    expect(stampedSource).toContain(
      '<Decision state="decided" question="Which release path should we use?">',
    );
    expect(stampedSource).toContain(
      '<Option chosen title="Gradual rollout" recommended summary="Start with one group.">',
    );
    expect(stampedSource).toContain(
      '<Decision question="Who owns the rollback?">',
    );
    await expect(releaseDecision(page)).toHaveAttribute(
      "data-decision-status",
      "decided",
    );
    await expect(releaseDecision(page)).toContainText("Answer decided");
    // The approval sentence is the one part a settled decision only says while
    // an approval is actually in force.
    await expect(releaseDecision(page)).toContainText(
      "This plan is approved. Revoke the approval to change the answer.",
    );
    await expect(
      releaseDecision(page).getByRole("button", { name: "Confirm choice" }),
    ).toHaveCount(0);
    await expect(rollbackDecision(page)).toHaveAttribute(
      "data-decision-status",
      "open",
    );

    await expect(
      page.getByRole("button", { name: "Approve plan" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Plan approved" }),
    ).toBeVisible();
    const approvedButton = page.getByRole("button", { name: "Plan approved" });
    const stamp = page
      .locator("[data-review-approval-stamp]")
      .filter({ visible: true });
    await expect(stamp).toBeVisible();
    await expect(
      page.locator("[data-review-approve-status=approved]"),
    ).toBeVisible();
    const stampBox = await stamp.boundingBox();
    const approvedBox = await approvedButton.boundingBox();
    const tocBox = await page.locator("[data-desktop-toc]").boundingBox();
    const headerBox = await page
      .locator("header[data-shell-chrome]")
      .boundingBox();
    const feedbackBox = await page
      .getByRole("button", { name: "Feedback", exact: true })
      .boundingBox();
    if (
      stampBox === null ||
      approvedBox === null ||
      feedbackBox === null ||
      tocBox === null ||
      headerBox === null
    ) {
      throw new Error(
        "The approved stamp, Plan approved control, contents, and Feedback were not laid out",
      );
    }
    expect(approvedBox.x + approvedBox.width).toBeLessThanOrEqual(
      feedbackBox.x,
    );
    const titleBox = await title.boundingBox();
    if (titleBox === null) {
      throw new Error("The plan title left the layout after approval");
    }
    expect(Math.abs(stampBox.x - titleBox.x)).toBeLessThan(2);
    expect(stampBox.x).toBeGreaterThan(tocBox.x + tocBox.width);
    expect(stampBox.y + stampBox.height).toBeLessThanOrEqual(titleBox.y);
    expect(Math.abs(titleBox.x - titleBoxBeforeApproval.x)).toBeLessThan(2);
    expect(Math.abs(titleBox.y - titleBoxBeforeApproval.y)).toBeLessThan(2);
    expect(Math.abs(tocBox.x - tocBoxBeforeApproval.x)).toBeLessThan(2);
    expect(Math.abs(tocBox.y - tocBoxBeforeApproval.y)).toBeLessThan(2);
    expect(stampBox.y).toBeGreaterThanOrEqual(
      headerBox.y + headerBox.height + 4,
    );
    const stampLayer = await stamp.evaluate((element) => {
      const slot = element.parentElement;
      if (slot === null) return null;
      const style = getComputedStyle(slot);
      const type = element.querySelector("[data-review-approval-stamp-type]");
      return {
        position: style.position,
        rotate: style.rotate,
        fontSize: type === null ? null : getComputedStyle(type).fontSize,
      };
    });
    expect(stampLayer?.position).toBe("absolute");
    expect(stampLayer?.rotate).toBe("-3deg");
    expect(stampLayer?.fontSize).toBe("14px");

    await page.getByRole("button", { name: "Feedback" }).click();
    await page.getByRole("tab", { name: "Chat" }).click();
    await expect(
      page.getByText("Approval recorded - no agent connected to notify"),
    ).toBeVisible();

    await approvedButton.click();
    const details = page.locator("[data-review-approval-details]");
    await expect(details).toBeVisible();
    const detailsBox = await details.boundingBox();
    if (detailsBox === null) {
      throw new Error("The approval details panel was not laid out");
    }
    expect(
      Math.abs(
        detailsBox.x + detailsBox.width - (approvedBox.x + approvedBox.width),
      ),
    ).toBeLessThan(2);
    await expect(
      details.locator("[data-review-approval-history-entry]"),
    ).toHaveCount(1);
    await page.locator("[data-review-approval-details-close]").click();

    const stored: unknown = JSON.parse(
      await readFile(runtime.store.approvalPath, "utf8"),
    );
    expect(stored).toMatchObject({
      version: 1,
      entries: [
        {
          kind: "approval",
          pinnedSnapshot: deriveSnapshotDigest(stampedSource),
        },
      ],
    });

    await page.reload();
    await openWritableReview(page, runtime.url);
    await expect(
      page.locator("[data-review-approval-stamp]").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Plan approved" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve plan" }),
    ).toHaveCount(0);

    await test.step("approval clears the mailbox and the agent acknowledges through the CLI", async () => {
      const pinned = deriveSnapshotDigest(stampedSource);
      const claim = await runAgentCli(["next", planPath]);
      expect(claim.stdout).toContain("pending: true");
      expect(claim.stdout).toContain("kind: approval");
      expect(claim.stdout).toContain(planPath);
      expect(claim.stdout).toContain(pinned);
      const exchange = await readAgentExchange({
        store: runtime.store,
        sessionId: runtime.sessionId,
        planId: runtime.planId,
      });
      const pending = outstandingAgentRequests(exchange);
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        kind: "approval",
        planPath,
        pinnedSnapshot: pinned,
      });
      const chat = exchange.requests.find(
        (request) => request.requestId === "aaaaaaaaaaaaaaaa",
      );
      expect(chat?.canceledAt).toBeDefined();
      const approval = pending[0];
      if (approval === undefined) {
        throw new Error("The agent CLI did not return the approval request");
      }
      const draft = /response_file: (\S+)/u.exec(claim.stdout)?.[1];
      if (draft === undefined) {
        throw new Error(
          `The agent CLI returned no response file:\n${claim.stdout}`,
        );
      }
      await writeFile(
        draft,
        JSON.stringify({ requestId: approval.requestId }),
        "utf8",
      );
      const response = await runAgentCli([
        "respond",
        planPath,
        draft,
        "--agent",
        agentIdOf(claim.stdout, "agent_token"),
      ]);
      expect(agentIdOf(response.stdout, "responded")).toBe(approval.requestId);

      await page.reload();
      await openWritableReview(page, runtime.url);
      await page.getByRole("button", { name: /Feedback/u }).click();
      const rail = page.getByRole("complementary", { name: "Feedback" });
      await rail.getByRole("tab", { name: "Chat" }).click();
      await expect(rail).toContainText("Approval acknowledged");
      await rail
        .getByRole("button", { name: /Show \d+ earlier update/u })
        .click();
      await expect(rail).toContainText("Plan approved");
      await expect(rail).toContainText("Approval acknowledged");
      // Nothing was revised, so the session pill must not offer a re-review.
      await expect(rail.locator("[data-review-agent-state]")).toHaveText(
        "Approval acknowledged",
      );

      await agentStatusTrigger(page).click();
      const status = agentSidebar(page);
      await expect(status).not.toContainText("Plan approved");
      await expect(status).not.toContainText("Approval acknowledged");
    });

    await test.step("re-approving leaves both approvals in the details history", async () => {
      await page.getByRole("button", { name: "Plan approved" }).click();
      const details = page.locator("[data-review-approval-details]");
      await details.locator("[data-review-approve-revoke]").click();
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Approve plan" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Approve plan" }).click();
      const reapproved = page.waitForResponse((response) =>
        response.url().endsWith("/api/approve"),
      );
      await page
        .locator("[data-review-approve-dialog]")
        .getByRole("button", { name: "Approve plan" })
        .click();
      expect((await reapproved).ok()).toBe(true);

      await page.getByRole("button", { name: "Plan approved" }).click();
      const entries = details.locator("[data-review-approval-history-entry]");
      await expect(entries).toHaveCount(2);
      await expect(
        details.locator("[data-review-approval-history-revoked]"),
      ).toHaveCount(1);
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should report an approval the agent refused to acknowledge", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-stop-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await page.getByRole("button", { name: "Approve plan" }).click();
    const approved = page.waitForResponse((response) =>
      response.url().endsWith("/api/approve"),
    );
    await dialog.getByRole("button", { name: "Approve plan" }).click();
    expect((await approved).ok()).toBe(true);

    // The plan moves after the handoff, so the agent cannot reach the digest
    // it was pinned to and has a real stop to report.
    await writeFile(planPath, `${PLAN}\nThe reviewer kept writing.\n`);
    const claim = await runAgentCli(["next", planPath]);
    const draft = /response_file: (\S+)/u.exec(claim.stdout)?.[1];
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const approval = exchange.requests.find(
      (request) => request.kind === "approval",
    );
    if (draft === undefined || approval === undefined) {
      throw new Error(
        `The agent CLI did not hand over the approval:\n${claim.stdout}`,
      );
    }
    await writeFile(
      draft,
      JSON.stringify({
        requestId: approval.requestId,
        hardStop: "The plan no longer matches the pinned snapshot.",
      }),
      "utf8",
    );
    await runAgentCli([
      "respond",
      planPath,
      draft,
      "--agent",
      agentIdOf(claim.stdout, "agent_token"),
    ]);

    await page.reload();
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: /Feedback/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    // The refusal is what the thread says, with the agent's own reason, and
    // never that the agent holds the approved plan.
    await expect(rail).toContainText(
      "Approval not acknowledged \u2014 The plan no longer matches the pinned snapshot.",
    );
    await expect(rail).not.toContainText(
      "The agent has the approved plan and the decisions recorded with it.",
    );
    await expect(rail.locator("[data-review-agent-state]")).not.toHaveText(
      "Approval acknowledged",
    );

    await agentStatusTrigger(page).click();
    const status = agentSidebar(page);
    await expect(status).not.toContainText("Approval not acknowledged");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should close the approve dialog when Edit in Settings is chosen", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-settings-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Edit in Settings" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Approval message" }),
    ).toHaveAttribute("aria-selected", "true");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should approve with a message that settings could not save", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
    Storage.prototype.removeItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
  });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-note-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("tab", { name: "Approval message" }).click();
    const note = "Start with the migration, then report back.";
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(note);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog.locator("[data-review-approve-message]")).toHaveText(
      note,
    );
    await dialog.getByRole("button", { name: "Approve plan" }).click();
    await expect(
      page.getByRole("button", { name: "Plan approved" }),
    ).toBeVisible();
    const record: unknown = JSON.parse(
      await readFile(runtime.store.approvalPath, "utf8"),
    );
    expect(record).toMatchObject({
      entries: [expect.objectContaining({ message: note })],
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep the approve dialog anchored without a mobile dimmer", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-mobile-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWritableReview(page, runtime.url);
    const trigger = page.getByRole("button", { name: "Approve plan" }).first();
    await trigger.click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog).toHaveAttribute(
      "data-review-alert-placement",
      "anchor",
    );
    await expect(page.locator("[data-modal-backdrop]")).toHaveCount(0);
    const [triggerBox, dialogBox] = await Promise.all([
      trigger.boundingBox(),
      dialog.boundingBox(),
    ]);
    if (triggerBox === null || dialogBox === null) {
      throw new Error(
        "The mobile approve control and dialog were not laid out",
      );
    }
    expect(
      Math.abs(
        dialogBox.x + dialogBox.width - (triggerBox.x + triggerBox.width),
      ),
    ).toBeLessThan(2);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep an approved stamp when the stable address follows a takeover", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-readonly-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  let replacement:
    Awaited<ReturnType<typeof startCompiledReviewRuntime>> | undefined;
  try {
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: "Approve plan" }).click();
    await page
      .getByRole("alertdialog", { name: "Approve this plan?" })
      .getByRole("button", { name: "Approve plan" })
      .click();
    await expect(
      page.getByRole("button", { name: "Plan approved" }),
    ).toBeVisible();
    replacement = await startCompiledReviewRuntime(planPath, {
      takeover: true,
    });
    if (process.env["BIG_PLAN_PROXY"] === "0") {
      await expect(
        page.getByRole("button", { name: /Using read-only session/ }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("button", { name: "Plan approved" }),
      ).toBeVisible();
      return;
    }
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const response = await fetch("api/session", {
            headers: {
              "x-big-plan-review-token":
                document.documentElement.dataset.reviewToken ?? "",
            },
          });
          const session: unknown = await response.json();
          return typeof session === "object" &&
            session !== null &&
            "sessionId" in session
            ? session.sessionId
            : undefined;
        }),
      )
      .toBe(replacement.sessionId);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-session",
      replacement.sessionId,
      { timeout: 10_000 },
    );
    await expect(page).toHaveURL(`${runtime.url}/`);
    await expect(
      page.getByRole("button", { name: "Plan approved" }),
    ).toBeVisible();
    await expect(
      page.locator("[data-review-approve-status=approved]"),
    ).toBeVisible();
  } finally {
    await replacement?.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should show a recorded decision as answered in the approve dialog", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-answered-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await answerGradualRollout(page);
    await expect(
      releaseDecision(page).locator("[data-decision-answer-caption]"),
    ).toHaveText(SAVED_CAPTION);
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator("[data-review-approve-disclosure=approve-decisions]"),
    ).toContainText("1 of 2 answered");
    await expect(dialog.getByText("Who owns the rollback?")).toBeVisible();
    await expect(dialog.locator("[data-review-approve-decision]")).toHaveCount(
      1,
    );
    await expect(dialog.getByText("No answer recorded")).toHaveCount(1);
    await expect(
      dialog.getByText("Which release path should we use?"),
    ).toHaveCount(0);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should open Inputs and flash standing from leftover review decisions", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-inputs-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    const approved = page.waitForResponse((response) =>
      response.url().endsWith("/api/approve"),
    );
    await dialog.getByRole("button", { name: "Approve plan" }).click();
    expect((await approved).ok()).toBe(true);
    await page.getByRole("button", { name: "Plan approved" }).click();
    await page.getByRole("button", { name: "Review decisions →" }).click();
    const inputsTab = page.getByRole("tab", { name: "Inputs" });
    await expect(inputsTab).toHaveAttribute("aria-selected", "true");
    const needs = page.locator("[data-review-input-needs]");
    await expect(needs).toBeVisible();
    await expect(needs).toContainText("What this review needs");
    await expect(needs).toHaveAttribute("data-review-input-needs-flash", "");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should refuse approve until a critical decision is answered", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-approve-critical-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    PLAN.replace(
      '<Decision question="Which release path should we use?">',
      '<Decision critical question="Which release path should we use?">',
    ),
  );
  const runtime = await startCompiledReviewRuntime(planPath);
  try {
    await openWritableReview(page, runtime.url);
    await page.getByRole("button", { name: "Approve plan" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this plan?",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator("[data-review-approve-critical]"),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Approve plan" }).click();
    await expect(dialog.locator("[data-review-approve-block]")).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(
      await readFile(runtime.store.approvalPath, "utf8").catch(() => ""),
    ).toBe("");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
