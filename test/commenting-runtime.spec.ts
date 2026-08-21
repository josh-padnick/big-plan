// Critical browser journeys for the local review runtime behind the React
// commenting chrome: durable review state, feedback handoff, and honest
// request-lifecycle refusals.

import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commentsFromExchange,
  deriveSnapshotDigest,
  messageAgentRequest,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "../src/review/agent-exchange.js";
import type { AgentFeedbackRequest } from "../src/review/agent-exchange.js";
import {
  appendProgressEvent,
  claimAgentRequest,
  commitRequestTerminal,
} from "../src/review/request-mailbox.js";
import { diffSnapshots } from "../src/review/snapshot-diff.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  reviewStoreFor,
  writeAgentHeartbeat,
  writeSnapshot,
} from "../src/review/store.js";
import { renderDocument } from "../src/render/render-document.js";
import { AGENT_CLAIM_LEASE_MS } from "../src/review/shared/agent-claim.js";
import {
  agentSidebar,
  agentStatusIndicator,
  agentStatusTrigger,
  boxOf,
  expect,
  stageComment,
  test,
  type Page,
  closeReviewRuntime,
} from "./fixtures";
import { RESOLVED_THREAD_NEW_WORK_ERROR } from "../src/review/shared/resolved-thread-work.js";

const PASTED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// These journeys stand in for one coding agent working the review, so every
// claim they take and every pickup they ask for speaks as the same session.
const agentSessionId = "aaaa0000aaaa0000";
const agentViewer = () => ({ claimedBy: agentSessionId, nowMs: Date.now() });

// Two distinct authored pictures, so a swap between them is visible in the
// diff as two different sources rather than as identical alternative words.
const WIDE_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGMQqTgBRwzIHACEmgqhmuCM0QAAAABJRU5ErkJggg==";
const TALL_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAIAAAArjXluAAAAEElEQVR4nGO4E6UBRAzYKACe3Arxvs3ORQAAAABJRU5ErkJggg==";

test("should refuse a reply on a resolved thread and keep the typed text", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const commentBody = "Need a second look at the retry boundary.";
  const replyBody = "Please walk through the failure case again.";
  await stageComment(page, commentBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await sent).ok()).toBe(true);
  const thread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: commentBody });
  await thread
    .getByRole("button", { name: `Expand queued comment: ${commentBody}` })
    .click();
  const canceled = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/agent-cancel") &&
      response.request().method() === "POST",
  );
  await thread.getByRole("button", { name: "Cancel request" }).click();
  expect((await canceled).ok()).toBe(true);
  await expect(thread).toContainText("Request canceled");
  await thread.getByRole("button", { name: "Resolve thread" }).click();
  await rail.getByText("Resolved (1)").click();
  const resolvedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: commentBody });
  await resolvedThread
    .getByRole("button", { name: `Expand thread: ${commentBody}` })
    .click();
  const replyBox = resolvedThread.getByLabel("Reply to the agent");
  await replyBox.fill(replyBody);
  await resolvedThread.getByRole("button", { name: "Reply" }).click();
  await expect(
    resolvedThread.getByText(RESOLVED_THREAD_NEW_WORK_ERROR),
  ).toBeVisible();
  await expect(replyBox).toHaveValue(replyBody);

  await resolvedThread
    .getByRole("button", { name: "Unresolve thread" })
    .click();
  const reopenedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: commentBody });
  await expect(reopenedThread).toBeVisible();
  const reopenedReplyBox = reopenedThread.getByLabel("Reply to the agent");
  await expect(reopenedReplyBox).toBeVisible();
  await expect(reopenedReplyBox).toHaveValue(replyBody);
  await expect(
    reopenedThread.getByRole("button", { name: "Resolve thread" }),
  ).toBeVisible();
  await expect(
    reopenedThread.getByText(RESOLVED_THREAD_NEW_WORK_ERROR),
  ).toHaveCount(0);
});

test("should keep one staged comment after reloading the live review", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const commentBody = "Keep this staged comment unique after reload.";
  await stageComment(page, commentBody);

  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const feedback = page.getByRole("complementary", { name: "Feedback" });
  await expect(
    feedback.getByRole("button", {
      name: `Expand staged comment: ${commentBody}`,
    }),
  ).toHaveCount(1);
});

test("should hydrate when browser recovery storage is blocked", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.addInitScript(() => {
    const blocked = (): never => {
      throw new DOMException("Storage is blocked", "SecurityError");
    };
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value: blocked,
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value: blocked,
    });
  });
  await page.goto(reviewRuntimeUrl);

  await page.getByRole("button", { name: "Feedback" }).click();
  await expect(
    page.getByText(
      "Browser recovery is unavailable. The live review remains usable, but browser-only drafts cannot be recovered after a reload.",
    ),
  ).toBeVisible();
  const token = await reviewToken(page);
  const body = "Keep the review usable without browser storage.";
  await stageComment(page, body);
  await expect
    .poll(async () =>
      (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
        (draft) => draft.body,
      ),
    )
    .toEqual([body]);
});

test("should disclose a recovery write failure after hydration", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await page.getByRole("button", { name: "Feedback" }).click();
  await page.evaluate(() => {
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value: (): never => {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });
  });

  await page.getByRole("button", { name: "Comment on slide" }).first().click();
  await page
    .getByRole("dialog", { name: /Comment on/u })
    .getByLabel("Add a comment")
    .fill("This text no longer has durable browser recovery.");

  await expect(
    page.getByText(
      "Browser recovery is unavailable. The live review remains usable, but browser-only drafts cannot be recovered after a reload.",
    ),
  ).toBeVisible();
});

test("should keep unsent comment text through a reload", async ({
  page,
  reviewRuntimeUrl,
}) => {
  // Text that is typed but not yet sent has no home on the runtime, so a
  // reload is the whole test: the reviewer must get back what was on screen.
  await page.goto(reviewRuntimeUrl);
  const sentBody = "Send this so the thread has a reply box.";
  await stageComment(page, sentBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const submission = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submission).ok()).toBe(true);

  const thread = rail.locator("[data-review-sent-thread]").first();
  await thread
    .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
    .click();
  const replyBody = "Keep this half-written reply through the reload.";
  await thread.getByPlaceholder("Reply to the agent…").fill(replyBody);

  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  const composerBody = "Keep this half-written comment through the reload.";
  await composer.getByLabel("Add a comment").fill(composerBody);

  await page.reload();

  await expect(
    page
      .getByRole("dialog", { name: /Comment on/u })
      .getByLabel("Add a comment"),
  ).toHaveValue(composerBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const restoredThread = page
    .getByRole("complementary", { name: "Feedback" })
    .locator("[data-review-sent-thread]")
    .first();
  await restoredThread
    .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
    .click();
  await expect(
    restoredThread.getByPlaceholder("Reply to the agent…"),
  ).toHaveValue(replyBody);
});

test("should keep reviewer input created while hydration is pending", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const token = await reviewToken(page);
  const runtimeBody = "Restore this runtime comment around newer input.";
  await stageComment(page, runtimeBody);
  await expect
    .poll(async () =>
      (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
        (draft) => draft.body,
      ),
    )
    .toEqual([runtimeBody]);

  let releaseHydration = (): void => undefined;
  const hydrationMayFinish = new Promise<void>((resolve) => {
    releaseHydration = resolve;
  });
  let markHydrationStarted = (): void => undefined;
  const hydrationStarted = new Promise<void>((resolve) => {
    markHydrationStarted = resolve;
  });
  await page.route(
    "**/api/drafts",
    async (route) => {
      const response = await route.fetch();
      markHydrationStarted();
      await hydrationMayFinish;
      await route.fulfill({ response });
    },
    { times: 1 },
  );

  const reload = page.reload();
  await hydrationStarted;
  const stagedWhileLoading = "Keep this comment staged while loading.";
  await stageComment(page, stagedWhileLoading);
  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const composerBody = "Keep this composer text typed while loading.";
  await page
    .getByRole("dialog", { name: /Comment on/u })
    .getByLabel("Add a comment")
    .fill(composerBody);
  releaseHydration();
  await reload;

  await expect(
    page
      .getByRole("dialog", { name: /Comment on/u })
      .getByLabel("Add a comment"),
  ).toHaveValue(composerBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toContainText(runtimeBody);
  await expect(rail).toContainText(stagedWhileLoading);
});

test("should keep unsent comment text separate across two tabs", async ({
  context,
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const sentBody = "Give both tabs the same thread to reply to.";
  await stageComment(page, sentBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const firstRail = page.getByRole("complementary", { name: "Feedback" });
  const submission = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await firstRail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submission).ok()).toBe(true);

  const secondPage = await context.newPage();
  await secondPage.goto(reviewRuntimeUrl);

  const typeAndReload = async ({
    targetPage,
    composerBody,
    replyBody,
  }: {
    readonly targetPage: Page;
    readonly composerBody: string;
    readonly replyBody: string;
  }): Promise<void> => {
    const feedbackButton = targetPage.getByRole("button", {
      name: /^Feedback(?: \d+)?$/u,
    });
    if ((await feedbackButton.getAttribute("aria-expanded")) !== "true") {
      await feedbackButton.click();
    }
    const rail = targetPage.getByRole("complementary", { name: "Feedback" });
    const thread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: sentBody });
    const expandThread = thread.getByRole("button", {
      name: `Expand queued comment: ${sentBody}`,
    });
    await expandThread.click();
    await thread.getByPlaceholder("Reply to the agent…").fill(replyBody);

    const slide = targetPage.locator("[data-slide]").first();
    await slide.hover();
    await slide.getByRole("button", { name: "Comment on slide" }).click();
    await targetPage
      .getByRole("dialog", { name: /Comment on/u })
      .getByLabel("Add a comment")
      .fill(composerBody);

    await targetPage.reload();
    await expect(
      targetPage
        .getByRole("dialog", { name: /Comment on/u })
        .getByLabel("Add a comment"),
    ).toHaveValue(composerBody);
    await targetPage
      .getByRole("button", { name: /^Feedback(?: \d+)?$/u })
      .click();
    const restoredThread = targetPage
      .getByRole("complementary", { name: "Feedback" })
      .locator("[data-review-sent-thread]")
      .filter({ hasText: sentBody });
    await restoredThread
      .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
      .click();
    await expect(
      restoredThread.getByPlaceholder("Reply to the agent…"),
    ).toHaveValue(replyBody);
  };

  const firstComposer = "Keep the first tab's composer text.";
  const firstReply = "Keep the first tab's reply text.";
  await typeAndReload({
    targetPage: page,
    composerBody: firstComposer,
    replyBody: firstReply,
  });
  const secondComposer = "Keep the second tab's composer text.";
  const secondReply = "Keep the second tab's reply text.";
  await typeAndReload({
    targetPage: secondPage,
    composerBody: secondComposer,
    replyBody: secondReply,
  });

  const duplicatePagePromise = context.waitForEvent("page");
  await page.evaluate((url) => window.open(url, "_blank"), reviewRuntimeUrl);
  const duplicatePage = await duplicatePagePromise;
  await duplicatePage.waitForURL(reviewRuntimeUrl);
  const duplicateComposer = "Keep the duplicated tab's composer text.";
  const duplicateReply = "Keep the duplicated tab's reply text.";
  await typeAndReload({
    targetPage: duplicatePage,
    composerBody: duplicateComposer,
    replyBody: duplicateReply,
  });

  for (const [targetPage, composerBody, replyBody] of [
    [page, firstComposer, firstReply],
    [secondPage, secondComposer, secondReply],
    [duplicatePage, duplicateComposer, duplicateReply],
  ] as const) {
    await targetPage.reload();
    await expect(
      targetPage
        .getByRole("dialog", { name: /Comment on/u })
        .getByLabel("Add a comment"),
    ).toHaveValue(composerBody);
    await targetPage
      .getByRole("button", { name: /^Feedback(?: \d+)?$/u })
      .click();
    const thread = targetPage
      .getByRole("complementary", { name: "Feedback" })
      .locator("[data-review-sent-thread]")
      .filter({ hasText: sentBody });
    await thread
      .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
      .click();
    await expect(thread.getByPlaceholder("Reply to the agent…")).toHaveValue(
      replyBody,
    );
  }
  await duplicatePage.close();
  await secondPage.close();
});

test("should retain detached selection text until the reviewer discards it", async ({
  context,
  page,
  reviewRuntimeUrl,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(reviewRuntimeUrl).origin,
  });
  await page.goto(reviewRuntimeUrl);
  const recoveryKey = await ownedLiveRecoveryKey(page);
  const recovery = await page
    .locator("[data-block-kind='paragraph']")
    .first()
    .evaluate((block) => {
      const root = document.documentElement;
      const text = block.textContent ?? "";
      return {
        snapshot: (() => {
          const bootstrap: unknown = JSON.parse(
            root.getAttribute("data-review-bootstrap") ?? "{}",
          );
          return typeof bootstrap === "object" &&
            bootstrap !== null &&
            "currentSnapshot" in bootstrap &&
            typeof bootstrap.currentSnapshot === "string"
            ? bootstrap.currentSnapshot
            : "";
        })(),
        target: {
          type: "selection" as const,
          blockId: block.getAttribute("data-block-id") ?? "",
          endBlockId: "missing/paragraph",
          kind: block.getAttribute("data-block-kind") ?? "paragraph",
          label: block.getAttribute("data-block-label") ?? "Paragraph",
          start: 0,
          end: 1,
          quote: text.slice(0, 1),
          isQuoteExcerpt: false,
        },
      };
    });
  const body = "Do not attach this selection comment to only half its range.";
  await page.evaluate(
    ({ key, snapshot, target, recoveredBody }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 11,
          drafts: [],
          resolvedCommentIds: [],
          reconciliation: {
            base: { draftBodies: {}, resolvedCommentIds: [] },
            conflicts: [],
            runtime: null,
          },
          composer: {
            comment: {
              target,
              premiseSnapshot: snapshot,
              body: recoveredBody,
            },
            replies: {},
          },
        }),
      );
    },
    { ...recovery, key: recoveryKey, recoveredBody: body },
  );

  await page.reload();

  await expect(page.getByRole("dialog", { name: /Comment on/u })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const feedback = page.getByRole("complementary", { name: "Feedback" });
  const detachedNotice = feedback.getByRole("status").filter({
    hasText:
      "The comment you were writing could not be reattached: its place in the plan is gone.",
  });
  await expect(detachedNotice).toContainText(
    "The comment you were writing could not be reattached: its place in the plan is gone.",
  );
  await expect(detachedNotice).toContainText(body);
  await detachedNotice.getByRole("button", { name: "Copy text" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(body);

  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const restoredNotice = page
    .getByRole("complementary", { name: "Feedback" })
    .getByRole("status")
    .filter({ hasText: body });
  await expect(restoredNotice).toContainText(body);
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" &&
          parsed !== null &&
          "composer" in parsed &&
          typeof parsed.composer === "object" &&
          parsed.composer !== null &&
          "comment" in parsed.composer &&
          typeof parsed.composer.comment === "object" &&
          parsed.composer.comment !== null &&
          "body" in parsed.composer.comment &&
          typeof parsed.composer.comment.body === "string"
          ? parsed.composer.comment.body
          : null;
      }, recoveryKey),
    )
    .toBe(body);

  await restoredNotice.getByRole("button", { name: "Discard text" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" &&
          parsed !== null &&
          "composer" in parsed &&
          typeof parsed.composer === "object" &&
          parsed.composer !== null &&
          "comment" in parsed.composer
          ? parsed.composer.comment
          : null;
      }, recoveryKey),
    )
    .toBeNull();
});

test("should share pending reply state across the rail and inline thread", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const sentBody = "Show this thread in both commenting surfaces.";
  await stageComment(page, sentBody);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submitted).ok()).toBe(true);

  const railThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: sentBody });
  await railThread
    .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
    .click();
  const commentId = await railThread.getAttribute("data-review-comment-id");
  if (commentId === null) throw new Error("The sent thread has no comment id");
  const inlineThread = page.locator(
    `[data-review-thread-for="${commentId}"] [data-review-comment-id="${commentId}"]`,
  );
  await inlineThread
    .getByRole("button", { name: `Expand comment: ${sentBody}` })
    .click();

  const replyBody = "Only post this shared reply once.";
  await railThread.getByPlaceholder("Reply to the agent…").fill(replyBody);
  await expect(
    inlineThread.getByPlaceholder("Reply to the agent…"),
  ).toHaveValue(replyBody);
  let releaseReply = (): void => undefined;
  const replyMayFinish = new Promise<void>((resolve) => {
    releaseReply = resolve;
  });
  let markReplyStarted = (): void => undefined;
  const replyStarted = new Promise<void>((resolve) => {
    markReplyStarted = resolve;
  });
  let replyRequests = 0;
  await page.route("**/api/agent-requests", async (route) => {
    replyRequests += 1;
    markReplyStarted();
    await replyMayFinish;
    await route.continue();
  });
  const replied = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/agent-requests") &&
      response.request().method() === "POST",
  );

  await railThread.getByRole("button", { name: "Reply" }).click();
  await replyStarted;
  await expect(
    inlineThread.getByRole("button", { name: "Sending…" }),
  ).toBeDisabled();
  const newerReplyBody = "Keep this newer reply text for another send.";
  await inlineThread
    .getByPlaceholder("Reply to the agent…")
    .fill(newerReplyBody);
  releaseReply();
  expect((await replied).ok()).toBe(true);
  expect(replyRequests).toBe(1);
  await expect(railThread.getByPlaceholder("Reply to the agent…")).toHaveValue(
    newerReplyBody,
  );
  await expect(
    inlineThread.getByPlaceholder("Reply to the agent…"),
  ).toHaveValue(newerReplyBody);
});

/** Reads the reviewer state the runtime holds, outside the browser under test. */
const readRuntimeDrafts = async (
  reviewRuntimeUrl: string,
  token: string,
): Promise<{
  readonly version: string;
  readonly drafts: ReadonlyArray<{
    readonly id: string;
    readonly body: string;
  }>;
  readonly sent: ReadonlyArray<{
    readonly id: string;
    readonly body: string;
  }>;
  readonly resolvedCommentIds: ReadonlyArray<string>;
}> => {
  const answer: unknown = await (
    await fetch(new URL("/api/drafts", reviewRuntimeUrl), {
      headers: { "x-big-plan-review-token": token },
    })
  ).json();
  if (
    typeof answer !== "object" ||
    answer === null ||
    !("version" in answer) ||
    typeof answer.version !== "string" ||
    !("drafts" in answer) ||
    !Array.isArray(answer.drafts) ||
    !("sent" in answer) ||
    !Array.isArray(answer.sent) ||
    !("resolvedCommentIds" in answer) ||
    !Array.isArray(answer.resolvedCommentIds) ||
    !answer.resolvedCommentIds.every(
      (commentId): commentId is string => typeof commentId === "string",
    )
  ) {
    throw new Error("The review runtime did not answer with its drafts");
  }
  return {
    version: answer.version,
    drafts: answer.drafts as ReadonlyArray<{
      readonly id: string;
      readonly body: string;
    }>,
    sent: answer.sent as ReadonlyArray<{
      readonly id: string;
      readonly body: string;
    }>,
    resolvedCommentIds: answer.resolvedCommentIds,
  };
};

const writeRuntimeDrafts = async ({
  reviewRuntimeUrl,
  token,
  version,
  drafts,
  resolvedCommentIds = [],
}: {
  readonly reviewRuntimeUrl: string;
  readonly token: string;
  readonly version: string;
  readonly drafts: ReadonlyArray<unknown>;
  readonly resolvedCommentIds?: ReadonlyArray<string>;
}): Promise<void> => {
  const written = await fetch(new URL("/api/drafts", reviewRuntimeUrl), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-big-plan-review-token": token,
    },
    body: JSON.stringify({ drafts, resolvedCommentIds, version }),
  });
  expect(written.ok).toBe(true);
};

/** The plan revision the page was rendered against, as the runtime named it. */
const currentSnapshot = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const bootstrap: unknown = JSON.parse(
      document.documentElement.getAttribute("data-review-bootstrap") ?? "{}",
    );
    return typeof bootstrap === "object" &&
      bootstrap !== null &&
      "currentSnapshot" in bootstrap &&
      typeof bootstrap.currentSnapshot === "string"
      ? bootstrap.currentSnapshot
      : "";
  });

const reviewToken = async (page: Page): Promise<string> => {
  const token = await page.locator("html").getAttribute("data-review-token");
  if (token === null) {
    throw new Error("The review runtime did not expose its request token");
  }
  return token;
};

const ownedLiveRecoveryKey = async (page: Page): Promise<string> => {
  const readKey = () =>
    page.locator("html").evaluate((root) => {
      const prefix = `big-plan:review:live-recovery:${root.dataset.planId ?? ""}:${root.dataset.reviewSession ?? ""}`;
      const ownerId = window.sessionStorage.getItem(`${prefix}:owner`);
      return ownerId === null ? "" : `${prefix}:tab:${ownerId}`;
    });
  await expect.poll(readKey).not.toBe("");
  return readKey();
};

test.describe("a drafts write prepared against content the store moved past", () => {
  // The refused write is the mechanism under test, and the browser reports a
  // refusal as a failed resource load.
  test.use({
    allowedConsoleErrors: [/Failed to load resource:.*(?:400|409|503)/u],
  });

  test("should keep each tab's recovery record isolated", async ({
    context,
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Keep this draft before either tab goes offline.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const secondPagePromise = context.waitForEvent("page");
    await page.evaluate(() => window.open(window.location.href, "_blank"));
    const secondPage = await secondPagePromise;
    await secondPage.waitForLoadState("domcontentloaded");
    const firstRecoveryKey = await ownedLiveRecoveryKey(page);
    const secondRecoveryKey = await ownedLiveRecoveryKey(secondPage);
    expect(secondRecoveryKey).not.toBe(firstRecoveryKey);
    const storedRecoveryBodies = (
      targetPage: Page,
      key: string,
    ): Promise<string[]> =>
      targetPage.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return [];
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" &&
          parsed !== null &&
          "drafts" in parsed &&
          Array.isArray(parsed.drafts)
          ? parsed.drafts.flatMap((draft) =>
              typeof draft === "object" &&
              draft !== null &&
              "body" in draft &&
              typeof draft.body === "string"
                ? [draft.body]
                : [],
            )
          : [];
      }, key);
    const blockRuntimeFetch = (): void => {
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        return url.pathname.startsWith("/api/")
          ? Promise.reject(new TypeError("Failed to fetch"))
          : runtimeFetch(input, init);
      };
    };
    await page.addInitScript(blockRuntimeFetch);
    await page.evaluate(blockRuntimeFetch);

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: `Expand staged comment: ${original}` })
      .click();
    await rail.getByRole("button", { name: "Edit staged comment" }).click();
    const offlineBody = "Keep this edit owned only by the offline tab.";
    await rail.getByLabel("Edit comment").fill(offlineBody);
    await rail.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() => storedRecoveryBodies(page, firstRecoveryKey))
      .toEqual([offlineBody]);

    const slide = secondPage.locator("[data-slide]").first();
    await slide.hover();
    await slide.getByRole("button", { name: "Comment on slide" }).click();
    const composerBody = "Typing here must not clear another tab's recovery.";
    await secondPage
      .getByRole("dialog", { name: /Comment on/u })
      .getByLabel("Add a comment")
      .fill(composerBody);
    await expect
      .poll(() =>
        secondPage.evaluate(
          (key) => window.localStorage.getItem(key),
          secondRecoveryKey,
        ),
      )
      .toContain(composerBody);
    await secondPage
      .getByRole("dialog", { name: /Comment on/u })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect
      .poll(() => storedRecoveryBodies(secondPage, firstRecoveryKey))
      .toEqual([offlineBody]);

    await page.reload();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(
      page
        .getByRole("complementary", { name: "Feedback" })
        .getByText(offlineBody),
    ).toBeVisible();
    await secondPage.close();
  });

  test("should restore each tab's own offline edits", async ({
    context,
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Keep this shared draft.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const secondPage = await context.newPage();
    await secondPage.goto(reviewRuntimeUrl);
    await expect(
      secondPage.getByRole("button", { name: "Feedback 1" }),
    ).toBeVisible();
    const blockRuntimeFetch = (): void => {
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        return url.pathname.startsWith("/api/")
          ? Promise.reject(new TypeError("Failed to fetch"))
          : runtimeFetch(input, init);
      };
    };
    for (const targetPage of [page, secondPage]) {
      await targetPage.addInitScript(blockRuntimeFetch);
      await targetPage.evaluate(blockRuntimeFetch);
    }
    const editDraft = async ({
      targetPage,
      before,
      after,
    }: {
      readonly targetPage: Page;
      readonly before: string;
      readonly after: string;
    }): Promise<void> => {
      const feedbackButton = targetPage.getByRole("button", {
        name: /^Feedback(?: \d+)?$/u,
      });
      if ((await feedbackButton.getAttribute("aria-expanded")) !== "true") {
        await feedbackButton.click();
      }
      const rail = targetPage.getByRole("complementary", {
        name: "Feedback",
      });
      await rail
        .getByRole("button", { name: `Expand staged comment: ${before}` })
        .click();
      await rail
        .locator(".review-staged-card")
        .filter({ hasText: before })
        .getByRole("button", { name: "Edit staged comment" })
        .click();
      await rail.getByLabel("Edit comment").fill(after);
      await rail.getByRole("button", { name: "Save" }).click();
    };
    const editedX = "Keep the first tab's offline edit.";
    const editedY = "Keep the second tab's offline edit.";
    await editDraft({ targetPage: page, before: original, after: editedX });
    await editDraft({
      targetPage: secondPage,
      before: original,
      after: editedY,
    });
    const secondRail = secondPage.getByRole("complementary", {
      name: "Feedback",
    });
    await expect(secondRail.getByText(editedY)).toBeVisible();

    for (const [targetPage, ownEdit] of [
      [page, editedX],
      [secondPage, editedY],
    ] as const) {
      await targetPage.reload();
      const feedbackButton = targetPage.getByRole("button", {
        name: /^Feedback(?: \d+)?$/u,
      });
      if ((await feedbackButton.getAttribute("aria-expanded")) !== "true") {
        await feedbackButton.click();
      }
      const rail = targetPage.getByRole("complementary", {
        name: "Feedback",
      });
      await expect(rail.getByText(ownEdit)).toBeVisible();
    }
    await secondPage.close();
  });

  test("should reconcile two tab-owned edits through the runtime once", async ({
    context,
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Choose one owner for this shared draft.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const secondPage = await context.newPage();
    await secondPage.goto(reviewRuntimeUrl);
    const blockRuntimeFetch = (): void => {
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        return url.pathname.startsWith("/api/")
          ? Promise.reject(new TypeError("Failed to fetch"))
          : runtimeFetch(input, init);
      };
    };
    await page.evaluate(blockRuntimeFetch);
    const editDraft = async (targetPage: Page, body: string): Promise<void> => {
      await targetPage
        .getByRole("button", { name: /^Feedback(?: \d+)?$/u })
        .click();
      const rail = targetPage.getByRole("complementary", {
        name: "Feedback",
      });
      await rail
        .getByRole("button", { name: `Expand staged comment: ${original}` })
        .click();
      await rail.getByRole("button", { name: "Edit staged comment" }).click();
      await rail.getByLabel("Edit comment").fill(body);
      await rail.getByRole("button", { name: "Save" }).click();
    };
    const firstBody = "Keep the edit recovered from the first tab.";
    const secondBody = "Keep the edit accepted from the second tab.";
    await editDraft(page, firstBody);
    await editDraft(secondPage, secondBody);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([secondBody]);

    await page.reload();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(firstBody);
    await expect(choice).toContainText(secondBody);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(firstBody);
    await expect(choice).toContainText(secondBody);
    await choice.getByRole("button", { name: "Keep mine" }).click();
    await expect(choice).toBeHidden();
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([firstBody]);
    await page.reload();
    await expect(choice).toBeHidden();
    await secondPage.close();
  });

  test("should keep a concurrent runtime comment when this browser writes", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    // Risk 4: the browser prepares a write, another writer changes the store
    // first, and the browser's write used to replace it wholesale.
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const before = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const concurrentBody =
      "Written straight into the runtime, not this browser.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: before.version,
      drafts: [
        {
          id: randomBytes(8).toString("hex"),
          body: concurrentBody,
          createdAt: new Date().toISOString(),
          premiseSnapshot: await currentSnapshot(page),
          target: { type: "document" },
        },
      ],
    });

    const browserBody = "Staged in this browser after the other write.";
    await stageComment(page, browserBody);

    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts
          .map((draft) => draft.body)
          .sort(),
      )
      .toEqual([browserBody, concurrentBody].sort());
  });

  test("should ask which version to keep when both sides changed one comment", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    // Risks 2 and 3: without a per-comment base this reappeared as a second
    // comment nobody wrote, instead of as a question with two real answers.
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Name the rollback owner.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const stored = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const draft = stored.drafts[0];
    if (draft === undefined)
      throw new Error("The staged comment was not stored");
    const runtimeBody = "Name the rollback owner and the rollback window.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: stored.version,
      drafts: [
        {
          ...draft,
          body: runtimeBody,
        },
      ],
    });

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: `Expand staged comment: ${original}` })
      .click();
    await rail.getByRole("button", { name: "Edit staged comment" }).click();
    const browserBody = "Name the rollback owner and who signs it off.";
    await rail.getByLabel("Edit comment").fill(browserBody);
    await rail.getByRole("button", { name: "Save" }).click();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(browserBody);
    await expect(choice).toContainText(runtimeBody);
    await page.keyboard.press("Escape");
    await expect(choice).toBeHidden();
    const pendingChoice = rail.getByRole("button", {
      name: "Review comment versions",
    });
    await expect(pendingChoice).toBeVisible();
    const latestBrowserBody =
      "Name the rollback owner, approver, and escalation path.";
    const conflictedCard = rail
      .locator(".review-staged-card")
      .filter({ hasText: browserBody });
    await conflictedCard
      .getByRole("button", { name: "Edit staged comment" })
      .click();
    await rail.getByLabel("Edit comment").fill(latestBrowserBody);
    await rail.getByRole("button", { name: "Save" }).click();
    // A background persist of the refreshed conflicted draft may not reopen
    // the dismissed prompt; only the explicit send below asks again.
    await expect(
      rail
        .locator(".review-staged-card")
        .filter({ hasText: latestBrowserBody }),
    ).toBeVisible();
    await expect(choice).toBeHidden();
    await expect(pendingChoice).toBeVisible();
    let feedbackWrites = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/feedback") &&
        request.method() === "POST"
      ) {
        feedbackWrites += 1;
      }
    });
    await rail
      .locator(".review-staged-card")
      .filter({ hasText: latestBrowserBody })
      .getByRole("button", { name: "Send this" })
      .click();
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(latestBrowserBody);
    await expect(choice).not.toContainText(browserBody);
    expect(feedbackWrites).toBe(0);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (item) => item.body,
        ),
      )
      .toEqual([runtimeBody]);
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Review comment versions" }).click();
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(latestBrowserBody);
    await expect(choice).not.toContainText(browserBody);
    await expect(choice).toContainText(runtimeBody);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (item) => item.body,
        ),
      )
      .toEqual([runtimeBody]);
    await page.reload();
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(latestBrowserBody);
    await expect(choice).not.toContainText(browserBody);
    await expect(choice).toContainText(runtimeBody);
    await choice
      .getByRole("button", { name: "Use the review session's version" })
      .click();

    await expect(choice).toBeHidden();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(rail).toContainText(runtimeBody);
    // Exactly one comment survives: the superseded body is not resurrected.
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (item) => item.body,
        ),
      )
      .toEqual([runtimeBody]);
    const offlineKey = "big-plan:test:runtime-choice-offline";
    await page.addInitScript((key) => {
      let offline: boolean;
      try {
        offline = window.sessionStorage.getItem(key) === "true";
      } catch {
        return;
      }
      if (!offline) return;
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        return url.pathname.startsWith("/api/")
          ? Promise.reject(new TypeError("Failed to fetch"))
          : runtimeFetch(input, init);
      };
    }, offlineKey);
    await page.evaluate(
      (key) => window.sessionStorage.setItem(key, "true"),
      offlineKey,
    );
    await page.reload();
    await expect(choice).toBeHidden();
  });

  test("should pause unrelated feedback while any conflict is unresolved", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Keep the conflicted runtime body authoritative.";
    const unrelated = "Do not submit this unrelated comment yet.";
    await stageComment(page, original);
    await stageComment(page, unrelated);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original, unrelated]);
    const stored = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const conflictedDraft = stored.drafts[0];
    const unrelatedDraft = stored.drafts[1];
    if (conflictedDraft === undefined || unrelatedDraft === undefined) {
      throw new Error("Expected two stored drafts");
    }
    const recoveryKey = await ownedLiveRecoveryKey(page);
    const ownerId = recoveryKey.split(":tab:")[1];
    if (ownerId === undefined) throw new Error("Expected a recovery owner");
    const localBody = "Keep this unsynchronized local version.";
    await page.evaluate(
      ({ key, local, other }) => {
        const { baseBody, ...localDraft } = local;
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 11,
            drafts: [localDraft, other],
            resolvedCommentIds: [],
            reconciliation: {
              base: {
                draftBodies: {
                  [local.id]: baseBody,
                  [other.id]: other.body,
                },
                resolvedCommentIds: [],
              },
              conflicts: [],
              runtime: null,
            },
            composer: { comment: null, replies: {} },
          }),
        );
      },
      {
        key: recoveryKey,
        local: {
          ...conflictedDraft,
          body: localBody,
          baseBody: original,
        },
        other: unrelatedDraft,
      },
    );
    const runtimeBody = "Keep this newer runtime version.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: stored.version,
      drafts: [{ ...conflictedDraft, body: runtimeBody }, unrelatedDraft],
    });

    await page.reload();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toContainText(localBody);
    await expect(choice).toContainText(runtimeBody);
    await page.keyboard.press("Escape");
    await expect(choice).toBeHidden();
    const feedbackButton = page.getByRole("button", {
      name: /^Feedback(?: \d+)?$/u,
    });
    if ((await feedbackButton.getAttribute("aria-expanded")) !== "true") {
      await feedbackButton.click();
    }
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", {
        name: `Expand staged comment: ${unrelated}`,
      })
      .click();
    let feedbackWrites = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/feedback") &&
        request.method() === "POST"
      ) {
        feedbackWrites += 1;
      }
    });
    await rail
      .locator(".review-staged-card")
      .filter({ hasText: unrelated })
      .getByRole("button", { name: "Send this" })
      .click();
    await expect(choice).toBeVisible();
    expect(feedbackWrites).toBe(0);
    await expect
      .poll(async () => {
        const snapshot = await readRuntimeDrafts(reviewRuntimeUrl, token);
        return {
          drafts: snapshot.drafts.map((draft) => draft.body),
          sent: snapshot.sent.map((comment) => comment.body),
        };
      })
      .toEqual({ drafts: [runtimeBody, unrelated], sent: [] });
  });

  test("should submit an unsynchronized local edit without a conflict", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Name the owner before submission.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const failedWritesKey = "big-plan:test:failed-unsynchronized-write";
    await page.evaluate((key) => {
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (
          url.pathname === "/api/drafts" &&
          method === "PUT" &&
          window.sessionStorage.getItem(key) === null
        ) {
          window.sessionStorage.setItem(key, "1");
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return runtimeFetch(input, init);
      };
    }, failedWritesKey);

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: `Expand staged comment: ${original}` })
      .click();
    await rail.getByRole("button", { name: "Edit staged comment" }).click();
    const localBody = "Name the owner and escalation contact.";
    await rail.getByLabel("Edit comment").fill(localBody);
    await rail.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => Number(window.sessionStorage.getItem(key) ?? "0"),
          failedWritesKey,
        ),
      )
      .toBe(1);

    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .locator(".review-staged-card")
      .filter({ hasText: localBody })
      .getByRole("button", { name: "Send this" })
      .click();
    expect((await submitted).ok()).toBe(true);

    await expect(
      page.getByRole("alertdialog", {
        name: "Two versions of this comment",
      }),
    ).toBeHidden();
    await expect
      .poll(async () => {
        const snapshot = await readRuntimeDrafts(reviewRuntimeUrl, token);
        return {
          drafts: snapshot.drafts.map((draft) => draft.body),
          sent: snapshot.sent.map((comment) => comment.body),
        };
      })
      .toEqual({ drafts: [], sent: [localBody] });
  });

  test("should remember conflict answers across failed and offline recovery", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const originalX = "Agreed owner for the rollback.";
    const originalY = "Agreed window for the rollback.";
    await stageComment(page, originalX);
    await stageComment(page, originalY);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([originalX, originalY]);

    const stored = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const draftX = stored.drafts[0];
    const draftY = stored.drafts[1];
    if (draftX === undefined || draftY === undefined) {
      throw new Error("Expected two stored drafts");
    }
    const runtimeX = "Runtime owner for the rollback.";
    const runtimeY = "Runtime window for the rollback.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: stored.version,
      drafts: [
        { ...draftX, body: runtimeX },
        { ...draftY, body: runtimeY },
      ],
    });

    let releaseResponse = (): void => undefined;
    const responseMayFinish = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let markStaleResponse = (): void => undefined;
    const staleResponseReachedBrowser = new Promise<void>((resolve) => {
      markStaleResponse = resolve;
    });
    await page.route(
      "**/api/drafts",
      async (route) => {
        const response = await route.fetch();
        markStaleResponse();
        await responseMayFinish;
        await route.fulfill({ response });
      },
      { times: 1 },
    );

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const editDraft = async (before: string, after: string): Promise<void> => {
      const expand = rail.getByRole("button", {
        name: `Expand staged comment: ${before}`,
      });
      if (await expand.isVisible()) await expand.click();
      await rail
        .locator(".review-staged-card")
        .filter({ hasText: before })
        .getByRole("button", { name: "Edit staged comment" })
        .click();
      await rail.getByLabel("Edit comment").fill(after);
      await rail.getByRole("button", { name: "Save" }).click();
    };
    const localX = "Local owner for the rollback.";
    const localY = "Local window for the rollback.";
    await editDraft(originalX, localX);
    await staleResponseReachedBrowser;
    await editDraft(originalY, localY);
    releaseResponse();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toContainText(localX);
    await expect(choice).toContainText(runtimeX);
    await choice.getByRole("button", { name: "Keep mine" }).click();
    await expect(choice).toContainText(localY);
    await expect(choice).toContainText(runtimeY);

    await page.reload();
    await expect(choice).toBeVisible();
    await expect(choice).toContainText(localY);
    await expect(choice).toContainText(runtimeY);
    await expect(choice).not.toContainText(localX);
    await expect(choice).not.toContainText(runtimeX);

    const failedWritesKey = "big-plan:test:failed-recovery-writes";
    await page.evaluate((key) => {
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (url.pathname === "/api/drafts" && method === "PUT") {
          const failed = Number(window.sessionStorage.getItem(key) ?? "0");
          window.sessionStorage.setItem(key, String(failed + 1));
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return runtimeFetch(input, init);
      };
    }, failedWritesKey);
    await choice.getByRole("button", { name: "Keep mine" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => Number(window.sessionStorage.getItem(key) ?? "0"),
          failedWritesKey,
        ),
      )
      .toBe(1);

    const offlineKey = "big-plan:test:recovery-offline";
    await page.addInitScript((key) => {
      let offline: boolean;
      try {
        offline = window.sessionStorage.getItem(key) === "true";
      } catch {
        return;
      }
      if (!offline) return;
      const runtimeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          window.location.href,
        );
        return url.pathname.startsWith("/api/")
          ? Promise.reject(new TypeError("Failed to fetch"))
          : runtimeFetch(input, init);
      };
    }, offlineKey);
    await page.evaluate(
      (key) => window.sessionStorage.setItem(key, "true"),
      offlineKey,
    );
    await page.reload();
    await expect(choice).toBeHidden();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(rail).toContainText(localX);
    await expect(rail).toContainText(localY);
    await page.evaluate(
      (key) => window.sessionStorage.setItem(key, "false"),
      offlineKey,
    );

    await page.reload();
    await expect(choice).toBeHidden();
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([localX, localY]);
  });

  test("should merge a stale result against the latest browser edit", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const original = "Original queued edit.";
    await stageComment(page, original);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([original]);

    const stored = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const draft = stored.drafts[0];
    if (draft === undefined)
      throw new Error("The staged comment was not stored");
    const runtimeBody = "Edited by the concurrent runtime.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: stored.version,
      drafts: [{ ...draft, body: runtimeBody }],
    });

    let releaseResponse = (): void => undefined;
    const responseMayFinish = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let markStaleResponse = (): void => undefined;
    const staleResponseReachedBrowser = new Promise<void>((resolve) => {
      markStaleResponse = resolve;
    });
    await page.route(
      "**/api/drafts",
      async (route) => {
        const response = await route.fetch();
        markStaleResponse();
        await responseMayFinish;
        await route.fulfill({ response });
      },
      { times: 1 },
    );

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const openEditor = async (body: string): Promise<void> => {
      const expand = rail.getByRole("button", {
        name: `Expand staged comment: ${body}`,
      });
      if (await expand.isVisible()) await expand.click();
      const card = rail
        .locator(".review-staged-card")
        .filter({ hasText: body });
      await card.getByRole("button", { name: "Edit staged comment" }).click();
    };
    const firstLocalBody = "First browser edit waiting on the stale response.";
    await openEditor(original);
    await rail.getByLabel("Edit comment").fill(firstLocalBody);
    await rail.getByRole("button", { name: "Save" }).click();
    await staleResponseReachedBrowser;

    const latestLocalBody = "Latest browser edit must win the queue race.";
    await openEditor(firstLocalBody);
    await rail.getByLabel("Edit comment").fill(latestLocalBody);
    await rail.getByRole("button", { name: "Save" }).click();
    releaseResponse();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toContainText(latestLocalBody);
    await expect(choice).not.toContainText(firstLocalBody);
    await choice.getByRole("button", { name: "Keep mine" }).click();
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (item) => item.body,
        ),
      )
      .toEqual([latestLocalBody]);
  });

  test("should not submit a captured body after queued reconciliation", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const capturedBody = "Do not send this body after reconciliation.";
    const unrelatedBody = "Edit this draft to start the queued write.";
    await stageComment(page, capturedBody);
    await stageComment(page, unrelatedBody);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts
          .map((draft) => draft.body)
          .sort(),
      )
      .toEqual([capturedBody, unrelatedBody].sort());

    const stored = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const capturedDraft = stored.drafts.find(
      (draft) => draft.body === capturedBody,
    );
    const unrelatedDraft = stored.drafts.find(
      (draft) => draft.body === unrelatedBody,
    );
    if (capturedDraft === undefined || unrelatedDraft === undefined) {
      throw new Error("Expected both staged comments in the runtime");
    }
    const reconciledBody = "Keep this newer runtime body as a draft.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: stored.version,
      drafts: [{ ...capturedDraft, body: reconciledBody }, unrelatedDraft],
    });

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    for (const body of [capturedBody, unrelatedBody]) {
      const expand = rail.getByRole("button", {
        name: `Expand staged comment: ${body}`,
      });
      if (await expand.isVisible()) await expand.click();
    }

    let releaseResponse = (): void => undefined;
    const responseMayFinish = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let markStaleResponse = (): void => undefined;
    const staleResponseReachedBrowser = new Promise<void>((resolve) => {
      markStaleResponse = resolve;
    });
    await page.route(
      "**/api/drafts",
      async (route) => {
        const response = await route.fetch();
        markStaleResponse();
        await responseMayFinish;
        await route.fulfill({ response });
      },
      { times: 1 },
    );

    const unrelatedCard = rail
      .locator(".review-staged-card")
      .filter({ hasText: unrelatedBody });
    await unrelatedCard
      .getByRole("button", { name: "Edit staged comment" })
      .click();
    const latestUnrelatedBody = "Persist this unrelated browser edit.";
    await rail.getByLabel("Edit comment").fill(latestUnrelatedBody);
    await rail.getByRole("button", { name: "Save" }).click();
    await staleResponseReachedBrowser;

    const capturedCard = rail
      .locator(".review-staged-card")
      .filter({ hasText: capturedBody });
    await capturedCard.getByRole("button", { name: "Send this" }).click();
    releaseResponse();

    await expect(rail).toContainText(
      "The review changed before submission. Review the latest comments and send again.",
    );
    await expect
      .poll(async () => {
        const snapshot = await readRuntimeDrafts(reviewRuntimeUrl, token);
        return {
          drafts: snapshot.drafts.map((draft) => draft.body).sort(),
          sent: snapshot.sent.map((comment) => comment.body),
        };
      })
      .toEqual({
        drafts: [latestUnrelatedBody, reconciledBody].sort(),
        sent: [],
      });
  });

  test("should adopt other submitted comments after sending one draft", async ({
    context,
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const initial = await readRuntimeDrafts(reviewRuntimeUrl, token);
    const snapshot = await currentSnapshot(page);
    const firstBody = "Submit this from the first tab.";
    const secondBody = "Submit this from the second tab.";
    const firstComment = {
      id: randomBytes(8).toString("hex"),
      body: firstBody,
      createdAt: new Date().toISOString(),
      premiseSnapshot: snapshot,
      target: { type: "document" },
    };
    const secondComment = {
      ...firstComment,
      id: randomBytes(8).toString("hex"),
      body: secondBody,
    };
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: initial.version,
      drafts: [firstComment, secondComment],
    });
    await page.reload();
    const secondPage = await context.newPage();
    await secondPage.goto(reviewRuntimeUrl);

    const sendOne = async (targetPage: Page, body: string): Promise<number> => {
      await targetPage
        .getByRole("button", { name: /^Feedback(?: \d+)?$/u })
        .click();
      const rail = targetPage.getByRole("complementary", { name: "Feedback" });
      const expand = rail.getByRole("button", {
        name: `Expand staged comment: ${body}`,
      });
      if (await expand.isVisible()) await expand.click();
      const card = rail
        .locator(".review-staged-card")
        .filter({ hasText: body });
      const submitted = targetPage.waitForResponse(
        (response) =>
          response.url().endsWith("/api/feedback") &&
          response.request().method() === "POST",
      );
      await card.getByRole("button", { name: "Send this" }).click();
      return (await submitted).status();
    };

    expect(await sendOne(secondPage, secondBody)).toBe(200);
    expect(await sendOne(page, firstBody)).toBe(409);

    const firstRail = page.getByRole("complementary", { name: "Feedback" });
    await expect(
      firstRail.locator(".review-staged-card").filter({ hasText: secondBody }),
    ).toHaveCount(0);
    await expect(
      firstRail.locator("[data-review-sent-thread]").filter({
        hasText: secondBody,
      }),
    ).toHaveCount(1);
    await expect(
      firstRail.locator(".review-staged-card").filter({ hasText: firstBody }),
    ).toHaveCount(1);
    const retry = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    const sendAll = firstRail.getByRole("button", {
      name: "Send all comments to agent",
    });
    await expect(sendAll).toBeEnabled();
    await sendAll.click();
    expect((await retry).status()).toBe(200);
    await secondPage.close();
  });

  test("should preserve an edit made while feedback is being submitted", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const submittedBody = "Submit this body while its response is delayed.";
    await stageComment(page, submittedBody);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([submittedBody]);

    let releaseResponse = (): void => undefined;
    const responseMayFinish = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let markAccepted = (): void => undefined;
    const acceptedByRuntime = new Promise<void>((resolve) => {
      markAccepted = resolve;
    });
    await page.route(
      "**/api/feedback",
      async (route) => {
        const response = await route.fetch();
        markAccepted();
        await responseMayFinish;
        await route.fulfill({ response });
      },
      { times: 1 },
    );

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", {
        name: `Expand staged comment: ${submittedBody}`,
      })
      .click();
    const card = rail
      .locator(".review-staged-card")
      .filter({ hasText: submittedBody });
    await card.getByRole("button", { name: "Send this" }).click();
    await acceptedByRuntime;

    await card.getByRole("button", { name: "Edit staged comment" }).click();
    const newerBody = "Preserve this newer edit as unsent feedback.";
    await rail.getByLabel("Edit comment").fill(newerBody);
    await rail.getByRole("button", { name: "Save" }).click();
    releaseResponse();

    const choice = page.getByRole("alertdialog", {
      name: "Two versions of this comment",
    });
    await expect(choice).toContainText(newerBody);
    await expect(choice).toContainText(submittedBody);
    await choice
      .getByRole("button", { name: "Stage mine as new feedback" })
      .click();

    await expect
      .poll(async () => {
        const snapshot = await readRuntimeDrafts(reviewRuntimeUrl, token);
        return {
          drafts: snapshot.drafts.map((draft) => draft.body),
          sent: snapshot.sent.map((comment) => comment.body),
        };
      })
      .toEqual({ drafts: [newerBody], sent: [submittedBody] });
    await expect(choice).toBeHidden();
  });

  test("should reconcile drafts and replies across conditional deletion", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const sentBody = "Delete this queued thread after reconciliation.";
    await stageComment(page, sentBody);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).status()).toBe(200);

    const originalDraft = "The draft another tab will update.";
    await stageComment(page, originalDraft);
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([originalDraft]);
    const beforeConcurrentWrite = await readRuntimeDrafts(
      reviewRuntimeUrl,
      token,
    );
    const sentComment = beforeConcurrentWrite.sent.find(
      (comment) => comment.body === sentBody,
    );
    if (sentComment === undefined) throw new Error("Expected a sent comment");
    const storedDraft = beforeConcurrentWrite.drafts[0];
    if (storedDraft === undefined) throw new Error("Expected a stored draft");

    const thread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: sentBody });
    await thread
      .getByRole("button", { name: `Expand queued comment: ${sentBody}` })
      .click();
    const replyBody = "Do not leave this reply behind after deletion.";
    await thread.getByPlaceholder("Reply to the agent…").fill(replyBody);

    const newerDraft = "The newer draft from the other tab.";
    await writeRuntimeDrafts({
      reviewRuntimeUrl,
      token,
      version: beforeConcurrentWrite.version,
      drafts: [{ ...storedDraft, body: newerDraft }],
    });
    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([newerDraft]);

    const deleteOnce = async (): Promise<number> => {
      await thread
        .getByRole("button", { name: "Delete queued comment" })
        .click();
      const response = page.waitForResponse(
        (candidate) =>
          candidate.url().endsWith("/api/comments-delete") &&
          candidate.request().method() === "POST",
      );
      await page
        .getByRole("alertdialog", { name: "Delete queued comment?" })
        .getByRole("button", { name: "Delete" })
        .click();
      return (await response).status();
    };

    expect(await deleteOnce()).toBe(409);
    await expect(rail).toContainText(newerDraft);
    await expect(thread.getByPlaceholder("Reply to the agent…")).toHaveValue(
      replyBody,
    );
    expect(await deleteOnce()).toBe(200);
    await expect(thread).toHaveCount(0);
    const recoveryKey = await ownedLiveRecoveryKey(page);
    await expect
      .poll(() =>
        page.evaluate(
          ({ expected, key }) => {
            const raw = window.localStorage.getItem(key);
            if (raw === null) return { expected, keys: [] };
            const recovery: unknown = JSON.parse(raw);
            if (
              typeof recovery !== "object" ||
              recovery === null ||
              !("composer" in recovery) ||
              typeof recovery.composer !== "object" ||
              recovery.composer === null ||
              !("replies" in recovery.composer) ||
              typeof recovery.composer.replies !== "object" ||
              recovery.composer.replies === null
            ) {
              return { expected, keys: [] };
            }
            return {
              expected,
              keys: Object.keys(recovery.composer.replies),
            };
          },
          { expected: sentComment.id, key: recoveryKey },
        ),
      )
      .toEqual({ expected: sentComment.id, keys: [] });
  });

  test("should read a runtime version before writing recovered state", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const token = await reviewToken(page);
    const identity = await page.locator("html").evaluate((root) => {
      const bootstrap: unknown = JSON.parse(
        root.getAttribute("data-review-bootstrap") ?? "{}",
      );
      return {
        planId: root.getAttribute("data-plan-id") ?? "",
        sessionId: root.getAttribute("data-review-session") ?? "",
        currentSnapshot:
          typeof bootstrap === "object" &&
          bootstrap !== null &&
          "currentSnapshot" in bootstrap &&
          typeof bootstrap.currentSnapshot === "string"
            ? bootstrap.currentSnapshot
            : "",
      };
    });
    const recoveredBody = "Recovered before the runtime version was known.";
    const recoveryKey = await ownedLiveRecoveryKey(page);
    await page.evaluate(
      ({ identity: storedIdentity, key, body, id }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 11,
            drafts: [
              {
                id,
                body,
                createdAt: "2026-08-10T12:00:00.000Z",
                premiseSnapshot: storedIdentity.currentSnapshot,
                target: { type: "document" },
              },
            ],
            resolvedCommentIds: [],
            reconciliation: {
              base: { draftBodies: {}, resolvedCommentIds: [] },
              conflicts: [],
              runtime: null,
            },
            composer: { comment: null, replies: {} },
          }),
        );
      },
      {
        identity,
        key: recoveryKey,
        body: recoveredBody,
        id: randomBytes(8).toString("hex"),
      },
    );
    let requestCount = 0;
    let releasePreflight = (): void => undefined;
    const preflightMayFinish = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    let markPreflight = (): void => undefined;
    const preflightStarted = new Promise<void>((resolve) => {
      markPreflight = resolve;
    });
    await page.route(
      "**/api/drafts",
      async (route) => {
        requestCount += 1;
        if (requestCount === 1) {
          await route.fulfill({ status: 503, body: "Unavailable once" });
          return;
        }
        const response = await route.fetch();
        markPreflight();
        await preflightMayFinish;
        await route.fulfill({ response });
      },
      { times: 2 },
    );

    await page.reload();
    await preflightStarted;
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", {
        name: `Expand staged comment: ${recoveredBody}`,
      })
      .click();
    const card = rail
      .locator(".review-staged-card")
      .filter({ hasText: recoveredBody });
    await card.getByRole("button", { name: "Edit staged comment" }).click();
    const newerBody = "The newest edit made during version recovery.";
    await rail.getByLabel("Edit comment").fill(newerBody);
    await rail.getByRole("button", { name: "Save" }).click();
    releasePreflight();

    await expect
      .poll(async () =>
        (await readRuntimeDrafts(reviewRuntimeUrl, token)).drafts.map(
          (draft) => draft.body,
        ),
      )
      .toEqual([newerBody]);
  });

  test("should read a runtime version before submitting recovered feedback", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    const identity = await page.locator("html").evaluate((root) => {
      const bootstrap: unknown = JSON.parse(
        root.getAttribute("data-review-bootstrap") ?? "{}",
      );
      return {
        planId: root.getAttribute("data-plan-id") ?? "",
        sessionId: root.getAttribute("data-review-session") ?? "",
        currentSnapshot:
          typeof bootstrap === "object" &&
          bootstrap !== null &&
          "currentSnapshot" in bootstrap &&
          typeof bootstrap.currentSnapshot === "string"
            ? bootstrap.currentSnapshot
            : "",
      };
    });
    const recoveredBody = "Submit this after the runtime recovers.";
    const recoveryKey = await ownedLiveRecoveryKey(page);
    await page.evaluate(
      ({ identity: storedIdentity, key, body, id }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            version: 11,
            drafts: [
              {
                id,
                body,
                createdAt: "2026-08-10T12:00:00.000Z",
                premiseSnapshot: storedIdentity.currentSnapshot,
                target: { type: "document" },
              },
            ],
            resolvedCommentIds: [],
            reconciliation: {
              base: { draftBodies: {}, resolvedCommentIds: [] },
              conflicts: [],
              runtime: null,
            },
            composer: { comment: null, replies: {} },
          }),
        );
      },
      {
        identity,
        key: recoveryKey,
        body: recoveredBody,
        id: randomBytes(8).toString("hex"),
      },
    );
    let draftsReads = 0;
    await page.route(
      "**/api/drafts",
      async (route) => {
        draftsReads += 1;
        await route.fulfill({ status: 503, body: "Unavailable during load" });
      },
      { times: 2 },
    );

    await page.reload();
    await expect.poll(() => draftsReads).toBe(2);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    const response = await submitted;

    expect(response.status()).toBe(200);
    const request: unknown = response.request().postDataJSON();
    expect(request).toMatchObject({ version: expect.any(String) });
    if (
      typeof request !== "object" ||
      request === null ||
      !("version" in request) ||
      typeof request.version !== "string"
    ) {
      throw new Error("Feedback did not carry a review-state version");
    }
    expect(request.version).not.toBe("");
  });
});

test("should keep feedback tabs clickable above the mobile contents bar", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(reviewRuntimeUrl);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await page.getByRole("tab", { name: "Chat" }).click();

  await expect(page.getByRole("tabpanel", { name: "Chat" })).toBeVisible();
});

test("should merge an outage-time draft with newer runtime state", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const identity = await page.locator("html").evaluate((root) => {
    const bootstrap: unknown = JSON.parse(
      root.getAttribute("data-review-bootstrap") ?? "{}",
    );
    return {
      planId: root.getAttribute("data-plan-id") ?? "",
      sessionId: root.getAttribute("data-review-session") ?? "",
      currentSnapshot:
        typeof bootstrap === "object" &&
        bootstrap !== null &&
        "currentSnapshot" in bootstrap &&
        typeof bootstrap.currentSnapshot === "string"
          ? bootstrap.currentSnapshot
          : "",
    };
  });
  const recoveryKey = await ownedLiveRecoveryKey(page);
  const runtimePaths = new Set([
    "/api/agent",
    "/api/drafts",
    "/api/progress",
    "/api/session",
  ]);
  await page.evaluate((paths) => {
    const fetchFromRuntime = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        window.location.href,
      );
      return paths.includes(url.pathname)
        ? Promise.reject(new TypeError("Failed to fetch"))
        : fetchFromRuntime(input, init);
    };
  }, Array.from(runtimePaths));

  const banner = page.getByRole("alert").filter({
    hasText: "This tab lost contact with this review session",
  });
  await expect(banner).toBeVisible({ timeout: 6_000 });
  await expect(banner).toContainText(
    "This tab lost contact with the local review server. Refresh to try reconnecting.",
  );
  const refresh = banner.getByRole("button", { name: "Refresh" });
  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/u });
  const commentBody = composer.getByLabel("Add a comment");
  await commentBody.fill("Preserve this comment through the outage.");
  await expect(refresh).toBeDisabled();
  await expect(banner).toContainText(
    "the latest review input has not reached the local review server",
  );
  const submitRightAway = composer.getByRole("switch", {
    name: "Submit right away",
  });
  if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
    await submitRightAway.click();
  }
  await composer.getByRole("button", { name: "Add Comment" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => window.localStorage.getItem(key), recoveryKey),
    )
    .not.toBeNull();
  await expect(refresh).toBeDisabled();

  const newerRuntimeBody = "Preserve this newer runtime feedback.";
  const reviewToken = await page
    .locator("html")
    .getAttribute("data-review-token");
  if (reviewToken === null) {
    throw new Error("The review runtime did not expose its request token");
  }
  // A drafts write is conditional on the version it was prepared against, so
  // another writer reads the current one first.
  const runtimeVersion: unknown = await (
    await fetch(new URL("/api/drafts", reviewRuntimeUrl), {
      headers: { "x-big-plan-review-token": reviewToken },
    })
  ).json();
  const runtimeUpdate = await fetch(new URL("/api/drafts", reviewRuntimeUrl), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-big-plan-review-token": reviewToken,
    },
    body: JSON.stringify({
      version:
        typeof runtimeVersion === "object" &&
        runtimeVersion !== null &&
        "version" in runtimeVersion
          ? runtimeVersion.version
          : "",
      drafts: [
        {
          id: randomBytes(8).toString("hex"),
          body: newerRuntimeBody,
          createdAt: new Date().toISOString(),
          premiseSnapshot: identity.currentSnapshot,
          target: { type: "document" },
        },
      ],
      resolvedCommentIds: [],
    }),
  });
  expect(runtimeUpdate.ok).toBe(true);

  const replayed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/drafts") &&
      response.request().method() === "PUT" &&
      response.ok(),
  );
  await page.reload();
  // The browser's sync body is anchored drafts and resolved ids. A plan-wide
  // composer field is not part of it, and a browser that reintroduced one
  // would blank it on this very write.
  expect((await replayed).request().postData() ?? "").not.toContain(
    "activeDraft",
  );
  await expect(banner).toBeHidden();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(
    page.getByRole("complementary", { name: "Feedback" }),
  ).toContainText("Preserve this comment through the outage.");
  await expect(
    page.getByRole("complementary", { name: "Feedback" }),
  ).toContainText(newerRuntimeBody);
  const persistedResponse = await fetch(
    new URL("/api/drafts", reviewRuntimeUrl),
    {
      headers: {
        "x-big-plan-review-token": reviewToken,
      },
    },
  );
  expect(persistedResponse.ok).toBe(true);
  await expect(persistedResponse.json()).resolves.toMatchObject({
    drafts: expect.arrayContaining([
      expect.objectContaining({
        body: "Preserve this comment through the outage.",
      }),
      expect.objectContaining({ body: newerRuntimeBody }),
    ]),
  });
  await expect
    .poll(() =>
      page.evaluate((key) => window.localStorage.getItem(key), recoveryKey),
    )
    .toBeNull();
});

test("should preserve deadline recovery when a sibling poll fails", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("restartCommand" in session) ||
    typeof session.restartCommand !== "string" ||
    session.restartCommand.trim() === ""
  ) {
    throw new Error("The review runtime did not publish its restart command");
  }
  const latestReviewUrl = new URL("latest-review", reviewRuntimeUrl).href;
  await page.route("**/api/session", async (route) => {
    const response = await route.fetch();
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null) {
      throw new Error("The session route did not return an object");
    }
    await route.fulfill({
      response,
      json: {
        ...value,
        // Deadline recovery only exists when a timeout is configured. The
        // default is no expiry, so this journey supplies the opt-in bound
        // the page needs before it will name a passed deadline.
        idleTimeoutMs: 30 * 60 * 1_000,
        expiresAtMs:
          route.request().headers()["x-big-plan-test-poll-phase"] ===
          "fresh-session"
            ? Date.now() + 60_000
            : 0,
        latestReviewUrl,
      },
    });
  });

  await page.getByRole("button", { name: "Comment on slide" }).first().click();
  await page
    .getByRole("dialog", { name: /Comment on/u })
    .getByLabel("Add a comment")
    .fill("Keep this browser-only input safe.");
  await page.evaluate(() => {
    const fetchFromRuntime = window.fetch.bind(window);
    let shouldHangAgentPoll = false;
    let releaseAgentPoll = (): void => undefined;
    document.addEventListener("bigplan-test:hang-agent-poll", () => {
      shouldHangAgentPoll = true;
    });
    document.addEventListener("bigplan-test:release-agent-poll", () => {
      shouldHangAgentPoll = false;
      releaseAgentPoll();
    });
    window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        window.location.href,
      );
      if (!shouldHangAgentPoll) {
        return url.pathname === "/api/agent"
          ? Promise.reject(new TypeError("Failed to fetch"))
          : fetchFromRuntime(input, init);
      }
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set("x-big-plan-test-poll-phase", "fresh-session");
      const phasedInit = { ...init, headers };
      if (url.pathname !== "/api/agent") {
        return fetchFromRuntime(input, phasedInit);
      }
      return new Promise<Response>((resolve, reject) => {
        releaseAgentPoll = () => {
          void fetchFromRuntime(input, phasedInit).then(resolve, reject);
        };
      });
    };
  });

  const banner = page.getByRole("alert").filter({
    hasText: "This tab lost contact with this review session",
  });
  await expect(banner).toBeVisible({ timeout: 6_000 });
  await expect(banner).toContainText(
    "The deadline this tab last knew has since passed. A newer review session for this plan was recorded at the linked address.",
  );
  await expect(banner).toContainText(
    "Keep this tab open because the latest review input has not reached the local review server.",
  );
  await expect(
    banner.getByRole("link", { name: "Open latest review" }),
  ).toHaveAttribute("href", latestReviewUrl);
  await expect(banner.getByRole("button", { name: "Refresh" })).toBeDisabled();
  await expect(banner).not.toContainText(session.restartCommand);
  await expect(banner).not.toContainText(/\b(?:run|start|restart)\b/u);
  await expect(banner).not.toContainText(
    /ended|expired|closed|timed out|may|might|possibly|likely/u,
  );

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("bigplan-test:hang-agent-poll"));
  });
  await expect(banner).toContainText(
    "This tab lost contact with the local review server. Refresh to try reconnecting.",
    { timeout: 4_000 },
  );
  await expect(banner).not.toContainText(
    "The deadline this tab last knew has since passed.",
  );
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("bigplan-test:release-agent-poll"));
  });
});

test("should expire a held connected snapshot when the reviewer returns", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.goto(reviewRuntimeUrl);
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not describe its live session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
    now,
  });
  await page.clock.runFor(1_600);
  await expect(agentStatusTrigger(page)).toBeVisible();

  await page.clock.setSystemTime(now + 6 * 60 * 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const connectionLost = agentStatusTrigger(page);
  await expect(connectionLost).toBeVisible();
  await connectionLost.click();
  // The card no longer measures the silence; it names the state and leaves
  // "since" to say when the agent was last here.
  await expect(agentSidebar(page)).toContainText("The agent has disconnected.");
  // The label names the transition its time belongs to, so the row reads as a
  // statement about this state rather than as a field to interpret.
  await expect(agentSidebar(page)).toContainText("Disconnected since");
  // Elapsed time is a parenthetical of the timestamp, not a second value.
  await expect(
    agentSidebar(page)
      .locator("dd")
      .filter({ hasText: /\(.+\)/u })
      .first(),
  ).toBeVisible();
  // Losing the agent is the moment the recovery instruction is wanted, so the
  // section opens itself rather than waiting to be found. It stays a
  // collapsible: closing it holds while the agent is still gone.
  const recovery = agentSidebar(page).locator(
    "details[data-review-agent-recovery]",
  );
  await expect(recovery).toHaveAttribute("open", "");
  await recovery.locator("summary").click();
  await expect(recovery).not.toHaveAttribute("open", "");
});

test("should show the active claim's model despite a competing heartbeat", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const source = await readFile(session.plan, "utf8");
  const request = messageAgentRequest({
    kind: "chat",
    requestId: "abcdabcdabcdabcd",
    sessionId: session.sessionId,
    planId: session.planId,
    premiseSnapshot: deriveSnapshotDigest(source),
    createdAt: new Date().toISOString(),
    body: "Which model is answering this request?",
  });
  await writeAgentRequest({ store, request });
  await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: "abababababababab",
    model: {
      name: "grok-4.6",
      client: "grok-cli 0.2.99",
      sessionUrl: "https://grok.com/chat/42",
    },
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await writeFile(
    store.agentHeartbeatPath,
    JSON.stringify({
      sessionId: session.sessionId,
      state: "waiting",
      model: {
        name: "Wrong waiting agent",
        effort: "max",
        client: "wrong-cli 1.0",
      },
      updatedAtMs: Date.now(),
    }),
  );
  await expect
    .poll(async () => {
      const snapshot = await readAgentExchange({
        store,
        sessionId: session.sessionId,
        planId: session.planId,
      });
      return snapshot.requests[0]?.claimedModel?.name;
    })
    .toBe("grok-4.6");
  await agentStatusTrigger(page).click();
  const rail = agentSidebar(page);
  const modelBadge = rail.locator("[data-review-agent-model]");
  await expect(modelBadge).toBeVisible();
  // The declared id is canonical; the catalog owns how it is written.
  await expect(modelBadge).toContainText("Grok 4.6");
  await expect(modelBadge).not.toContainText("grok-4.6");
  // Client, model, and effort read as one line, in the order a reader asks.
  await expect(modelBadge).toContainText("Grok CLI");
  await expect(modelBadge).not.toContainText("0.2.99");
  await expect(modelBadge).not.toContainText("Wrong waiting agent");
  await expect(modelBadge.locator("svg")).toHaveAttribute(
    "viewBox",
    "0 0 34 33",
  );
  // A claim is one declaration. Its missing effort is not filled from the
  // competing heartbeat, because that would compose an agent nobody declared.
  await expect(modelBadge).not.toContainText("max");
  await expect(modelBadge).not.toHaveAttribute("data-review-agent-effort");
  // A declared URL is the one segment that becomes an affordance.
  const chatLink = rail.getByRole("link", { name: "Open the agent's chat" });
  await expect(chatLink).toHaveAttribute("href", "https://grok.com/chat/42");
  await expect(chatLink).toHaveAttribute("rel", /noreferrer/u);
  await expect(chatLink).toHaveAttribute(
    "data-review-agent-session-interface",
    "grok-web",
  );

  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
  });
  await expect(modelBadge).toContainText("Grok 4.6");
});

test("should keep progress-only requests waiting in chat and agent status", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const request = messageAgentRequest({
    kind: "chat",
    requestId: "dddddddddddddddd",
    sessionId: session.sessionId,
    planId: session.planId,
    premiseSnapshot: deriveSnapshotDigest(await readFile(session.plan, "utf8")),
    createdAt: new Date().toISOString(),
    body: "Is this request actually claimed?",
  });
  await writeAgentRequest({ store, request });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  await appendProgressEvent({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: request.requestId,
      atMs: Date.now(),
      stepCode: "agent-note",
      step: "This event has no durable claim",
      state: "live",
    },
  });

  const sessionButton = agentStatusTrigger(page);
  await expect(sessionButton).toBeVisible();
  await sessionButton.click();
  const rail = agentSidebar(page);
  await expect(
    rail.locator("[data-review-current-activity='waiting']"),
  ).toContainText("Waiting for agent");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const feedbackRail = page.getByRole("complementary", { name: "Feedback" });
  await feedbackRail.getByRole("tab", { name: "Chat" }).click();
  await expect(
    feedbackRail.locator("li").filter({ hasText: request.body }),
  ).toContainText("Waiting for an agent");
});

test("should keep answered requests terminal when their response is unavailable", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const now = Date.now();
  const premiseSnapshot = deriveSnapshotDigest(
    await readFile(session.plan, "utf8"),
  );
  const request = {
    ...messageAgentRequest({
      kind: "chat",
      requestId: "dddddddddddddddd",
      sessionId: session.sessionId,
      planId: session.planId,
      premiseSnapshot,
      createdAt: new Date(now - 1_000).toISOString(),
      body: "Is this terminal without a response file?",
    }),
    baselineSnapshot: premiseSnapshot,
    claimedAt: new Date(now - 500).toISOString(),
    claimedBy: "eeeeeeeeeeeeeeee",
    claimExpiresAtMs: now + AGENT_CLAIM_LEASE_MS,
    claimGeneration: 1,
    answeredAt: new Date(now).toISOString(),
  };
  await writeAgentRequest({ store, request });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
  });

  const sessionButton = agentStatusTrigger(page);
  await expect(sessionButton).toBeVisible();
  await sessionButton.click();
  const rail = agentSidebar(page);
  await expect(
    rail.locator("[data-review-current-activity='idle']"),
  ).toContainText("Agent connected");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  const feedback = page.getByRole("complementary", { name: "Feedback" });
  await feedback.getByRole("tab", { name: "Chat" }).click();
  const exchange = feedback.locator("li").filter({ hasText: request.body });
  await expect(exchange).toContainText("The agent has answered");
  await expect(exchange).not.toContainText("Waiting");
});

test("should not keep an answered feedback batch active without its response", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await stageComment(page, "Clarify the shared retry boundary.");
  await stageComment(page, "Name the shared recovery owner.");
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submitted).ok()).toBe(true);

  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = exchange.requests.find(
    (candidate) =>
      candidate.kind === "feedback" && candidate.comments.length === 2,
  );
  if (request === undefined) {
    throw new Error("The terminal batch journey did not create feedback work");
  }
  const source = await readFile(session.plan, "utf8");
  const claimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: deriveSnapshotDigest(source),
    now: new Date().toISOString(),
  });
  await writeAgentRequest({
    store,
    request: {
      ...claimed,
      answeredAt: new Date().toISOString(),
    },
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "waiting",
  });

  await expect(
    rail.locator("[data-review-thread-group='ready']"),
  ).toContainText("Ready for review");
  await expect(
    rail.locator("[data-review-thread-group='working']"),
  ).toHaveCount(0);
});

// BIG-185. A comment card belongs to the sidebar, so the sidebar decides how
// wide it is. The batch's threads are laid out as a grid, and a grid item keeps
// `min-width: auto`: the single implicit track was therefore floored at the
// widest card's min-content width, which one pasted code block pushed far past
// the sidebar. Every card in that batch - the expanded one and the collapsed
// rows beside it - then rendered wider than the panel and was clipped mid-word
// by its hidden horizontal overflow, with no ellipsis and no card edge to say
// anything had been cut. Geometry is the only place this shows up, so it is
// asserted here rather than at a lower rung.
test("should keep every sidebar comment card inside the sidebar", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const sidebar = page.getByRole("complementary", { name: "Feedback" });

  // A reviewer quoting the call they mean is ordinary feedback, and it is what
  // gives the message a min-content width wider than the sidebar.
  const quotedCall =
    "await retrySchedule.claimNextDueBatch({ merchantId, limit: 100, lockTimeoutMs: 30000 });";
  await stageComment(page, "Name the recovery owner before the rollout.");
  await stageComment(
    page,
    `Call out the claim we make:\n\n\`\`\`ts\n${quotedCall}\n\`\`\``,
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await sidebar
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submitted).ok()).toBe(true);

  // A batch heads its own threads only once an agent has picked it up, and the
  // list those threads render into is what this journey measures.
  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = exchange.requests.find(
    (candidate) => candidate.kind === "feedback",
  );
  if (request === undefined) {
    throw new Error("The containment journey never sent a feedback batch");
  }
  await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: deriveSnapshotDigest(
      await readFile(session.plan, "utf8"),
    ),
    now: new Date().toISOString(),
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });

  const batch = sidebar.locator(
    `section[data-review-batch="${request.requestId}"]`,
  );
  const cards = batch.locator("[data-review-comment-id]");
  await expect(cards).toHaveCount(2);

  // The quoted call only reaches the page when its thread is open, so the
  // collapsed row beside it is measured against the same widened track.
  await sidebar
    .getByRole("button", { name: /Expand .* comment: .*claimNextDueBatch/su })
    .click();
  await expect(batch.getByText(quotedCall)).toBeVisible();

  const sidebarBox = await boxOf(sidebar);
  for (let index = 0; index < (await cards.count()); index += 1) {
    const cardBox = await boxOf(cards.nth(index));
    // Measured against the sidebar, not against the list: the cards are tied
    // to the list's own track, so a card is the width of the list even when
    // the track has blown past the panel. Only the panel's edge is the edge
    // the reader sees.
    expect(Math.round(cardBox.x + cardBox.width)).toBeLessThanOrEqual(
      Math.round(sidebarBox.x + sidebarBox.width),
    );
  }
  // ...and the pasted call stays inside the card that holds it. This is the
  // half a geometry check against the panel cannot see: a bare `pre` keeps
  // `white-space: pre`, so the line runs past the card's edge and the card's
  // hidden overflow cuts it mid-word rather than wrapping it.
  const quotedBox = await boxOf(batch.locator("pre code"));
  const quotedCardBox = await boxOf(
    batch.locator("[data-review-comment-id]").filter({ hasText: "claimNext" }),
  );
  expect(Math.round(quotedBox.x + quotedBox.width)).toBeLessThanOrEqual(
    Math.round(quotedCardBox.x + quotedCardBox.width),
  );
});

// The same containment, on the staged path: a comment is drawn by a different
// renderer before it is sent, so it needs its own proof that a pasted code
// block stays inside the card rather than being clipped by it (BIG-185).
test("should keep a staged comment's code block inside its sidebar card", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const sidebar = page.getByRole("complementary", { name: "Feedback" });

  const quotedCall =
    "await retrySchedule.claimNextDueBatch({ merchantId, limit: 100, lockTimeoutMs: 30000, onExhausted: reportToOncall });";
  await stageComment(
    page,
    [
      "Name the recovery owner here, and call out the claim below explicitly",
      "so a reviewer can check it against the retry schedule we already ship:",
      "",
      "```ts",
      quotedCall,
      "```",
    ].join("\n"),
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();

  // A staged card starts collapsed and its body starts clamped, so the pasted
  // call only reaches the page once both are open.
  await sidebar
    .getByRole("button", {
      name: /Expand staged comment: .*claimNextDueBatch/su,
    })
    .click();
  const card = sidebar.locator('[data-review-surface="rail"]');
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "… more" }).click();

  const quoted = card.locator("pre code");
  await expect(quoted).toHaveText(quotedCall);

  const sidebarBox = await boxOf(sidebar);
  const cardBox = await boxOf(card);
  const quotedBox = await boxOf(quoted);

  // The card fits the sidebar, and the quoted call fits the card. Comparing
  // the card to the list holding it would prove nothing: the card is tied to
  // the list's track, so the two agree even when the track has blown past the
  // panel. The second assertion is what a bare `pre` breaks: it keeps
  // `white-space: pre`, so the line runs past the card's edge and the card's
  // hidden overflow cuts it mid-word instead of wrapping it.
  expect(Math.round(cardBox.x + cardBox.width)).toBeLessThanOrEqual(
    Math.round(sidebarBox.x + sidebarBox.width),
  );
  expect(Math.round(quotedBox.x + quotedBox.width)).toBeLessThanOrEqual(
    Math.round(cardBox.x + cardBox.width),
  );
});

// BIG-158 and BIG-162. A batch header speaks for one batch, so it may not
// borrow the sidebar's working group: while an earlier batch runs, that group
// holds work this batch has nothing to do with. Reading it dressed a batch
// nobody had picked up in the spinner beside its own "Queued, 1 ahead" label,
// and even once every element told the truth the composition still put one
// batch's working threads under another batch's queued header. Once more than
// one batch is open, each batch heads its own threads.
test("should head each open batch with its own state and its own threads", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const sidebar = page.getByRole("complementary", { name: "Feedback" });
  const sections = sidebar.locator("section[data-review-thread-group]");
  const batchGroup = (request: AgentFeedbackRequest) =>
    sidebar.locator(`section[data-review-batch="${request.requestId}"]`);
  const threadsIn = (request: AgentFeedbackRequest) =>
    batchGroup(request).locator("[data-review-comment-id]");
  const spinnerIn = (request: AgentFeedbackRequest) =>
    batchGroup(request).locator("h3 [data-review-working-indicator]");

  const sendBatch = async (first: string, second: string): Promise<void> => {
    await stageComment(page, first);
    await stageComment(page, second);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await sidebar
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);
  };

  await sendBatch(
    "Clarify the retry boundary in the first batch.",
    "Name the recovery owner in the first batch.",
  );

  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const source = await readFile(session.plan, "utf8");
  const findBatch = async (
    batchCommentBody: string,
  ): Promise<AgentFeedbackRequest> => {
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = exchange.requests.find(
      (candidate) =>
        candidate.kind === "feedback" &&
        candidate.comments.some((comment) =>
          comment.body.includes(batchCommentBody),
        ),
    );
    if (request === undefined || request.kind !== "feedback") {
      throw new Error(`The batch journey never sent "${batchCommentBody}"`);
    }
    return request;
  };
  const pickUp = async (
    request: AgentFeedbackRequest,
  ): Promise<AgentFeedbackRequest> => {
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: deriveSnapshotDigest(source),
      now: new Date().toISOString(),
    });
    await writeAgentHeartbeat({
      store,
      sessionId: session.sessionId,
      state: "working",
      requestId: claimed.requestId,
    });
    await appendProgressEvent({
      store,
      event: {
        sessionId: session.sessionId,
        requestId: claimed.requestId,
        atMs: Date.now(),
        stepCode: "agent-note",
        step: "Reviewing the feedback batch",
        state: "live",
      },
    });
    if (claimed.kind !== "feedback") {
      throw new Error("The batch journey claimed work of the wrong kind");
    }
    return claimed;
  };

  const firstBatch = await pickUp(await findBatch("first batch"));

  await test.step("one batch keeps the sidebar's single section", async () => {
    await expect(batchGroup(firstBatch)).toHaveAttribute(
      "data-review-thread-group",
      "working",
    );
    await expect(spinnerIn(firstBatch)).toHaveCount(1);
    // Nothing to tell it apart from, so a lone batch earns no extra header:
    // its section is the only one in the sidebar.
    await expect(sections).toHaveCount(1);
  });

  await sidebar.getByRole("button", { name: "Close feedback" }).click();
  await sendBatch(
    "Clarify the retry boundary in the second batch.",
    "Name the recovery owner in the second batch.",
  );
  const secondBatch = await findBatch("second batch");

  await test.step("two batches each head their own threads", async () => {
    await expect(sections).toHaveCount(2);

    // The running batch keeps the working treatment, and keeps its threads.
    await expect(batchGroup(firstBatch)).toHaveAttribute(
      "data-review-thread-group",
      "working",
    );
    await expect(spinnerIn(firstBatch)).toHaveCount(1);
    await expect(threadsIn(firstBatch)).toHaveCount(2);

    // The waiting batch says it is waiting, and the threads under that label
    // are its own. The first batch's working threads used to sit here.
    await expect(batchGroup(secondBatch)).toContainText("Queued, 1 ahead");
    await expect(batchGroup(secondBatch)).toHaveAttribute(
      "data-review-thread-group",
      "queued",
    );
    await expect(spinnerIn(secondBatch)).toHaveCount(0);
    await expect(threadsIn(secondBatch)).toHaveCount(2);

    for (const comment of firstBatch.comments) {
      await expect(
        batchGroup(firstBatch).locator(
          `[data-review-comment-id="${comment.id}"]`,
        ),
      ).toHaveCount(1);
      await expect(
        batchGroup(secondBatch).locator(
          `[data-review-comment-id="${comment.id}"]`,
        ),
      ).toHaveCount(0);
    }
    for (const comment of secondBatch.comments) {
      await expect(
        batchGroup(secondBatch).locator(
          `[data-review-comment-id="${comment.id}"]`,
        ),
      ).toHaveCount(1);
    }
  });

  await test.step("a search query cannot hand a batch another batch's threads", async () => {
    // How many batches are open is a fact about the plan, not about what the
    // query shows. Counting only the batches with visible comments dropped the
    // sidebar back to the lone-batch path, which hands the batch still on
    // screen the whole working group - the composition BIG-162 removes.
    const search = sidebar.getByRole("searchbox", { name: "Search comments" });
    await search.fill("second batch");
    await expect(batchGroup(firstBatch)).toHaveCount(0);
    await expect(threadsIn(secondBatch)).toHaveCount(2);
    for (const comment of secondBatch.comments) {
      await expect(
        batchGroup(secondBatch).locator(
          `[data-review-comment-id="${comment.id}"]`,
        ),
      ).toHaveCount(1);
    }
    await search.fill("");
    await expect(threadsIn(firstBatch)).toHaveCount(2);
  });

  await test.step("pickup moves the treatment to the next batch", async () => {
    // Only pickup earns the spinner. An agent takes one batch at a time, so
    // the first has to finish before the second can start.
    await writeAgentRequest({
      store,
      request: { ...firstBatch, answeredAt: new Date().toISOString() },
    });
    await pickUp(secondBatch);
    await expect(batchGroup(secondBatch)).toHaveAttribute(
      "data-review-thread-group",
      "working",
    );
    await expect(spinnerIn(secondBatch)).toHaveCount(1);
    // The answered batch leaves the queue, so one batch is open again and the
    // sidebar is back to a single batch section beside the answered threads.
    await expect(batchGroup(firstBatch)).toHaveCount(0);
  });
});

test("should pause a nonstandard request behind an explicit warning", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await stageComment(
    page,
    "Add slides that depart from the standard template.",
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await submitted).ok()).toBe(true);

  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The warning journey requires a live review session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = nextPendingAgentRequest(exchange, agentViewer());
  if (request === undefined || request.kind !== "feedback") {
    throw new Error("The warning journey did not create feedback work");
  }
  const source = await readFile(session.plan, "utf8");
  const claimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: deriveSnapshotDigest(source),
    now: new Date().toISOString(),
  });
  const response = validateAgentResponseDraft({
    value: {
      requestId: request.requestId,
      outcomes: request.comments.map((comment) => ({
        commentId: comment.id,
        state: "warning",
        summary: "Would depart from the standard template",
        message:
          "Fulfilling this request would deviate from the standard template.",
      })),
    },
    request: claimed,
    commentsById: commentsFromExchange({
      requests: [claimed],
      responses: [],
    }),
    changedBlocks: new Set(),
    currentSnapshot: deriveSnapshotDigest(source),
    now: new Date().toISOString(),
  });
  await commitRequestTerminal({
    claimedBy: agentSessionId,
    store,
    response,
    now: new Date().toISOString(),
  });

  await rail
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  await expect(rail).toContainText(
    "Fulfilling this request would deviate from the standard template.",
  );
  const warningSummary = rail.locator("em", {
    hasText: "Would depart from the standard template",
  });
  await expect(warningSummary).toBeVisible();
  const doItAnyway = rail.getByRole("button", { name: "Do it anyway" });
  await expect(doItAnyway).toBeVisible();
  const override = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith("/api/agent-requests") &&
      candidate.request().method() === "POST",
  );
  await doItAnyway.click();
  expect((await override).ok()).toBe(true);
});

test("should contain working comments when resolved threads expand", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.setViewportSize({ width: 1_200, height: 900 });
  await page.goto(reviewRuntimeUrl);
  for (let index = 0; index < 6; index += 1) {
    await stageComment(
      page,
      `Resolve this completed feedback thread ${index + 1} ${"unbroken-".repeat(40)}`,
    );
  }
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const firstSubmission = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await firstSubmission).ok()).toBe(true);

  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The containment journey requires a live review session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const source = await readFile(session.plan, "utf8");
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const firstRequest = nextPendingAgentRequest(exchange, agentViewer());
  if (firstRequest === undefined || firstRequest.kind !== "feedback") {
    throw new Error("The containment journey did not create its first request");
  }
  const revisedSource = source.replace(
    "Keep every reviewer note safe while the plan is discussed.",
    "Keep every reviewer note safe and complete while the plan is discussed.",
  );
  const beforeDocument = renderDocument({
    markdown: source,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const afterDocument = renderDocument({
    markdown: revisedSource,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const changedBlocks = new Set(
    diffSnapshots({
      before: beforeDocument.blocks,
      after: afterDocument.blocks,
    }).flatMap((location) =>
      location.newBlockId === undefined ? [] : [location.newBlockId],
    ),
  );
  await writeFile(session.plan, revisedSource, "utf8");
  const resultSnapshot = deriveSnapshotDigest(revisedSource);
  await writeSnapshot({
    store,
    snapshot: resultSnapshot,
    source: revisedSource,
  });
  const firstClaimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: firstRequest.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: firstRequest.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await commitRequestTerminal({
    claimedBy: agentSessionId,
    store,
    response: validateAgentResponseDraft({
      value: {
        requestId: firstRequest.requestId,
        outcomes: firstRequest.comments.map((comment) => ({
          commentId: comment.id,
          state: "warning",
          summary: "Unbroken".repeat(10),
          message: "The completed feedback needs confirmation.",
        })),
      },
      request: firstClaimed,
      commentsById: commentsFromExchange(exchange),
      changedBlocks,
      currentSnapshot: resultSnapshot,
      now: new Date().toISOString(),
    }),
    now: new Date().toISOString(),
  });

  for (let index = 0; index < 6; index += 1) {
    const resolutionPersisted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await rail.getByRole("button", { name: "Resolve thread" }).first().click();
    await expect(rail.getByText(`Resolved (${index + 1})`)).toBeVisible();
    expect((await resolutionPersisted).ok()).toBe(true);
  }

  await rail.getByRole("button", { name: "Close feedback" }).click();
  await stageComment(
    page,
    `Keep the active feedback thread usable ${"unbroken-".repeat(40)}`,
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const secondSubmission = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await secondSubmission).ok()).toBe(true);
  const secondExchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const secondRequest = nextPendingAgentRequest(secondExchange, agentViewer());
  if (secondRequest === undefined || secondRequest.kind !== "feedback") {
    throw new Error(
      "The containment journey did not create its working request",
    );
  }
  const secondClaimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: secondRequest.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: secondRequest.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: secondClaimed.requestId,
  });
  await appendProgressEvent({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: secondClaimed.requestId,
      atMs: Date.now(),
      stepCode: "agent-note",
      step: "Reviewing the shared feedback batch",
      state: "live",
    },
  });
  const workingGroup = rail.locator("[data-review-thread-group='working']");
  await expect(workingGroup).toBeVisible();
  await expect(
    workingGroup.getByRole("button", { name: "Cancel request" }),
  ).toBeVisible();
  const railWidthBeforeResolved = await rail.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await rail.getByText("Resolved (6)").click();
  const resolvedSection = rail.locator("details");
  await resolvedSection
    .getByRole("button", { name: "Expand thread" })
    .first()
    .click();
  expect(
    await rail.evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(railWidthBeforeResolved);

  const measureContainment = async () =>
    rail.locator(".review-feedback-panel").evaluate((panel) => {
      const details = panel.querySelector("details");
      if (details === null) {
        throw new Error("The expanded resolved section is missing");
      }
      return {
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
      };
    });
  const containment = await measureContainment();
  expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth);

  const cancelRequest = workingGroup.getByRole("button", {
    name: "Cancel request",
  });
  await expect(cancelRequest).toBeVisible();
  await expect(cancelRequest).toBeEnabled();
  await cancelRequest.click({ trial: true });

  const workingThread = workingGroup.locator(
    "[data-review-sent-thread='working']",
  );
  const workingMessage = workingThread
    .locator('[data-review-message="user"] p')
    .first();
  await expect(workingMessage).toBeVisible();
  const messageLayout = await workingMessage.evaluate((message) => {
    const panel = message.closest(".review-feedback-panel");
    if (panel === null) {
      throw new Error("The working message is outside the feedback panel");
    }
    const panelRect = panel.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(message);
    const textRects = [...range.getClientRects()].filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    return {
      lineCount: new Set(textRects.map((rect) => Math.round(rect.top))).size,
      textRight: Math.max(...textRects.map((rect) => rect.right)),
      panelRight: panelRect.right,
    };
  });
  expect(messageLayout.lineCount).toBeGreaterThan(1);
  expect(messageLayout.textRight).toBeLessThanOrEqual(
    messageLayout.panelRight + 0.5,
  );

  const replyComposer = workingThread.getByPlaceholder("Reply to the agent…");
  await replyComposer.click();
  await expect(replyComposer).toBeFocused();
  const composerContainment = await replyComposer.evaluate((composer) => {
    const panel = composer.closest(".review-feedback-panel");
    if (panel === null) {
      throw new Error("The reply composer is outside the feedback panel");
    }
    const composerRect = composer.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      left: composerRect.left >= panelRect.left - 0.5,
      right: composerRect.right <= panelRect.right + 0.5,
      top: composerRect.top >= panelRect.top - 0.5,
      bottom: composerRect.bottom <= panelRect.bottom + 0.5,
    };
  });
  expect(composerContainment).toEqual({
    left: true,
    right: true,
    top: true,
    bottom: true,
  });
  await replyComposer.fill("Keep this working thread actionable.");
  const replyButton = workingThread.getByRole("button", { name: "Reply" });
  await expect(replyButton).toBeVisible();
  await expect(replyButton).toBeEnabled();
  await replyButton.click({ trial: true });

  await page.setViewportSize({ width: 320, height: 900 });
  const narrowContainment = await measureContainment();
  expect(narrowContainment.scrollWidth).toBeLessThanOrEqual(
    narrowContainment.clientWidth,
  );
});

// The defect this journey guards was invisible: resolving a thread silently
// threw away the message waiting on it. Only a real browser can prove the
// reviewer now sees the refusal and keeps the queued message.
test.describe("a resolve the runtime refuses", () => {
  // The refusal this journey asks for is the 409 the browser also reports as
  // a failed resource load.
  test.use({ allowedConsoleErrors: [/Failed to load resource:.*409/u] });

  test("should refuse to resolve a thread holding a queued message", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    const COMMENT = "Do not resolve this while the agent still owes it.";
    await page.goto(reviewRuntimeUrl);
    await stageComment(page, COMMENT);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);

    await rail.getByRole("button", { name: "Close feedback" }).click();
    const inlineThread = page
      .locator("[data-review-sent-thread='queued']")
      .filter({ hasText: COMMENT });
    await inlineThread
      .getByRole("button", { name: `Expand comment: ${COMMENT}` })
      .click();
    const refused = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/drafts") &&
        response.request().method() === "PUT",
    );
    await inlineThread.getByRole("button", { name: "Resolve thread" }).click();
    expect((await refused).status()).toBe(409);

    await expect(page.locator("[data-review-resolve-refusal]")).toContainText(
      "waiting for the coding agent",
    );
    await expect(
      inlineThread.getByRole("button", { name: "Resolve thread" }),
    ).toBeVisible();

    // The queued message survived the refused resolve, which is the whole point.
    await page.reload();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(rail.getByText(/^Resolved \(/u)).toHaveCount(0);
    await expect(
      rail.getByRole("button", {
        name: `Expand queued comment: ${COMMENT}`,
      }),
    ).toBeVisible();
  });
});

test("should align an agent request target at the top of the reading column", async ({
  page,
  reviewRuntimeScrollUrl,
}) => {
  await page.goto(reviewRuntimeScrollUrl);
  const session = await liveReviewSession(page);
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  const targetHeading = page.getByRole("heading", {
    name: "Scroll regression target",
  });
  const target = page.locator("[data-slide]").filter({ has: targetHeading });
  await target.hover();
  await target.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/ });
  const submitRightAway = composer.getByRole("switch", {
    name: "Submit right away",
  });
  if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
    await submitRightAway.click();
  }
  await composer
    .getByLabel("Add a comment")
    .fill("Show this below-fold target.");
  await composer.getByRole("button", { name: "Add Comment" }).click();

  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const feedback = page.getByRole("complementary", { name: "Feedback" });
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await feedback
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await sent).ok()).toBe(true);
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = nextPendingAgentRequest(exchange, agentViewer());
  if (request === undefined || request.kind !== "feedback") {
    throw new Error("The scroll journey did not create a feedback request");
  }
  await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });

  const statusTrigger = agentStatusTrigger(page);
  await expect(statusTrigger).toHaveAccessibleName(
    "Agent Status: Agent working",
  );
  await statusTrigger.click();
  const activeWork = agentSidebar(page).locator(
    "[data-review-current-activity='working']",
  );
  await expect(activeWork).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const viewportHeight = page.viewportSize()?.height ?? 0;
  expect(
    await target.evaluate((element) => element.getBoundingClientRect().top),
  ).toBeGreaterThan(viewportHeight);

  await activeWork.getByRole("button").first().click();
  await expect
    .poll(async () => {
      const top = await target.evaluate(
        (element) => element.getBoundingClientRect().top,
      );
      return top < 0
        ? `above:${Math.round(top)}`
        : top >= viewportHeight / 2
          ? `below:${Math.round(top)}`
          : "positioned";
    })
    .toBe("positioned");
  await expect(agentSidebar(page)).toHaveCount(0);
  await expect(feedback).toBeVisible();
});

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}, testInfo) => {
  await page.goto(reviewRuntimeUrl);

  const agentStatus = agentStatusTrigger(page);
  const feedbackAction = page.getByRole("button", {
    name: "Feedback",
    exact: true,
  });
  const settingsAction = page.getByRole("button", { name: "Open settings" });
  await expect(agentStatus).toBeVisible();
  // The control draws exactly one state mark, and with no agent connected it is
  // not the working one. Asserting the mark exists first keeps the second
  // assertion from passing because nothing was drawn at all.
  await expect(agentStatus.locator("[data-review-agent-status]")).toHaveCount(
    1,
  );
  await expect(
    agentStatus.locator('[data-review-agent-status="working"]'),
  ).toHaveCount(0);
  await expect(feedbackAction).toBeVisible();
  await expect(settingsAction).toBeVisible();
  await expect(
    page.locator('input[type="range"], input[type="color"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("toolbar", { name: "Preview controls" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Light theme" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Dark theme" })).toHaveCount(0);
  await expect(page.getByText("Ring padding", { exact: true })).toHaveCount(0);
  const toolbarGaps = await Promise.all([
    agentStatus.boundingBox(),
    feedbackAction.boundingBox(),
    settingsAction.boundingBox(),
  ]).then(([status, feedback, settings]) => {
    if (status === null || feedback === null || settings === null)
      throw new Error("The review toolbar actions were not rendered");
    return [
      feedback.x - status.x - status.width,
      settings.x - feedback.x - feedback.width,
    ];
  });
  expect(toolbarGaps).toEqual([4, 4]);
  const agentStatusWidth = Math.round(
    (await agentStatus.boundingBox())?.width ?? 0,
  );
  expect(agentStatusWidth).toBeGreaterThan(0);

  await stageComment(page, "Clarify the failure boundary.");
  await stageComment(page, "Name the operator recovery path.");
  await stageComment(page, "Remove this queued comment before pickup.");

  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const imageComposer = page.getByRole("dialog", { name: /Comment on/ });
  const imageTextarea = imageComposer.getByLabel("Add a comment");
  await imageTextarea.evaluate((element, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    );
    const file = new File([bytes], "clipboard.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }),
    );
  }, PASTED_PNG_BASE64);
  await expect(
    imageComposer.getByRole("img", { name: "Screenshot" }),
  ).toBeVisible();
  await imageComposer.getByRole("button", { name: "Add Comment" }).click();

  const rail = page.getByRole("complementary", { name: "Feedback" });
  const kernel = page.locator("#big-plan-review-root");
  await expect(rail).toHaveCount(0);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Name the operator recovery path.");
  await expect(rail).toContainText("Remove this queued comment before pickup.");
  await rail
    .getByRole("button", {
      name: /Expand staged comment:.*review-image:/u,
    })
    .click();
  await expect(rail.getByRole("img", { name: "Screenshot" })).toBeVisible();
  await expect(rail).toContainText("1 · Details");
  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Name the operator recovery path.");
  await expect(rail).toContainText("Remove this queued comment before pickup.");
  await rail
    .getByRole("button", {
      name: /Expand staged comment:.*review-image:/u,
    })
    .click();
  const pastedPicture = rail.getByRole("img", { name: "Screenshot" }).first();
  await expect(pastedPicture).toBeVisible();
  // The picture is addressed by its digest alone, so it belongs to the plan
  // rather than to the session that accepted it and still resolves after this
  // reload - and after a restart, which the runtime suite proves directly.
  await expect(pastedPicture).toHaveAttribute(
    "src",
    /^\/review-images\/[a-f0-9]{64}$/u,
  );

  await test.step("the lightbox keeps every control inside the viewport and touchable", async () => {
    await rail.getByRole("button", { name: "Open Screenshot" }).first().click();
    const lightbox = page.getByRole("dialog", { name: "Screenshot" });
    const zoom = lightbox.getByRole("group", { name: "Image zoom" });
    const closeImage = lightbox.getByRole("button", { name: "Close image" });
    await expect(closeImage).toBeFocused();
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error("The journey has no viewport");
    const zoomBox = await boxOf(zoom);
    const closeBox = await boxOf(closeImage);
    for (const box of [zoomBox, closeBox]) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    // Top centre, as the captain placed it: the zoom group's own centre is the
    // viewport centre, and it sits above the picture rather than over it.
    expect(
      Math.abs(zoomBox.x + zoomBox.width / 2 - viewport.width / 2),
    ).toBeLessThanOrEqual(1);
    await lightbox.getByRole("button", { name: "Zoom in" }).click();
    await expect(zoom).toContainText("125%");
    await lightbox.getByRole("button", { name: "Fit image" }).click();
    await expect(zoom).toContainText("100%");
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await expect(
      rail.getByRole("button", { name: "Open Screenshot" }).first(),
    ).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await rail.getByRole("button", { name: "Open Screenshot" }).first().click();
    await expect(lightbox).toBeVisible();
    for (const name of ["Zoom out", "Zoom in", "Fit image", "Close image"]) {
      const controlBox = await boxOf(lightbox.getByRole("button", { name }));
      expect(controlBox.width).toBeGreaterThanOrEqual(44);
      expect(controlBox.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await page.route("**/review-images/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: "not an image",
      }),
    );
    await rail.getByRole("button", { name: "Open Screenshot" }).first().click();
    await expect(lightbox).toBeVisible();
    await expect(
      lightbox.locator("[data-review-image-unavailable]"),
    ).toContainText("Image unavailable");
    const disclosure = lightbox.getByText("What happened");
    const detail = lightbox.getByText(/could not load/u);
    await expect(detail).toBeHidden();
    const disclosureBox = await boxOf(disclosure);
    expect(disclosureBox.width).toBeGreaterThanOrEqual(44);
    expect(disclosureBox.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(disclosure).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detail).toBeVisible();
    await page.unroute("**/review-images/*");
    await page.keyboard.press("Escape");
    await expect(lightbox).toHaveCount(0);
    await page.setViewportSize(viewport);
  });

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const answer: unknown = await response.json();
  if (
    typeof answer !== "object" ||
    answer === null ||
    !("package" in answer) ||
    !("brief" in answer) ||
    typeof answer.package !== "string" ||
    typeof answer.brief !== "string"
  ) {
    throw new Error("The feedback response did not name its output files");
  }
  expect((await stat(answer.package)).isFile()).toBe(true);
  expect((await stat(answer.brief)).isFile()).toBe(true);
  expect(await readFile(answer.brief, "utf8")).toContain(
    "Clarify the failure boundary.",
  );

  await expect(rail.getByPlaceholder("Search comments")).toBeVisible();
  await expect(rail).not.toContainText("comments sent to the agent");
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
  const queuedForDeletion = rail
    .locator("[data-review-sent-thread='queued']")
    .filter({ hasText: "Remove this queued comment before pickup." });
  await queuedForDeletion
    .getByRole("button", {
      name: "Expand queued comment: Remove this queued comment before pickup.",
    })
    .click();
  await queuedForDeletion
    .getByRole("button", { name: "Delete queued comment" })
    .click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete queued comment?",
  });
  await expect(deleteDialog).toContainText(
    "This removes the comment before the agent picks it up.",
  );
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(rail).not.toContainText(
    "Remove this queued comment before pickup.",
  );
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const sessionResponse = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return sessionResponse.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not describe its live session");
  }
  const store = reviewStoreFor({
    planPath: session.plan,
    planId: session.planId,
  });
  await rm(store.agentHeartbeatPath, { force: true });
  await expect(agentStatusTrigger(page)).toBeVisible();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const blockedSummary = page.locator(
    ".review-contextual-summary[data-review-sent-thread='queued']",
  );
  await expect(
    blockedSummary
      .getByRole("img", {
        name: "Blocked - no agent connected",
      })
      .first(),
  ).toBeVisible();
  await expect(blockedSummary.first()).toContainText("Queued");
  await expect(blockedSummary.first()).not.toContainText(
    "BLOCKED - NO AGENT CONNECTED",
  );
  await expect(
    blockedSummary.getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();

  await agentStatusTrigger(page).click();
  const agentRail = agentSidebar(page);
  await expect(
    agentRail.getByText("Current status", { exact: true }),
  ).toHaveCount(0);
  const currentActivity = agentRail.locator("[data-review-current-activity]");
  // No agent has attached to this session, so the card must not report a
  // connection that ended, and must not date one with a "since".
  await expect(currentActivity).toHaveAttribute(
    "data-review-current-activity",
    "never-connected",
  );
  await expect(currentActivity).toContainText(
    "No agent has connected to this session yet.",
  );
  await expect(currentActivity).not.toContainText("Since");
  await expect(currentActivity).not.toContainText("1 · Details");
  // Nothing here is a request, so the card offers nothing to open.
  await expect(currentActivity.getByRole("button")).toHaveCount(0);
  await expect(agentRail.getByText("offline", { exact: true })).toHaveCount(0);
  // Nothing has connected, so the section offers to connect rather than to
  // reconnect; it is present either way.
  await expect(
    agentRail.getByText("Connect your agent", { exact: true }),
  ).toBeVisible();
  // Item 4: one payload, not two - the connector command below it is gone.
  await expect(agentRail.locator("pre")).toHaveCount(1);
  // The control is floated into the payload, so a label that grows would move
  // the payload's line breaks at the moment a copy succeeds. Its width is
  // reserved by the widest label it can ever show.
  await agentRail
    .locator("details[data-review-agent-recovery] > summary")
    .click();
  const copyControl = agentRail.getByRole("button", { name: /^Copy / });
  const copyWidth = async () =>
    Math.round((await copyControl.boundingBox())?.width ?? 0);
  const restingWidth = await copyWidth();
  expect(restingWidth).toBeGreaterThan(0);
  await copyControl.evaluate((node: HTMLElement) => {
    const label = node.querySelector("span > span:last-child");
    // Throwing rather than skipping: a missing label would otherwise leave the
    // width unchanged and let the assertion below pass without testing
    // anything, so the contract would lose its cover silently.
    if (label === null) throw new Error("copy control has no visible label");
    label.textContent = "Copy failed";
  });
  expect(await copyWidth()).toBe(restingWidth);
  const connectionLog = agentRail
    .getByText("Connection log", { exact: true })
    .locator("xpath=ancestor::summary");
  await expect(connectionLog.locator("svg")).toHaveCount(1);
  await connectionLog.click();
  // The log is the history alone. State, since, last signal, and the event
  // tally are the status card's answers, and repeating them under this heading
  // asked the reader to reconcile two renderings of one fact (BIG-176).
  const connectionLogBody = agentRail.locator(
    "[data-review-connection-history]",
  );
  await expect(connectionLogBody.locator("dl")).toHaveCount(0);
  for (const duplicated of ["Last signal", "State", "Since", "Events"]) {
    await expect(
      connectionLogBody.getByText(duplicated, { exact: true }),
    ).toHaveCount(0);
  }
  /*
  Every entry's marker is a dot: as wide as it is tall, and painted the way its
  own state names. Both halves have failed silently here - a minimum line box
  meant for the row's text stretched the circle into a pill, and a `bg-paper`
  ground carried in the base class list outranked each state's fill, so the
  markers rendered as empty vertical ovals (BIG-176).

  What each layer proves is not the same thing. This block proves the geometry:
  no entry in this session has ever connected, so the connected fill - the half
  the ground actually defeated - is proven where a connected row exists, at the
  second connection-log site in this test. The unit test on
  connectionMarkerClassName proves the authoring rule, that a state names
  exactly one background utility, and it can prove nothing more: a specificity
  or emission-order loss is invisible in a class list and appears only once the
  cascade resolves, so the browser-layer assertion on a connected row is the
  only one that covers it.
  */
  const markers = await agentRail
    .locator("[data-review-connection-marker]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const row = node.parentElement;
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          background: style.backgroundColor,
          borderColor: style.borderColor,
          // A live entry - connected, or the latest one whatever it says -
          // is the filled kind; a settled quiet entry is the hollow kind.
          live:
            row?.getAttribute("data-review-connection-event") === "connected" ||
            row?.hasAttribute("data-review-connection-current") === true,
        };
      }),
    );
  expect(markers.length).toBeGreaterThan(0);
  for (const marker of markers) {
    expect(marker.width).toBe(6);
    expect(marker.height).toBe(marker.width);
    // Filled means painted its own colour edge to edge. The regression showed
    // the page ground through every marker instead, which is what made them
    // read as empty.
    if (marker.live) expect(marker.background).toBe(marker.borderColor);
    else expect(marker.background).not.toBe(marker.borderColor);
  }
  const currentConnectionEvent = agentRail.locator(
    "[data-review-connection-current]",
  );
  await expect(currentConnectionEvent).toHaveCSS("line-height", "12px");
  // The current entry carries a badge on its title line and every other entry
  // does not, so the title line is the one place these states could drift
  // apart. Every entry must put the same distance between its title and its
  // description, whatever else sits on that line.
  const titleGaps = await agentRail
    .locator("[data-review-connection-event]")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const title = row.querySelector("strong");
        const description = row.querySelector(
          "[data-review-connection-duration]",
        );
        if (title === null || description === null) return null;
        return Math.round(
          description.getBoundingClientRect().top -
            title.getBoundingClientRect().bottom,
        );
      }),
    );
  expect(titleGaps.length).toBeGreaterThan(0);
  expect(new Set(titleGaps)).toEqual(new Set([2]));
  const currentDuration = currentConnectionEvent.locator(
    "[data-review-connection-duration]",
  );
  await expect(currentDuration).toBeVisible();
  await currentDuration.evaluate((node) => {
    const values = [node.textContent ?? ""];
    const observer = new MutationObserver(() => {
      const value = node.textContent ?? "";
      if (values.at(-1) !== value) values.push(value);
    });
    observer.observe(node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Object.assign(window, {
      __bigPlanConnectionDurations: values,
      __bigPlanConnectionDurationObserver: observer,
    });
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __bigPlanConnectionDurations: ReadonlyArray<string>;
              }
            ).__bigPlanConnectionDurations.length,
        ),
      { timeout: 3_500 },
    )
    .toBeGreaterThanOrEqual(2);
  const durationValues = await page.evaluate(() => {
    const runtime = window as unknown as {
      __bigPlanConnectionDurations: ReadonlyArray<string>;
      __bigPlanConnectionDurationObserver: MutationObserver;
    };
    runtime.__bigPlanConnectionDurationObserver.disconnect();
    return runtime.__bigPlanConnectionDurations.slice(-3);
  });
  const durationSeconds = durationValues.map((value) => {
    const hours = Number(/(\d+)h/u.exec(value)?.[1] ?? 0);
    const minutes = Number(/(\d+)m/u.exec(value)?.[1] ?? 0);
    const seconds = Number(/(\d+)s/u.exec(value)?.[1] ?? 0);
    return hours * 3_600 + minutes * 60 + seconds;
  });
  // Monotonic only. The contract this proves is that the label keeps counting
  // up from the connection it names; an upper bound on the step cannot tell a
  // wrong timer from a test process the machine starved for three seconds, so
  // it can only ever produce a flake.
  for (let index = 1; index < durationSeconds.length; index += 1) {
    const previous = durationSeconds[index - 1] ?? 0;
    const current = durationSeconds[index] ?? 0;
    expect(current).toBeGreaterThan(previous);
  }
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await rail.getByRole("tab", { name: "Comments" }).click();
  const selectedThread = rail
    .locator("[data-review-comment-id]")
    .filter({ hasText: "Clarify the failure boundary." });
  await selectedThread
    .getByRole("button", {
      name: /^(?:Expand thread:|Expand queued comment:)/u,
    })
    .click();
  const reply = selectedThread.getByPlaceholder("Reply to the agent…");
  await expect(reply).toBeVisible();
  const selectedToolbar = selectedThread.locator(".review-thread-meta");
  const restingToolbarBackground = await selectedToolbar.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  await selectedToolbar.hover();
  await expect
    .poll(() =>
      selectedToolbar.evaluate(
        (node) => getComputedStyle(node).backgroundColor,
      ),
    )
    .not.toBe(restingToolbarBackground);
  const selectedTitle = selectedToolbar.getByRole("button", {
    name: "1 · Details",
    exact: true,
  });
  await expect(selectedTitle).toHaveCSS("text-decoration-line", "none");
  await rail
    .getByRole("button", {
      name: /open Agent Status$/u,
    })
    .click();
  await expect(agentStatusTrigger(page)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Opening the sidebar shows the status card; it does not ring it. A ring
  // means the keyboard is here, and clicking a control is not that.
  const openedCard = agentSidebar(page).locator(
    "[data-review-current-activity]",
  );
  await expect(openedCard).toBeVisible();
  expect(
    await openedCard.evaluate((card) => getComputedStyle(card).outlineStyle),
  ).toBe("none");
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await rail.getByRole("tab", { name: "Comments" }).click();
  await expect(reply).toBeVisible();
  await selectedTitle.click();
  await expect(reply).toBeVisible();
  await selectedThread.getByRole("button", { name: "Minimize thread" }).click();
  await expect(
    selectedThread.getByRole("button", {
      name: "Expand queued comment: Clarify the failure boundary.",
    }),
  ).toBeVisible();

  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = nextPendingAgentRequest(exchange, agentViewer());
  if (request === undefined || request.kind !== "feedback") {
    throw new Error("Sending did not create a pending feedback request");
  }
  expect(request.comments).toHaveLength(3);
  // An agent starts work by taking the claim, and only then narrates. Progress
  // alone no longer implies pickup, so this journey seeds the real thing.
  await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
    model: {
      name: "claude-opus-5",
      client: "claude-code 2.1.217",
      sessionId: "e08e45b4-4e2e-412a-9f3c-1a2b3c4d5e6f",
    },
    now: Date.now() - 10_000,
  });
  await appendProgressEvent({
    store,
    event: {
      sessionId: session.sessionId,
      requestId: request.requestId,
      atMs: Date.now(),
      stepCode: "agent-note",
      step: "Reviewing the shared feedback batch",
      state: "live",
    },
  });

  const workingAgent = agentStatusTrigger(page);
  await expect(workingAgent).toHaveAccessibleName(
    "Agent Status: Agent working",
  );
  expect(Math.round((await workingAgent.boundingBox())?.width ?? 0)).toBe(
    agentStatusWidth,
  );
  const workingMark = agentStatusIndicator(page);
  await expect(workingMark).toHaveAttribute(
    "data-review-agent-status",
    "working",
  );
  // Working separates itself from merely connected by motion, so this reads the
  // shipped animation rather than a class name. It is the product's one working
  // mark - a rotating circle with a gap - the same mark the batch headers and
  // the thread chips show, so a reader learns it once.
  const readMark = () =>
    workingMark.evaluate((mark) => {
      const spinner = mark.firstElementChild;
      if (spinner === null) return null;
      const style = getComputedStyle(spinner);

      return {
        animationName: style.animationName,
        animationIterationCount: style.animationIterationCount,
        animationTimingFunction: style.animationTimingFunction,
        borderRadius: style.borderTopLeftRadius,
        // The gap is one transparent side of an otherwise drawn ring.
        transparentSides: [
          style.borderTopColor,
          style.borderRightColor,
          style.borderBottomColor,
          style.borderLeftColor,
        ].filter((colour) => colour.endsWith(", 0)")).length,
        // The laid-out box, not the bounding box: this mark is rotating, so
        // its axis-aligned bounds breathe between the square and its diagonal.
        size: [style.width, style.height],
      };
    });
  expect(await readMark()).toMatchObject({
    animationName: "spin",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
    transparentSides: 1,
    // A step larger than the connected dot, at the captain's measurement: a
    // ring encloses space where a disc fills it, so equal diameters do not read
    // as equal weight.
    size: ["10px", "10px"],
  });

  await page.emulateMedia({ colorScheme: "dark" });
  expect((await readMark())?.animationName).toBe("spin");
  await workingAgent.screenshot({
    path: testInfo.outputPath("agent-working-fade-dark.png"),
  });
  // Readers who ask the OS for less motion get the mark without the fade.
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  // Reduced motion slows the mark rather than stopping it: a static ring reads
  // as a shape, and this mark is only on screen while work is in flight.
  expect((await readMark())?.animationName).toBe("spin");
  expect(
    await workingMark.evaluate((mark) => {
      const spinner = mark.firstElementChild;
      return spinner === null
        ? null
        : getComputedStyle(spinner).animationDuration;
    }),
  ).toBe("2.4s");
  await workingAgent.screenshot({
    path: testInfo.outputPath("agent-working-fade-reduced-motion.png"),
  });

  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await agentStatusTrigger(page).click();
  const activeWork = agentSidebar(page).locator(
    "[data-review-current-activity='working']",
  );
  await expect(activeWork).toContainText("Agent working");
  await expect(activeWork).toContainText("Reviewing the shared feedback batch");
  // The working card carries the session and nothing else about the
  // connection: the request, then the identifier, then when it last spoke.
  expect(
    await activeWork.evaluate((card) =>
      [...card.children].map((child) => child.tagName),
    ),
  ).toEqual(["DIV", "SPAN", "P", "DIV", "DL", "DIV"]);
  await expect(activeWork.locator("dt")).toHaveText(["Agent session"]);
  await expect(
    activeWork.getByRole("button", { name: /^Copy agent session identifier/u }),
  ).toBeVisible();

  // Opening the request is a request to see the reviewer's own feedback, so the
  // sidebar claims its slot for the feedback body. Setting the tab alone left
  // agent diagnosis on screen and the thread the reader asked for invisible.
  await activeWork.getByRole("button").first().click();
  await expect(agentSidebar(page)).toHaveCount(0);
  await expect(rail).toBeVisible();
  await expect(rail.getByRole("tab", { name: "Comments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    rail
      .locator("[data-review-comment-id]")
      .filter({ hasText: "Clarify the failure boundary." }),
  ).toBeVisible();

  // Re-pressing the pressed control closes its window; it never hands the slot
  // to the other body.
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await expect(rail).toHaveCount(0);
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await rail.getByRole("tab", { name: "Chat" }).click();
  await rail
    .getByPlaceholder("Ask about the plan as a whole…")
    .fill("How does this affect the rollout?");
  await rail.getByRole("button", { name: "Send", exact: true }).click();
  const waitingChat = rail
    .locator("li")
    .filter({ hasText: "How does this affect the rollout?" });
  await expect(waitingChat).toContainText("Waiting for an agent");
  await expect(
    waitingChat.getByRole("button", { name: "View active comment →" }),
  ).toHaveCount(0);
  await waitingChat.getByRole("button", { name: "Cancel request" }).click();
  await expect(waitingChat).toContainText("Request canceled");
  await rail.getByRole("tab", { name: "Comments" }).click();
  const expandedActiveComment = rail
    .locator("[data-review-comment-id]")
    .filter({ hasText: "Clarify the failure boundary." });
  await expandedActiveComment
    .getByRole("button", { name: "Minimize thread" })
    .click();

  const workingGroup = rail.locator("[data-review-thread-group='working']");
  await expect(workingGroup).toBeVisible();
  const workingCards = workingGroup.locator(
    "[data-review-sent-thread='working']",
  );
  await expect(workingCards).toHaveCount(3);
  await expect(
    workingCards.locator("[data-review-thread-status='working']"),
  ).toHaveCount(0);
  const threadActivity = workingGroup.locator(
    "[data-review-thread-status='working']",
  );
  await expect(threadActivity).toHaveCount(1);
  await expect(threadActivity).toContainText("Agent is working on 3 comments");
  await expect(threadActivity).toContainText(
    "Reviewing the shared feedback batch",
  );
  await agentStatusTrigger(page).click();
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  await agentSidebar(page)
    .getByText("Connection log", { exact: true })
    .locator("xpath=ancestor::summary")
    .click();
  /*
  An agent has connected here, so this is where the connected marker's fill can
  be read off the cascade. A connected entry is filled with the colour it
  outlines; carrying a `bg-paper` ground in the marker's base class list beat
  that fill on emission order and showed the page through the dot instead
  (BIG-176). The count is asserted first because a scenario that happened to
  render no connected row would pass this loop while proving nothing.
  */
  const connectedMarkers = await agentSidebar(page)
    .locator(
      "[data-review-connection-event='connected'] [data-review-connection-marker]",
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          background: style.backgroundColor,
          borderColor: style.borderColor,
        };
      }),
    );
  expect(connectedMarkers.length).toBeGreaterThan(0);
  for (const marker of connectedMarkers) {
    expect(marker.background).toBe(marker.borderColor);
  }
  // Closing a sidebar from its own control hands focus back to the toolbar
  // control that opened it. Without that the aside unmounts and focus falls to
  // the document body, so a keyboard reader tabs from the top of the plan to
  // get back. Both bodies owe the reader the same thing.
  await agentSidebar(page)
    .getByRole("button", { name: "Close Agent Status" })
    .click();
  await expect(agentSidebar(page)).toHaveCount(0);
  await expect(agentStatusTrigger(page)).toBeFocused();
  const feedbackTrigger = page.getByRole("button", {
    name: "Feedback",
    exact: true,
  });
  await feedbackTrigger.click();
  await rail.getByRole("tab", { name: "Comments" }).click();

  await rail.getByRole("button", { name: "Close feedback" }).click();
  await expect(rail).toHaveCount(0);
  await expect(feedbackTrigger).toBeFocused();
  await writeAgentHeartbeat({
    store,
    sessionId: session.sessionId,
    state: "working",
    requestId: request.requestId,
  });
  const compactWorkingThreads = page.locator(
    "[data-review-thread-side] [data-review-sent-thread='working']",
  );
  await expect(compactWorkingThreads).toHaveCount(3);
  await expect(compactWorkingThreads.getByLabel("Working")).toHaveCount(3);
  const firstWorkingThread = compactWorkingThreads.filter({
    hasText: "Clarify the failure boundary.",
  });
  await firstWorkingThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect(firstWorkingThread).toContainText(
    "Agent is working on 3 comments",
  );
  await expect(firstWorkingThread).toContainText(
    "Reviewing the shared feedback batch",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-review-thread-side] > :first-child",
          ),
        ).filter((card) => card.getBoundingClientRect().height > 0);
        return cards.flatMap((card, index) => {
          const rect = card.getBoundingClientRect();
          return cards.slice(index + 1).flatMap((other) => {
            const otherRect = other.getBoundingClientRect();
            const overlaps =
              rect.left < otherRect.right &&
              rect.right > otherRect.left &&
              rect.top < otherRect.bottom &&
              rect.bottom > otherRect.top;
            return overlaps ? [`${index}`] : [];
          });
        });
      }),
    )
    .toEqual([]);
  await firstWorkingThread
    .getByRole("button", { name: "Minimize thread" })
    .click();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await firstWorkingThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect(rail).toBeVisible();
  await expect(firstWorkingThread).toContainText(
    "Reviewing the shared feedback batch",
  );
  await firstWorkingThread
    .getByRole("button", { name: "Minimize thread" })
    .click();

  const beforeSource = await readFile(session.plan, "utf8");
  const afterSource = beforeSource
    .replace(
      "Keep every reviewer note safe while the plan is discussed.\n\n",
      "",
    )
    .replace(
      "Sending writes one real feedback package beside this plan.",
      "Sending atomically writes one real feedback package beside this plan.",
    );
  await writeFile(session.plan, afterSource, "utf8");
  const before = renderDocument({
    markdown: beforeSource,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const after = renderDocument({
    markdown: afterSource,
    fallbackTitle: "Review persistence",
    identity: {},
  });
  const locations = diffSnapshots({
    before: before.blocks,
    after: after.blocks,
  });
  const changedBlocks = new Set(
    locations.flatMap((location) =>
      location.newBlockId === undefined ? [] : [location.newBlockId],
    ),
  );
  const changeTarget = [...changedBlocks].at(-1);
  if (changeTarget === undefined) {
    throw new Error("The simulated rewrite produced no changed target");
  }
  const resultSnapshot = deriveSnapshotDigest(afterSource);
  await writeSnapshot({
    store,
    snapshot: resultSnapshot,
    source: afterSource,
  });
  const claimed = await claimAgentRequest({
    store,
    activeSessionId: session.sessionId,
    requestId: request.requestId,
    claimedBy: agentSessionId,
    baselineSnapshot: request.premiseSnapshot,
    now: new Date().toISOString(),
  });
  await commitRequestTerminal({
    claimedBy: agentSessionId,
    store,
    response: validateAgentResponseDraft({
      value: {
        requestId: request.requestId,
        outcomes: request.comments.map((comment) => ({
          commentId: comment.id,
          state: "changed",
          message: "Removed the ambiguous promise and tightened delivery.",
          changeTargets: [changeTarget],
        })),
      },
      request: claimed,
      commentsById: commentsFromExchange(exchange),
      changedBlocks,
      currentSnapshot: resultSnapshot,
      now: new Date().toISOString(),
    }),
    now: new Date().toISOString(),
  });

  await expect(kernel).toContainText("Changed");
  await expect
    .poll(() => page.locator('article [aria-label="Comment on slide"]').count())
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page
        .locator("article [data-review-block-button]")
        .evaluateAll((buttons) =>
          buttons.every((button) => button.isConnected),
        ),
    )
    .toBe(true);
  const sentThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Clarify the failure boundary." });
  const commentSearch = rail.getByPlaceholder("Search comments");
  await commentSearch.fill("Clarify the failure boundary");
  await expect(sentThread).toBeVisible();
  await expect(rail).not.toContainText("Name the operator recovery path.");
  await commentSearch.fill("no thread contains these words");
  await expect(rail).toContainText(
    "No comments match “no thread contains these words”.",
  );
  await commentSearch.fill("");
  await expect(sentThread.locator(".review-sent-target")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(sentThread.locator(".review-sent-target")).toHaveCSS(
    "padding-left",
    "2px",
  );
  await expect(sentThread.locator(".review-sent-target")).toHaveText(
    "1 · Details",
  );
  await expect(sentThread.locator(".review-sent-summary")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(sentThread.locator(".review-sent-metadata")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  await expect(sentThread.locator(".review-sent-time")).toHaveCSS(
    "font-size",
    "11px",
  );
  const compactReviewerStyle = await sentThread
    .locator(".review-sent-summary")
    .evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderRightColor: style.borderRightColor,
      };
    });
  await expect(
    sentThread.getByRole("button", { name: "Expand thread", exact: true }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Revert response" }),
  ).toBeVisible();
  await expect(
    sentThread.getByRole("button", { name: "Resolve thread" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 800, height: 1000 });
  await sentThread
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  await expect(sentThread.locator("[data-review-thread-scroll]")).toHaveCSS(
    "max-height",
    "480px",
  );
  await expect(sentThread.locator("[data-review-thread-scroll]")).toHaveCSS(
    "overflow-y",
    "auto",
  );
  expect(
    await sentThread
      .locator("[data-review-thread-scroll]")
      .evaluate(
        (node) => Math.ceil(node.scrollWidth) <= Math.ceil(node.clientWidth),
      ),
  ).toBe(true);
  expect(
    await sentThread.evaluate((thread) => {
      const sidebar = thread.closest("#big-plan-feedback-sidebar");
      if (sidebar === null) throw new Error("The feedback sidebar is missing");
      return (
        Math.ceil(thread.getBoundingClientRect().right) <=
        Math.ceil(sidebar.getBoundingClientRect().right)
      );
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const agentResponseParagraph = sentThread
    .locator(
      '[data-review-message="agent"] [data-review-message-body="structured"] p',
    )
    .first();
  await expect(agentResponseParagraph).toHaveCSS("line-height", "16px");
  await expect(agentResponseParagraph).toHaveCSS("margin-bottom", "8px");
  const expandedReviewer = sentThread
    .locator('[data-review-message="user"]')
    .first();
  await expect(expandedReviewer.locator("p")).toHaveCSS("font-size", "12px");
  expect(
    await expandedReviewer.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderRightColor: style.borderRightColor,
      };
    }),
  ).toEqual(compactReviewerStyle);
  await expect(kernel).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  const changedNextStepLabels = await sentThread
    .locator("[data-review-thread-next-steps] button")
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
  expect(changedNextStepLabels).toEqual([
    "Minimize thread",
    "Revert response",
    "Resolve thread",
  ]);
  await kernel.getByRole("button", { name: /Review change/u }).click();
  await expect(page.locator("[data-review-diff-lens]")).toContainText(
    "What changed",
  );
  await expect(page.locator("[data-review-diff-stepper]")).toContainText(
    "1 of",
  );
  await expect(kernel).toContainText("atomically");
  const closeReview = sentThread.getByRole("button", {
    name: "Exit review",
  });
  await expect(closeReview).toBeVisible();
  await closeReview.click();
  await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
  await sentThread.getByRole("button", { name: "Review change" }).click();
  await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
  const changeSetDock = page.locator("[data-review-diff-stepper]");
  await expect(changeSetDock).toContainText("Reviewing change set");
  await expect(changeSetDock).toContainText("Clarify the failure boundary.");
  await expect(
    changeSetDock.getByRole("group", { name: "Change display" }),
  ).toHaveCount(0);
  await sentThread
    .getByRole("button", { name: "Revert response" })
    .last()
    .click();
  const layeredRevertDialog = page.getByRole("alertdialog", {
    name: "Revert response?",
  });
  await expect(layeredRevertDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(layeredRevertDialog).toHaveCount(0);
  await expect(page.locator("[data-review-diff-stepper]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-review-diff-stepper]")).toHaveCount(0);
  const resolve = sentThread
    .getByRole("button", { name: "Resolve thread" })
    .first();
  const restingResolveBackground = await resolve.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  await resolve.hover();
  await expect
    .poll(() =>
      resolve.evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .not.toBe(restingResolveBackground);
  await expect(resolve).toHaveCSS("color", "rgb(22, 101, 52)");
  await sentThread
    .getByRole("button", { name: "Minimize thread" })
    .first()
    .click();

  await rail.getByRole("button", { name: "Close feedback" }).click();
  const contextualThread = page
    .locator("[data-review-thread-side] [data-review-sent-thread]")
    .filter({ hasText: "Clarify the failure boundary." });
  await expect(contextualThread).toContainText("Ready for review");
  await expect(contextualThread).toContainText("Clarify the failure boundary.");
  await expect(contextualThread.locator(".review-sent-target")).toHaveCount(0);
  const contextualActions = contextualThread.locator(":scope > div");
  await expect(contextualActions).toHaveCSS("opacity", "0");
  await contextualThread.hover();
  await expect(contextualThread).toHaveAttribute(
    "data-review-associated",
    "true",
  );
  // The note was left with "Comment on slide", so it addresses the slide. The
  // slide is what lights up; there is no passage inside it to highlight.
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-review-selection-active",
    "",
  );
  await expect(page.locator("[data-slide]").first()).toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await expect(contextualActions).toHaveCSS("opacity", "1");
  await contextualThread
    .getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    })
    .click();
  await expect
    .poll(() =>
      contextualThread.evaluate((card) => {
        const toolbar = card.querySelector(".review-thread-meta");
        if (!(toolbar instanceof HTMLElement)) return null;
        const cardRect = card.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        return {
          left: Math.round(toolbarRect.left - cardRect.left),
          right: Math.round(cardRect.right - toolbarRect.right),
          top: Math.round(toolbarRect.top - cardRect.top),
        };
      }),
    )
    .toEqual({ left: 1, right: 1, top: 1 });
  await contextualThread
    .getByRole("button", { name: "1 · Details", exact: true })
    .evaluate((button) => button.click());
  // The note was left with "Comment on slide", so it addresses the slide. The
  // slide is what lights up; there is no passage inside it to highlight.
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-review-selection-active",
    "",
  );
  await expect(page.locator("[data-slide]").first()).toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await contextualThread
    .getByRole("button", { name: "Resolve thread" })
    .first()
    .click();
  await expect(
    page.locator("[data-review-thread-side] [data-review-sent-thread]"),
  ).toHaveCount(2);

  await page.reload();
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(rail).toContainText("1 · Details");
  await expect(rail).not.toContainText(
    "Original target unavailable in this revision.",
  );

  const continuedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await continuedThread
    .getByRole("button", { name: "Expand thread", exact: true })
    .click();
  const continuedReply = continuedThread.getByPlaceholder(
    "Reply to the agent…",
  );
  await continuedReply.fill("Keep the recovery steps concise.");
  const replyButton = continuedThread.getByRole("button", { name: "Reply" });
  await replyButton.hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: /Reply ·/u }),
  ).toBeVisible();
  await replyButton.click();
  await continuedThread.getByRole("button", { name: "Cancel request" }).click();
  await expect(continuedThread).toContainText("Request canceled");
  await rail.getByRole("button", { name: "Close feedback" }).click();
  const canceledInline = page
    .locator("[data-review-thread-side] [data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await canceledInline
    .getByRole("button", { name: "1 · Details", exact: true })
    .click();
  await expect(
    canceledInline.getByRole("button", {
      name: "Expand comment: Name the operator recovery path.",
    }),
  ).toBeVisible();
  await canceledInline
    .getByRole("button", {
      name: "Expand comment: Name the operator recovery path.",
    })
    .click();
  await expect(
    canceledInline.getByRole("button", { name: "Delete canceled comment" }),
  ).toHaveCount(0);
  await expect(canceledInline).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  await stageComment(page, "Keep this draft while the runtime is offline.");
  await page.route("**/api/agent", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "not-json",
    }),
  );
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await expect(
    rail.getByText("Agent is unreachable", { exact: true }),
  ).toBeVisible({ timeout: 6_000 });
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
  await expect(
    rail.getByRole("img", { name: "Agent is unreachable" }),
  ).toBeVisible();
  await rail.getByRole("button", { name: "Delete staged comment" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete comment?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("button", { name: "Comment on slide" }).first().click();
  const offlineComposer = page.getByRole("dialog", { name: /Comment on/u });
  await offlineComposer
    .getByLabel("Add a comment")
    .fill("Keep this staged until the agent reconnects.");
  await offlineComposer
    .getByRole("switch", { name: "Submit right away" })
    .click();
  await expect(
    offlineComposer.getByRole("button", { name: "Submit Now" }),
  ).toBeDisabled();
  await expect(
    offlineComposer.getByRole("button", { name: "Agent disconnected" }),
  ).toBeVisible();
  await offlineComposer.getByRole("button", { name: "Cancel" }).click();
  await expect(rail).not.toContainText(
    "Connected to the local review runtime.",
  );
  await page.unroute("**/api/agent");
  const revertResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/revert-agent-changes") &&
      response.request().method() === "POST",
  );
  await continuedThread
    .getByRole("button", { name: "Revert response" })
    .click();
  const revertDialog = page.getByRole("alertdialog", {
    name: "Revert response?",
  });
  await expect(revertDialog).toContainText(
    "Earlier changes stay in place - this is not a reset to the original plan.",
  );
  await expect(revertDialog).toContainText(
    "The comment and thread will remain until you delete them.",
  );
  await revertDialog.getByRole("button", { name: "Revert response" }).click();
  expect((await revertResponse).status()).toBe(200);
  expect(await readFile(session.plan, "utf8")).toBe(beforeSource);
  // The revert refreshes the plan in place instead of reloading, so the
  // thread it was confirmed from stays open with its controls reachable.
  await expect(page.locator("article")).toContainText(
    "Keep every reviewer note safe while the plan is discussed.",
    { timeout: 15_000 },
  );
  await expect(
    continuedThread.getByPlaceholder("Reply to the agent…"),
  ).toBeVisible();
  await expect(
    continuedThread.getByRole("button", { name: "Response reverted" }).first(),
  ).toBeVisible();
  const revertedThread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: "Name the operator recovery path." });
  await revertedThread
    .getByRole("button", { name: "Delete comment" })
    .first()
    .click();
  const revertedDeleteDialog = page.getByRole("alertdialog", {
    name: "Delete comment?",
  });
  await expect(revertedDeleteDialog).toContainText(
    "The reverted plan changes stay reverted.",
  );
  await revertedDeleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(rail).not.toContainText("Name the operator recovery path.");
});

test("should preview stale, historical, and multi-place causal diffs through the real pipeline", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-diff-preview-"));
  const planPath = join(directory, "gallery.mdx");
  const before = await readFile(
    new URL("../examples/diff-gallery-before.mdx", import.meta.url),
    "utf8",
  );
  const after = (
    await readFile(
      new URL("./fixtures/causal-diff-gallery-after.mdx", import.meta.url),
      "utf8",
    )
  )
    .replace(
      /\| Where reviewers see it[\s\S]*?\n\n```ts/u,
      `| Where reviewers see it | Evidence shown | Snapshot that anchors it |
| ---------------------- | -------------- | ------------------------ |
| Feedback thread | Was/Now diff attributed to that feedback | Baseline to result |
| Plan-wide chat | Grouped change digest and guided tour | Latest result |
| Current plan | Current source plus historical diffs | Result to current |
| Feedback on an older plan version | Stale badge and premise-to-current diff | Premise to current |

\`\`\`ts`,
    )
    .replace(
      '<Callout type="note" title="Review note">\n\nVerify the causal boundary, the in-place lens, and the historical state.\n\n</Callout>',
      "> **Review note:** verify the causal boundary, the in-place lens, and the historical state.",
    )
    .split("\n<QuickSummary>")[0];
  await writeFile(planPath, after);
  const runtime = await startReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.waitForFunction(
      () => typeof window.bigPlan?.feedback?.add === "function",
    );
    const codeFigure = page.locator(".code-figure").last();
    await expect(
      codeFigure.getByRole("button", { name: /Comment on/u }),
    ).toBeVisible();
    await expect(
      codeFigure.getByRole("button", {
        name: "Comment on this code snippet",
      }),
    ).toHaveAttribute("data-tooltip", "Comment on this code snippet");
    await expect(codeFigure.locator("[data-review-toolbar-host]")).toHaveCSS(
      "opacity",
      "1",
    );
    const markdownTable = page.locator("[data-block-kind='table']").first();
    const markdownTableComment = markdownTable.locator(".review-table-comment");
    await markdownTable.locator("th, td").first().hover();
    await expect(markdownTableComment).toBeVisible();
    // The floating table comment stands alone, so it rests at the quieter
    // comment-rest colour rather than the control-bar muted colour.
    await expect(markdownTableComment).toHaveCSS("color", "rgb(138, 130, 116)");
    const tableCommentGeometry = await markdownTable.evaluate((table) => {
      const button = table.querySelector<HTMLElement>(".review-table-comment");
      if (button === null)
        throw new Error("The table comment control is missing");
      const tableRect = table.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return {
        bottom: Math.round(buttonRect.bottom),
        right: Math.round(buttonRect.right),
        tableRight: Math.round(tableRect.right),
        tableTop: Math.round(tableRect.top),
      };
    });
    expect(tableCommentGeometry.bottom).toBeLessThanOrEqual(
      tableCommentGeometry.tableTop,
    );
    expect(
      Math.abs(tableCommentGeometry.right - tableCommentGeometry.tableRight),
    ).toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        markdownTable.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    const codeChrome = await codeFigure.evaluate((figure) => {
      const body = figure.querySelector(":scope > pre");
      const controls = Array.from(
        figure.querySelectorAll<HTMLElement>(
          ".figure-control, .review-toolbar-comment",
        ),
      );
      if (!(body instanceof HTMLElement) || controls.length !== 3) {
        throw new Error("The causal preview code chrome was not rendered");
      }
      const bodyRect = body.getBoundingClientRect();
      const controlRects = controls.map((control) =>
        control.getBoundingClientRect(),
      );
      return {
        bodyRight: bodyRect.right,
        controlsRight: Math.max(...controlRects.map((rect) => rect.right)),
        controlRows: new Set(controlRects.map((rect) => Math.round(rect.top)))
          .size,
        labels: controls.map((control) => control.getAttribute("aria-label")),
        gaps: controlRects
          .slice(1)
          .map((rect, index) =>
            Math.round(rect.left - (controlRects[index]?.right ?? rect.left)),
          ),
      };
    });
    expect
      .soft(codeChrome.controlsRight)
      .toBeLessThanOrEqual(codeChrome.bodyRight);
    expect.soft(codeChrome.controlRows).toBe(1);
    expect(codeChrome.labels).toEqual([
      "Copy code",
      expect.stringMatching(/^Comment on /u),
      "Maximize code",
    ]);
    expect(codeChrome.gaps).toEqual([4, 4]);
    await expect(page.locator("[data-review-diff-preview]")).toHaveCount(0);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand staged comment:/u })
      .first()
      .click();
    await expect(rail).toContainText("Plan changed since this comment");
    await expect(rail).toContainText(
      "This compares the plan when you commented with the current plan.",
    );
    const originalPresentation = await page
      .locator("article > p[data-authored-prose]")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          color: style.color,
          borderBottomWidth: style.borderBottomWidth,
        };
      });
    const anchoredThread = page
      .locator("[data-review-thread-side] [data-review-sent-thread]")
      .first();
    await expect(anchoredThread).toBeVisible();
    let previousThreadPosition:
      { readonly left: number; readonly top: number } | undefined;
    let stableThreadPositionSamples = 0;
    await expect
      .poll(async () => {
        const current = await anchoredThread.evaluate((thread) => {
          const rect = thread.parentElement?.getBoundingClientRect();
          if (rect === undefined)
            throw new Error("The side thread host is missing");
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
        });
        if (
          previousThreadPosition?.left === current.left &&
          previousThreadPosition.top === current.top
        ) {
          stableThreadPositionSamples += 1;
        } else {
          stableThreadPositionSamples = 0;
        }
        previousThreadPosition = current;
        return stableThreadPositionSamples;
      })
      .toBeGreaterThanOrEqual(2);
    const threadPositionBeforeDiff = await anchoredThread.evaluate((thread) => {
      const rect = thread.parentElement?.getBoundingClientRect();
      if (rect === undefined)
        throw new Error("The side thread host is missing");
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    });
    await rail
      .getByRole("button", { name: "Review premise → current" })
      .click();
    await expect(page.locator("[data-review-diff-lens]")).toContainText(
      "What changed",
    );
    const staleThreadLink = page.getByRole("button", {
      name: "Open comment thread: Check this comment against its older premise.",
    });
    await expect(staleThreadLink).toHaveCount(1);
    await staleThreadLink.click();
    await expect(
      rail.locator(".review-staged-card[data-review-associated=true]"),
    ).toHaveCount(1);
    const singletonStepper = page.locator("[data-review-diff-stepper]");
    await expect(singletonStepper).toContainText("Reviewing change set");
    await expect(singletonStepper).toContainText("1 of 1");
    await expect(
      singletonStepper.getByRole("button", { name: "Previous change" }),
    ).toHaveCount(0);
    await expect(
      singletonStepper.getByRole("button", { name: "Next change" }),
    ).toHaveCount(0);
    await expect(
      singletonStepper.getByRole("group", { name: "Change display" }),
    ).toHaveCount(0);
    await singletonStepper
      .getByRole("button", { name: "Accept this change" })
      .click();
    const acceptedChange = rail.locator("[data-review-changes-accepted]");
    await expect(acceptedChange).toContainText("Change set accepted");
    await expect(
      singletonStepper.getByRole("button", { name: "Resolve thread" }),
    ).toBeVisible();
    await singletonStepper
      .getByRole("button", { name: "Back to review" })
      .click();
    await singletonStepper
      .getByRole("button", { name: "Undo acceptance for this change" })
      .click();
    await expect(acceptedChange).toHaveCount(0);
    await singletonStepper
      .getByRole("button", { name: "Accept this change" })
      .click();
    const diffLens = page.locator("[data-review-diff-lens]");
    await expect(diffLens.locator("ins")).toHaveCSS(
      "background-color",
      "rgb(222, 234, 215)",
    );
    const diffPresentation = diffLens.locator(
      '[data-review-diff-presentation="lede"]',
    );
    await expect(diffPresentation).toHaveCSS(
      "font-size",
      originalPresentation.fontSize,
    );
    await expect(diffPresentation).toHaveCSS(
      "line-height",
      originalPresentation.lineHeight,
    );
    await expect(diffPresentation).toHaveCSS(
      "color",
      originalPresentation.color,
    );
    await expect(diffPresentation).toHaveCSS(
      "border-bottom-width",
      originalPresentation.borderBottomWidth,
    );
    const readingWidths = await page.evaluate(() => {
      const lens = document.querySelector<HTMLElement>(
        "[data-review-diff-lens]",
      );
      const prose = Array.from(
        document.querySelectorAll<HTMLElement>("p[data-authored-prose]"),
      ).find((paragraph) => getComputedStyle(paragraph).display !== "none");
      if (lens === null || prose === undefined) {
        throw new Error("The diff lens and standard prose must both render");
      }
      return {
        lensWidth: Math.round(lens.getBoundingClientRect().width),
        lensMaxWidth: Math.round(
          Number.parseFloat(getComputedStyle(lens).maxWidth),
        ),
        proseMaxWidth: Math.round(
          Number.parseFloat(getComputedStyle(prose).maxWidth),
        ),
      };
    });
    expect(readingWidths.lensWidth).toBeLessThanOrEqual(
      readingWidths.lensMaxWidth,
    );
    expect(readingWidths.lensMaxWidth).toBe(readingWidths.proseMaxWidth);
    await expect
      .poll(() =>
        anchoredThread.evaluate((thread) => {
          const rect = thread.parentElement?.getBoundingClientRect();
          if (rect === undefined)
            throw new Error("The side thread host is missing");
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
        }),
      )
      .toEqual(threadPositionBeforeDiff);
    await expect
      .poll(() =>
        anchoredThread.evaluate((thread) => {
          const threadRect = thread.parentElement?.getBoundingClientRect();
          const slideRect = document
            .querySelector<HTMLElement>("[data-slide]")
            ?.getBoundingClientRect();
          if (threadRect === undefined || slideRect === undefined) {
            throw new Error("The thread and slide must both be measurable");
          }
          return threadRect.left >= slideRect.left + slideRect.width / 2;
        }),
      )
      .toBe(true);
    await singletonStepper
      .getByRole("button", { name: "Resolve thread" })
      .click();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-diff-stepper]")).toHaveCount(0);
    await rail.getByText("Resolved (1)").click();
    await rail.getByRole("button", { name: "Unresolve", exact: true }).click();

    await rail.getByRole("tab", { name: "Chat" }).click();
    const planWideDigest = rail.getByRole("button", {
      name: /\d+ changes across \d+ slides/u,
    });
    await expect(planWideDigest).toBeVisible();
    await planWideDigest.click();
    const deliverySection = rail
      .locator("[data-review-diff-section]")
      .filter({ hasText: "2 / Delivery contract" });
    await expect(deliverySection).toBeVisible();
    await expect(deliverySection.locator("svg")).toHaveCount(0);
    await rail.getByRole("button", { name: "Review change" }).click();
    const historicalChange = page
      .locator("main")
      .getByRole("region", { name: "Updated", exact: true });
    await expect(historicalChange).toContainText("Retired experiment");
    await expect(
      rail.getByRole("region", { name: "Updated", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("historical-change.png"),
    });
    await page.keyboard.press("Escape");

    const planWideChangeCount = Number.parseInt(
      (await planWideDigest.textContent()) ?? "0",
      10,
    );
    await rail
      .getByRole("button", { name: /Review changes \(\d+\)|Continue review/u })
      .click();
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      `1 of ${planWideChangeCount}`,
    );
    // The stepper floats clear of the viewport edge. This chat digest has no
    // thread handler, so it must not advertise a dead thread control.
    const stepperLayout = await page
      .locator("[data-review-diff-stepper]")
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return Math.round(document.documentElement.clientHeight - rect.bottom);
      });
    expect(stepperLayout).toBe(44);
    await expect(
      page.locator(
        '[data-review-diff-stepper] button[aria-label^="Open comment thread:"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Undo acceptance for this change",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next change" }).click();
    await page.getByRole("button", { name: "Accept this change" }).click();
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      `3 of ${planWideChangeCount}`,
    );
    await page.getByRole("button", { name: "Previous change" }).click();
    await expect(
      page.getByRole("button", {
        name: "Undo acceptance for this change",
      }),
    ).toBeVisible();
    await deliverySection
      .locator("..")
      .getByRole("button", { name: /Whole section/u })
      .click();
    const tableDiffLens = page.locator("[data-review-diff-lens]");
    await expect(tableDiffLens.locator("[data-review-diff-table]")).toHaveCount(
      2,
    );
    const tableDiffStructure = await tableDiffLens.evaluate((lens) => {
      const tables = Array.from(
        lens.querySelectorAll<HTMLElement>("[data-review-diff-table]"),
      );
      return {
        height: Math.round(lens.getBoundingClientRect().height),
        headerCount: (lens.textContent?.match(/Where reviewers see it/gu) ?? [])
          .length,
        rowCounts: tables.map(
          (table) => table.querySelectorAll("tbody > tr").length,
        ),
        overflowingTables: tables.filter(
          (table) => table.scrollWidth > table.clientWidth,
        ).length,
      };
    });
    expect(tableDiffStructure.height).toBeLessThan(1_000);
    expect(tableDiffStructure.headerCount).toBe(1);
    expect(tableDiffStructure.rowCounts).toEqual([3, 4]);
    expect(tableDiffStructure.overflowingTables).toBe(0);
    await expect(tableDiffLens).toContainText("Baseline to result");
    await expect(tableDiffLens).toContainText("Premise to current");
    await page.keyboard.press("Escape");
    await rail.getByRole("tab", { name: "Comments" }).click();
    await rail.getByRole("button", { name: "Mark addressed" }).click();
    await expect(rail.getByText("Resolved (1)")).toBeVisible();
    await rail.getByText("Resolved (1)").click();
    await expect(
      rail.getByRole("button", { name: "Unresolve thread" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await expect(rail.getByText("Resolved (1)")).toBeVisible();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep a Decision live and addressed while reviewing its change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-decision-diff-"));
  const planPath = join(directory, "decision.mdx");
  const before = `# Release plan

## Delivery choice

<Decision question="How should we ship this release?">

<Option title="Ship immediately" recommended>

<Consideration label="Safety" verdict="Risky" tone="bad">

There is no soak time.

</Consideration>

</Option>

<Option title="Wait one week">

<Consideration label="Safety" verdict="Strong" tone="good">

The release gets a full soak.

</Consideration>

</Option>

</Decision>`;
  const after = before.replace(
    "Ship immediately",
    "Ship after a one-day canary",
  );
  await writeFile(planPath, after);
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.waitForFunction(
      () => typeof window.bigPlan?.feedback?.add === "function",
    );
    const originalDecision = await page
      .locator('[data-block-kind="decision"]')
      .elementHandle();
    expect(originalDecision).not.toBeNull();
    const rail = page.getByRole("complementary", { name: "Feedback" });

    await test.step("open the Decision change in place", async () => {
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      await rail.getByRole("tab", { name: "Chat" }).click();
      await rail
        .getByRole("button", { name: /changes? across/u })
        .first()
        .click();
      await rail
        .getByRole("button", { name: /Review changes?(?: \(\d+\))?/u })
        .last()
        .click();

      const diff = page.locator("[data-component-diff]");
      await expect(diff).toBeVisible();
      await expect(diff).toContainText("How should we ship this release?");
      await expect(page.locator('[data-block-kind="decision"]')).toHaveCount(1);
      await expect(
        page.getByRole("button", {
          name: "Comment on How should we ship this release?",
        }),
      ).toBeVisible();
    });

    await test.step("use the real Decision controls without answering early", async () => {
      const diff = page.locator("[data-component-diff]");
      const proposed = diff.locator('[data-component-diff-side="proposed"]');
      const changeNote = proposed.locator("[data-decision-change-note]");
      await expect(changeNote).toBeVisible();
      expect(
        await changeNote.evaluate(
          (node) =>
            node.parentElement?.tagName === "FIGCAPTION" &&
            node.parentElement.parentElement?.firstElementChild ===
              node.parentElement &&
            node === node.parentElement.firstElementChild,
        ),
      ).toBe(true);
      const disclosure = proposed.locator("details").first();
      const disclosureTrigger = disclosure.locator("summary");
      await disclosureTrigger.click();
      await expect(disclosure).toHaveAttribute("open", "");
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.keyboard.press("Escape");
      await expect(disclosure).not.toHaveAttribute("open", "");
      await expect(diff).toBeVisible();

      await proposed
        .getByRole("radio", { name: /Ship after a one-day canary/u })
        .check();
      await expect(
        proposed.getByRole("button", { name: "Confirm choice" }),
      ).toBeDisabled();
      await expect(proposed).toContainText(
        "Accept this change before answering this decision.",
      );

      const sideToggle = diff.locator("[data-component-diff-toggle]");
      await diff.locator('[data-component-diff-choice="proposed"]').focus();
      await page.keyboard.press("ArrowLeft");
      await expect(
        diff.locator('[data-component-diff-choice="baseline"]'),
      ).toBeChecked();
      await expect(sideToggle).not.toHaveCSS("box-shadow", "none");
      await page.emulateMedia({ forcedColors: "active" });
      await expect(sideToggle).toHaveCSS("outline-style", "solid");
      await page.emulateMedia({ forcedColors: "none" });
      await page.keyboard.press("ArrowRight");

      await page.evaluate((original) => {
        const article = document.querySelector("article");
        if (article === null) throw new Error("Review article is missing");
        const refreshedArticle = article.cloneNode(true);
        const refreshedDecision = original.cloneNode(true);
        if (
          !(refreshedArticle instanceof HTMLElement) ||
          !(refreshedDecision instanceof HTMLElement)
        ) {
          throw new Error("Review article refresh could not be cloned");
        }
        refreshedDecision.dataset.refreshProof = "";
        const currentDiff = refreshedArticle.querySelector(
          "[data-component-diff]",
        );
        if (currentDiff === null) {
          throw new Error("Component diff is missing from refreshed article");
        }
        currentDiff.replaceWith(refreshedDecision);
        article.replaceWith(refreshedArticle);
        document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
      }, originalDecision);
      const reinstalled = page.locator('[data-component-diff-side="proposed"]');
      await expect(
        reinstalled.getByRole("button", { name: "Confirm choice" }),
      ).toBeDisabled();
      await reinstalled
        .getByRole("radio", { name: /Ship after a one-day canary/u })
        .check();

      await page.getByRole("button", { name: "Accept this change" }).click();
      await expect(
        reinstalled.getByRole("button", { name: "Confirm choice" }),
      ).toBeEnabled();
      await expect(
        reinstalled.getByText(
          "Accept this change before answering this decision.",
          { exact: true },
        ),
      ).toBeHidden();

      await diff.getByText("Was", { exact: true }).click();
      await expect(
        diff.locator('[data-component-diff-side="baseline"]'),
      ).toBeVisible();
      await diff.getByText("Now", { exact: true }).click();
      await expect(proposed).toBeVisible();
    });

    await test.step("restore the refreshed article root when review exits", async () => {
      await page.getByRole("button", { name: "Exit review" }).first().click();
      await expect(page.locator("[data-component-diff]")).toHaveCount(0);
      expect(await originalDecision?.evaluate((node) => node.isConnected)).toBe(
        false,
      );
      await expect(
        page.locator('[data-block-kind="decision"][data-refresh-proof]'),
      ).toHaveCount(1);
    });

    await test.step("archive a missing Decision without publishing its identity", async () => {
      await page
        .locator("article [data-block-id]")
        .evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
      await rail
        .getByRole("button", { name: /Review changes?(?: \(\d+\))?/u })
        .last()
        .click();
      const archive = page.locator("[data-review-historical-changes]");
      const historical = archive.locator("[data-review-diff-lens]");
      await expect(historical).toBeVisible();
      await expect(historical.locator("[data-block-id]")).toHaveCount(0);
      await expect(historical.locator("input").first()).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Comment on How should we ship this release?",
        }),
      ).toHaveCount(0);
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep component replacements inside their slide and preserve Callout presentation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-callout-diff-"));
  const planPath = join(directory, "gallery.mdx");
  const after = (
    await readFile(
      new URL("./fixtures/causal-diff-gallery-after.mdx", import.meta.url),
      "utf8",
    )
  ).split("\n## Delivery contract")[0];
  const before = after.replace(
    '<Callout type="note" title="Review note">\n\nVerify the causal boundary, the in-place lens, and the historical state.\n\n</Callout>',
    "> **Review note:** verify the causal boundary, the in-place lens, and the historical state.",
  );
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    const stepper = page.locator("[data-review-diff-stepper]");
    const total = Number.parseInt(
      (await stepper.textContent())?.match(/of (\d+)/u)?.[1] ?? "1",
      10,
    );
    for (let index = 1; index < total; index += 1) {
      if ((await lens.textContent())?.includes("Review note")) break;
      await page.getByRole("button", { name: "Next change" }).click();
    }
    await expect(lens).toContainText("Review note");
    expect(
      await lens.evaluate(
        (element) => element.closest("[data-slide]") !== null,
      ),
    ).toBe(true);
    const callout = lens.locator("[data-review-diff-callout]");
    await expect(callout).toHaveCount(1);
    await expect(callout.locator(".callout-title")).toHaveText("Review note");
    await expect(callout.locator(".callout-body")).toHaveText(
      "Verify the causal boundary, the in-place lens, and the historical state.",
    );
    await page.screenshot({
      path: testInfo.outputPath("callout-diff-in-slide.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should replay each side's callout kind and changed list ordering from its own snapshot", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Object.assign(window, { __bigPlanScrollBehaviors: [] });
    Element.prototype.scrollIntoView = function scrollIntoView(
      options?: boolean | ScrollIntoViewOptions,
    ): void {
      const behavior =
        typeof options === "object" && options !== null
          ? (options.behavior ?? "auto")
          : "auto";
      (
        window as unknown as { __bigPlanScrollBehaviors: Array<string> }
      ).__bigPlanScrollBehaviors.push(behavior);
      originalScrollIntoView.call(this, options);
    };
  });
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-presentation-diff-"),
  );
  const planPath = join(directory, "risks.mdx");
  const after = `# Rollout stakes

The rollout plan keeps its risk presentation honest across revisions.

## Risks and rollback

<Callout type="danger" title="Rollback risk">

Data loss stays possible until the backfill completes and the verification pass signs off.

</Callout>

## Runbook

- Freeze writes to the legacy table.
- Run the backfill twice.
`;
  // The before snapshot names the risk section differently, so no Was-side
  // block of that section still exists in the live document, and its runbook
  // section carries an ordered list the revision removes entirely. Sniffing
  // the live document for either side's facts can only guess.
  const before = `# Rollout stakes

The rollout plan keeps its risk presentation honest across revisions.

## Risks

<Callout type="danger" title="Rollback risk">

Data loss stays possible until the backfill completes.

</Callout>

## Runbook

The runbook stays inline for the first rollout.

1. Freeze writes to the legacy table.
2. Run the backfill twice.
`;
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await page.evaluate(() => {
      (
        window as unknown as { __bigPlanScrollBehaviors: Array<string> }
      ).__bigPlanScrollBehaviors = [];
    });
    await rail.getByRole("button", { name: "Review change" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __bigPlanScrollBehaviors: ReadonlyArray<string>;
              }
            ).__bigPlanScrollBehaviors,
        ),
      )
      .toEqual(expect.arrayContaining(["auto"]));
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              __bigPlanScrollBehaviors: ReadonlyArray<string>;
            }
          ).__bigPlanScrollBehaviors,
      ),
    ).not.toContain("smooth");
    const lens = page.locator("[data-review-diff-lens]");
    const stepper = page.locator("[data-review-diff-stepper]");
    const total = Number.parseInt(
      (await stepper.textContent())?.match(/of (\d+)/u)?.[1] ?? "1",
      10,
    );
    const stepTo = async (text: string): Promise<void> => {
      for (let index = 1; index < total; index += 1) {
        if ((await lens.textContent())?.includes(text)) break;
        await page.getByRole("button", { name: "Next change" }).click();
      }
      await expect(lens).toContainText(text);
    };

    await test.step("the changed danger callout is danger on both sides", async () => {
      await stepTo("Rollback risk");
      const callouts = lens.locator("[data-review-diff-callout]");
      await expect(callouts).toHaveCount(2);
      // The Was side must replay the recorded danger kind even though its
      // block no longer exists in the live document; a "note" misstates risk.
      await expect(callouts.nth(0)).toHaveAttribute("data-callout", "danger");
      await expect(callouts.nth(1)).toHaveAttribute("data-callout", "danger");
    });

    await test.step("the list order change shows both recorded presentations", async () => {
      await stepTo("Freeze writes");
      const ordered = lens.locator("ol");
      const unordered = lens.locator("ul");
      await expect(ordered).toHaveCount(1);
      await expect(ordered.locator("li")).toHaveCount(2);
      await expect(unordered).toHaveCount(1);
      await expect(unordered.locator("li")).toHaveCount(2);
    });
    await page.screenshot({
      path: testInfo.outputPath("per-side-presentation.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should colour the default component switch as a diff", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-component-diff-"));
  const planPath = join(directory, "decision.mdx");
  const after = await readFile(
    new URL("../examples/decision.mdx", import.meta.url),
    "utf8",
  );
  const before = after.replace(
    "The repository copy remains canonical either way.",
    "The repository copy stays canonical no matter which channel wins.",
  );
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const componentDiff = page.locator("[data-component-diff]");
    await expect(componentDiff).toHaveCount(1);
    const baseline = componentDiff.locator(
      '[data-component-diff-side="baseline"]',
    );
    const proposed = componentDiff.locator(
      '[data-component-diff-side="proposed"]',
    );
    const now = componentDiff.getByText("Now", { exact: true });
    const was = componentDiff.getByText("Was", { exact: true });
    const toggleThumb = componentDiff.locator(
      "[data-component-diff-toggle-thumb]",
    );

    await expect(proposed).toBeVisible();
    await expect(baseline).toBeHidden();
    const added = await now.evaluate((node) => ({
      color: getComputedStyle(node).color,
    }));
    const addedThumbBackground = await toggleThumb.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const addedBorder = await proposed.evaluate(
      (node) => getComputedStyle(node).borderTopColor,
    );
    expect(addedBorder).not.toBe(added.color);

    await was.click();
    await expect(baseline).toBeVisible();
    await expect(proposed).toBeHidden();
    const removed = await was.evaluate((node) => ({
      color: getComputedStyle(node).color,
    }));
    const removedThumbBackground = await toggleThumb.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    const removedBorder = await baseline.evaluate(
      (node) => getComputedStyle(node).borderTopColor,
    );
    expect(removedBorder).not.toBe(removed.color);

    // The two sides must not merely differ from the resting chrome; they must
    // differ from each other, which is what makes the switch read as a diff.
    // The toggle itself carries that difference on its sliding thumb rather
    // than on the button chrome, so both option labels stay readable and
    // clickable-looking in either state.
    expect(removed.color).not.toBe(added.color);
    expect(removedThumbBackground).not.toBe(addedThumbBackground);
    expect(removedBorder).not.toBe(addedBorder);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should show each initial screen when another wireframe screen changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-wireframe-root-diff-"),
  );
  const planPath = join(directory, "wireframe.mdx");
  const before = `# Wireframe root diff preview

<Wireframe id="queue-root" title="Review queue" initialScreen="queue">
<Screen id="queue" name="Queue" device="desktop">
<Panel title="Queue screen">
<Text text="The old initial screen remains visible in Was." />
</Panel>
</Screen>
<Screen id="detail" name="Detail" device="desktop">
<Panel title="Detail screen">
<Text text="The new initial screen remains visible in Now." />
</Panel>
</Screen>
<Screen id="audit" name="Audit" device="desktop">
<Panel title="Audit screen">
<Text text="Audit before" />
</Panel>
</Screen>
</Wireframe>
`;
  const after = before
    .replace('initialScreen="queue"', 'initialScreen="detail"')
    .replace("Audit before", "Audit after");
  await writeFile(planPath, after);
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const screenNavigation = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(
      screenNavigation.getByRole("button", {
        name: "Queue → Detail Initial screen",
      }),
    ).toBeVisible();
    const snapshot = page.locator("[data-review-component-snapshot]");
    const queueScreen = snapshot.locator('[data-wireframe-screen="queue"]');
    const detailScreen = snapshot.locator('[data-wireframe-screen="detail"]');
    await expect(detailScreen).toBeVisible();
    await expect(queueScreen).toBeHidden();
    await page.getByRole("button", { name: "Was" }).click();
    await expect(queueScreen).toBeVisible();
    await expect(detailScreen).toBeHidden();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should keep a surviving wireframe visible beside a removed snapshot", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-wireframe-removal-diff-"),
  );
  const planPath = join(directory, "wireframe.mdx");
  const removedWireframe = `<Wireframe id="removed" title="Removed prototype">
<Screen id="removed-screen" name="Removed" device="desktop">
<Panel title="Removed prototype content">
<Text text="This snapshot belongs only in Was." />
</Panel>
</Screen>
</Wireframe>`;
  const survivingWireframe = `<Wireframe id="survivor" title="Surviving prototype">
<Screen id="surviving-screen" name="Surviving" device="desktop">
<Panel title="Surviving prototype content">
<Text text="This live wireframe must remain beside the lens." />
</Panel>
</Screen>
</Wireframe>`;
  const before = `# Wireframe removal diff

${removedWireframe}

${survivingWireframe}
`;
  const after = `# Wireframe removal diff

${survivingWireframe}
`;
  await writeFile(planPath, after);
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    const survivor = page.locator('article [data-wireframe="survivor"]');
    await expect(survivor).toBeVisible();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();

    await expect(
      page.locator("[data-review-component-snapshot]"),
    ).toContainText("This snapshot belongs only in Was.");
    await expect(survivor).toBeVisible();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should not grow a screen switcher for a single-screen wireframe diff, and should match the non-diff switcher for a multi-screen one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-wireframe-switcher-"),
  );
  const planPath = join(directory, "wireframe.mdx");
  const singleScreen = (
    copy: string,
    screenId: string,
  ) => `<Wireframe id="queue" title="Review queue">
<Screen id="${screenId}" name="Failed payments" device="desktop">
<Panel title="Failed payments">
<Text text="${copy}" />
</Panel>
</Screen>
</Wireframe>`;
  const multiScreen = (
    copy: string,
  ) => `<Wireframe id="workspace" title="Plan review">
<Screen id="triage" name="Triage" device="desktop">
<Panel title="Triage queue">
<Text text="${copy}" />
</Panel>
</Screen>
<Screen id="archive" name="Archive" device="desktop">
<Panel title="Archive queue">
<Text text="Unchanged archive content" />
</Panel>
</Screen>
</Wireframe>`;
  const before = `# Wireframe switcher parity

## Single screen

${singleScreen("Original copy", "failed-payments")}

## Multiple screens

${multiScreen("Original triage copy")}
`;
  const after = `# Wireframe switcher parity

## Single screen

${singleScreen("Revised copy", "payment-failures")}

## Multiple screens

${multiScreen("Revised triage copy")}
`;
  await writeFile(planPath, after);
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  const rail = page.getByRole("complementary", { name: "Feedback" });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review changes" }).click();

    await test.step("a single-screen wireframe diff shows no screen switcher", async () => {
      const diffs = page.locator("[data-review-component-diff]");
      const singleDiff = diffs.filter({ hasText: "Failed payments" });
      await expect(singleDiff).toHaveCount(1);
      await expect(
        singleDiff.getByRole("navigation", { name: "Prototype screens" }),
      ).toHaveCount(0);
    });

    await test.step("a multi-screen wireframe diff's switcher matches the non-diff one", async () => {
      await rail.getByText("Triage queue").click();
      const diffs = page.locator("[data-review-component-diff]");
      const multiDiff = diffs.filter({ hasText: "Triage queue" });
      const switcher = multiDiff.getByRole("navigation", {
        name: "Prototype screens",
      });
      await expect(switcher).toBeVisible();
      const entry = switcher.getByRole("button", { name: /Triage/u });
      await expect(entry).toHaveClass(/wireframe-switch/);
      const style = await entry.evaluate((node) => {
        const cs = getComputedStyle(node);
        return {
          borderWidth: cs.borderWidth,
          borderRadius: cs.borderRadius,
          boxShadow: cs.boxShadow,
        };
      });
      // The non-diff switcher's own resting chrome, asserted directly rather
      // than duplicated as a second literal, so the two can never drift
      // silently apart.
      expect(style.borderWidth).toBe("2px");
      expect(style.borderRadius).toBe("6px");
      expect(style.boxShadow).not.toBe("none");
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should fit a wireframe component snapshot and keep its pastel diff edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-wireframe-diff-"));
  const planPath = join(directory, "wireframe.mdx");
  const overflowItems = Array.from(
    { length: 40 },
    (_, index) => `<ListItem label="Queue item ${index + 1}" />`,
  ).join("\n");
  const triageScreen = `<Screen id="triage" name="Triage" device="desktop">
<Panel title="Triage queue">
<Text text="Unchanged triage content" />
</Panel>
</Screen>`;
  const archiveScreen = `<Screen id="archive" name="Archive" device="desktop">
<Panel title="Archive queue">
<Text text="Unchanged archive content" />
</Panel>
</Screen>`;
  const changedWorkspace = `<Wireframe id="queue-diff" title="Review queue">
<Screen id="queue" name="Queue" device="desktop">
<AppShell>
<Sidebar brand="Big Plan" mode="Review" />
<AppContent>
<PageHeader title="Plan review" />
<Select label="Queue view" value="All threads" />
<Checkbox label="Include resolved threads" checked />
<Panel title="Threads">
<List>
<ListItem label="Keep the retry budget visible" selected />
${overflowItems}
</List>
</Panel>
</AppContent>
</AppShell>
</Screen>
<Screen id="retired" name="Retired" device="desktop">
<Panel title="Retired queue">
<Text text="Legacy queue content" />
</Panel>
</Screen>
${triageScreen}
${archiveScreen}
</Wireframe>`;
  const unrelatedWorkspace = `<Wireframe id="queue-diff" title="Unrelated prototype">
<Screen id="unrelated" name="Unrelated" device="desktop">
<Panel title="Unrelated prototype remains visible">
<Text text="This wireframe deliberately reuses the authored id." />
</Panel>
</Screen>
</Wireframe>`;
  const before = `# Wireframe diff preview

Review the queue change in context.

## Workspace

${changedWorkspace}

${unrelatedWorkspace}
`;
  const revisedWorkspace = changedWorkspace
    .replace(
      "Keep the retry budget visible",
      "Keep the rollback owner explicit",
    )
    .replace(
      `<Screen id="retired" name="Retired" device="desktop">
<Panel title="Retired queue">
<Text text="Legacy queue content" />
</Panel>
</Screen>`,
      `<Screen id="escalations" name="Escalations" device="desktop">
<Panel title="Escalation queue">
<Text text="New escalation queue content" />
</Panel>
</Screen>`,
    );
  const reorderedWorkspace = revisedWorkspace.replace(
    `${triageScreen}\n${archiveScreen}`,
    `${archiveScreen}\n${triageScreen}`,
  );
  const after = `# Wireframe diff preview

Review the queue change in context.

## Workspace

${unrelatedWorkspace}

${reorderedWorkspace}
`;
  await writeFile(planPath, after);
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  const wireframes = page.locator('article [data-wireframe="queue-diff"]');
  const isLiveWireframeVisible = async (): Promise<boolean> =>
    wireframes.evaluateAll((elements) => {
      const live = elements.find(
        (element) =>
          element.closest("[data-review-diff-lens-host]") === null &&
          element.textContent?.includes("Keep the rollback owner explicit"),
      );
      if (!(live instanceof HTMLElement)) return false;
      return getComputedStyle(live).display !== "none";
    });
  const unrelatedWireframe = wireframes.filter({
    hasText: "Unrelated prototype remains visible",
  });
  const rail = page.getByRole("complementary", { name: "Feedback" });
  const componentDiff = page.locator("[data-review-component-diff]");
  const snapshot = componentDiff.locator("[data-review-component-snapshot]");
  const now = componentDiff.getByRole("button", { name: "Now" });
  const was = componentDiff.getByRole("button", { name: "Was" });
  const screenNavigation = componentDiff.getByRole("navigation", {
    name: "Prototype screens",
  });
  const maximize = snapshot.getByRole("button", {
    name: "Maximize wireframe diff",
  });
  const snapshotBody = snapshot.locator(":scope > [data-figure-body]");
  // The pastel red/green diff edge belongs to the highlighted screen itself,
  // matching the non-diff view's own frame chrome at the outer snapshot
  // level: a second, thicker border there would compete with this one for
  // the reader's attention instead of carrying it.
  const highlightedScreen = snapshot.locator("[data-wireframe-screen]:visible");
  try {
    await test.step("open the changed wireframe without hiding its duplicate", async () => {
      await page.goto(runtime.url);
      await expect.poll(isLiveWireframeVisible).toBe(true);
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      await rail
        .getByRole("button", { name: /Expand thread:/u })
        .first()
        .click();
      await rail.getByRole("button", { name: "Review change" }).click();
      await expect.poll(isLiveWireframeVisible).toBe(false);
      await expect(unrelatedWireframe).toBeVisible();
      await expect(snapshot).toHaveAttribute(
        "data-review-component-snapshot",
        "new",
      );
      await expect(
        screenNavigation.getByRole("button", {
          name: "Archive Moved 4 → 3",
        }),
      ).toBeVisible();
      await expect(
        screenNavigation.getByRole("button", {
          name: "Triage Moved 3 → 4",
        }),
      ).toBeVisible();
    });

    await test.step("keep every diff control touchable on a narrow screen", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const touchTargets = [
        {
          name: "prototype screen",
          locator: screenNavigation.getByRole("button").first(),
        },
        { name: "Was", locator: was },
        { name: "Now", locator: now },
        { name: "maximize", locator: maximize },
      ];
      for (const target of touchTargets) {
        const box = await target.locator.boundingBox();
        if (box === null) {
          throw new Error(`${target.name} touch target must be measurable`);
        }
        expect(
          box.width,
          `${target.name} touch target width`,
        ).toBeGreaterThanOrEqual(44);
        expect(
          box.height,
          `${target.name} touch target height`,
        ).toBeGreaterThanOrEqual(44);
      }
      await page.setViewportSize({ width: 1600, height: 1000 });
    });

    await test.step("show hover feedback on both toggle options in every state and theme", async () => {
      const visualState = async (button: typeof was) =>
        button.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            backgroundColor: style.backgroundColor,
            color: style.color,
          };
        });
      const options = [was, now];
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((nextTheme) => {
          document.documentElement.setAttribute("data-theme", nextTheme);
        }, theme);
        for (const selected of options) {
          await selected.click();
          await page.mouse.move(0, 0);
          await expect(selected).toHaveAttribute("aria-pressed", "true");
          for (const option of options) {
            const resting = await visualState(option);
            await option.hover();
            await expect
              .poll(async () => {
                const hovered = await visualState(option);
                return (
                  hovered.backgroundColor !== resting.backgroundColor &&
                  hovered.color !== resting.color
                );
              })
              .toBe(true);
            await page.mouse.move(0, 0);
          }
        }
      }
    });

    await test.step("navigate added and removed prototype screens", async () => {
      await screenNavigation
        .getByRole("button", { name: "Escalations Added" })
        .click();
      await expect(was).toBeDisabled();
      await expect(now).toBeEnabled();
      await expect(now).toHaveAttribute("aria-pressed", "true");
      await expect(snapshot).toContainText("New escalation queue content");
      await expect(snapshot).not.toContainText("Legacy queue content");

      await screenNavigation
        .getByRole("button", { name: "Retired Removed" })
        .click();
      await expect(now).toBeDisabled();
      await expect(was).toBeEnabled();
      await expect(was).toHaveAttribute("aria-pressed", "true");
      await expect(snapshot).toHaveAttribute(
        "data-review-component-snapshot",
        "old",
      );
      await expect(snapshot).toContainText("Legacy queue content");
      await expect(snapshot).not.toContainText("New escalation queue content");
    });

    await test.step("maximize an accessible, fitted snapshot", async () => {
      await screenNavigation
        .getByRole("button", { name: "Queue Updated" })
        .click();
      await now.click();
      await expect(snapshot).toHaveCSS("border-top-width", "1px");
      await expect(highlightedScreen).toHaveCSS("border-top-width", "10px");
      await expect(maximize).toBeVisible();
      await page.setViewportSize({ width: 1600, height: 600 });
      await maximize.click();
      await expect(snapshot).toHaveAttribute("data-figure-maximized", "");
      await expect(snapshotBody).toHaveAttribute("tabindex", "0");
      expect(await snapshotBody.evaluate((node) => node.inert)).toBe(false);
      await expect(snapshotBody).toHaveCSS("pointer-events", "auto");
      const embeddedControl = snapshotBody.locator("button").first();
      await expect(embeddedControl).toHaveAttribute("tabindex", "-1");
      await expect(embeddedControl).toHaveAttribute("aria-disabled", "true");
      expect(
        await snapshotBody.getByLabel("Queue view").evaluate((control) => {
          return control instanceof HTMLSelectElement && control.disabled;
        }),
      ).toBe(true);
      expect(
        await snapshotBody
          .getByLabel("Include resolved threads")
          .evaluate((control) => {
            return control instanceof HTMLInputElement && control.disabled;
          }),
      ).toBe(true);
      // A maximized wireframe screen fits both axes by shrinking the whole
      // device frame - the reader opened it to see all of it at once - so a
      // 40-item list no longer forces the panel itself to scroll the way a
      // width-only fit once did; it shrinks the frame instead.
      await expect
        .poll(() =>
          highlightedScreen.evaluate(
            (node) => node.scrollHeight - node.clientHeight,
          ),
        )
        .toBeLessThanOrEqual(2);
      await expect(
        snapshot.getByRole("button", { name: "Restore wireframe diff size" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(snapshot).not.toHaveAttribute("data-figure-maximized");
      await expect(componentDiff).toHaveCount(1);
      await maximize.click();
      await snapshot
        .getByRole("button", { name: "Restore wireframe diff size" })
        .click();
      await expect(snapshot).not.toHaveAttribute("data-figure-maximized");
    });

    // A width-only fit passes a wide-and-tall viewport by coincidence - there
    // is room to spare on both axes, so nothing exposes a missing height
    // term. Wide-and-short is the shape that catches it: shrinking only the
    // viewport height must shrink the frame further, the same fit
    // test/wireframe.spec.ts already requires of the non-diff surface. This
    // once regressed silently because the diff lens fit only the width.
    await test.step("shrink the maximized frame by height, not just width", async () => {
      await maximize.click();
      await expect(snapshot).toHaveAttribute("data-figure-maximized", "");
      // The fit answers a size change from a ResizeObserver, which delivers
      // after the frame that lays the new size out, while maximizing and
      // setViewportSize both resolve as soon as the new size is applied. A
      // zoom sampled straight afterwards is therefore still the answer to
      // the previous geometry - which is how this comparison once read the
      // earlier 1600x600 step's zoom as the tall viewport's own and then
      // asked the short viewport to shrink below it. Reading across two
      // rendering frames puts the observer's answer in front of the sample.
      const readZoom = () =>
        highlightedScreen.evaluate(async (node) => {
          const nextFrame = (): Promise<void> =>
            new Promise((resolve) => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          await nextFrame();
          await nextFrame();
          const frame = node.querySelector<HTMLElement>(".wireframe-frame");
          return Number.parseFloat(frame?.style.zoom || "1");
        });
      // A sample is taken only once two of those reads agree, the way
      // test/wireframe.spec.ts settles the non-diff fit: the fit pins the
      // card to the width the frame paints at, and that write resizes an
      // observed element in turn, so one delivery can still schedule
      // another. Like that helper this waits for the value to stop moving
      // rather than for it to change, so a fit that wrongly answers both
      // viewports with the same zoom fails the comparison below instead of
      // timing out here.
      const readSettledZoom = async (): Promise<number> => {
        let lastZoom = Number.NaN;
        await expect
          .poll(async () => {
            const zoom = await readZoom();
            const settled = zoom > 0 && zoom === lastZoom;
            lastZoom = zoom;
            return settled;
          })
          .toBe(true);
        return lastZoom;
      };
      await page.setViewportSize({ width: 1855, height: 1200 });
      const tallZoom = await readSettledZoom();
      await page.setViewportSize({ width: 1855, height: 700 });
      const shortZoom = await readSettledZoom();
      expect(shortZoom).toBeLessThan(tallZoom);
      await expect
        .poll(() =>
          highlightedScreen.evaluate(
            (node) => node.scrollHeight - node.clientHeight,
          ),
        )
        .toBeLessThanOrEqual(2);
      expect(shortZoom).toBeGreaterThan(0);
      await page.keyboard.press("Escape");
      await expect(snapshot).not.toHaveAttribute("data-figure-maximized");
    });

    await test.step("preserve fitted pastel framing across sides and themes", async () => {
      const geometry = await snapshot.evaluate((node) => {
        const frame = node.querySelector<HTMLElement>(".wireframe-frame");
        const card = node.querySelector<HTMLElement>(".wireframe-frame-card");
        if (frame === null || card === null) return null;
        return {
          frameRight: frame.getBoundingClientRect().right,
          cardRight: card.getBoundingClientRect().right,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
        };
      });
      expect(geometry).not.toBeNull();
      expect(geometry?.frameRight).toBeLessThanOrEqual(
        (geometry?.cardRight ?? 0) + 0.5,
      );
      expect(geometry?.scrollWidth).toBe(geometry?.clientWidth);

      await was.click();
      await expect(snapshot).toHaveAttribute(
        "data-review-component-snapshot",
        "old",
      );
      await expect(snapshot).toHaveCSS("border-top-width", "1px");
      await expect(highlightedScreen).toHaveCSS("border-top-width", "10px");
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "dark");
      });
      await expect(snapshot).toHaveCSS("border-top-width", "1px");
      await expect(highlightedScreen).toHaveCSS("border-top-width", "10px");
      expect(
        await snapshot.evaluate(
          (node) => node.scrollWidth === node.clientWidth,
        ),
      ).toBe(true);
      await rail.getByRole("button", { name: "Exit review" }).click();
      await expect(componentDiff).toHaveCount(0);
      await expect.poll(isLiveWireframeVisible).toBe(true);
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should diff an HTTP endpoint at field level inside one rendering", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-endpoint-diff-"));
  const planPath = join(directory, "api.mdx");
  const after = await readFile(
    new URL("../examples/api-endpoints.mdx", import.meta.url),
    "utf8",
  );
  const before = after.replace(
    "Queues a deduplicated refresh job per cache key and returns immediately; the worker pool performs the refreshes asynchronously.",
    "Queues a refresh job per cache key and returns immediately.",
  );
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    // The endpoint's changed Description is one review stop, marked in place
    // within one field-level Was/Now comparison rather than two complete
    // component cards.
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      "1 of 1",
    );
    const field = lens.locator("[data-review-diff-field]");
    await expect(field).toHaveCount(2);
    await expect(field.first()).toContainText("Description");
    await expect(field.first()).toContainText(
      "Queues a refresh job per cache key and returns immediately.",
    );
    await expect(field.last()).toContainText("Description");
    await expect(field.last()).toContainText(
      "Queues a deduplicated refresh job per cache key and returns immediately; the worker pool performs the refreshes asynchronously.",
    );
    await expect(lens.locator("[data-review-component-diff]")).toHaveCount(0);
    // The untouched fields stay out of the lens instead of returning as the
    // old flattened component wall.
    await expect(lens).not.toContainText("X-Request-Id");
    await expect(lens).not.toContainText("Refresh queued");
    await page.screenshot({
      path: testInfo.outputPath("http-endpoint-field-diff.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should diff a database schema at column level inside one rendering", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-schema-diff-"));
  const planPath = join(directory, "schema.mdx");
  const after = await readFile(
    new URL("../examples/database-table-schema.mdx", import.meta.url),
    "utf8",
  );
  const before = after.replace(
    "seats        integer       [not null, default: 1, check: 'seats > 0']",
    "seats        smallint      [not null, default: 1, check: 'seats > 0']",
  );
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    // The retyped column is one review stop marked in place: the column's own
    // label in a field-level Was/Now comparison, and no complete schema
    // rendering to compare by eye.
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      "1 of 1",
    );
    const field = lens.locator("[data-review-diff-field]");
    await expect(field).toHaveCount(2);
    await expect(field.first()).toContainText("Column: seats");
    await expect(field.first()).toContainText("smallint");
    await expect(field.last()).toContainText("Column: seats");
    await expect(field.last()).toContainText("integer");
    await expect(lens.locator("[data-review-component-diff]")).toHaveCount(0);
    // The other columns did not change, so the schema root never claims the
    // change and their text stays out of the lens.
    await expect(lens).not.toContainText("customer_id");
    await page.screenshot({
      path: testInfo.outputPath("database-table-schema-field-diff.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should diff a quick summary at facet level with word runs", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-summary-diff-"));
  const planPath = join(directory, "summary.mdx");
  const after = await readFile(
    new URL("../examples/quick-summary.mdx", import.meta.url),
    "utf8",
  );
  const before = after.replace(
    "Record every attempt in the audit trail.",
    "Record attempts in the audit trail.",
  );
  await writeFile(planPath, after);
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startCompiledReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    // The component root and its changed facet are one review stop, and the
    // lens shows only the facet that changed: its term as a header and the
    // exact removed and inserted words in the body.
    await expect(page.locator("[data-review-diff-stepper]")).toContainText(
      "1 of 1",
    );
    const facet = lens.locator("[data-review-diff-field]");
    await expect(facet).toHaveCount(1);
    await expect(facet).toContainText("How");
    await expect(facet.locator("del")).toContainText("attempts");
    await expect(facet.locator("ins")).toContainText(["every", "attempt"]);
    // The other facets did not change, so their text stays out of the lens
    // instead of returning as the old flattened component wall.
    await expect(lens).not.toContainText("checkout to stay fast");
    await page.screenshot({
      path: testInfo.outputPath("quick-summary-facet-diff.png"),
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// The refresh journey needs one plan carrying every shell surface it asserts:
// a collapsible slide, a mermaid diagram, and a copyable code figure.
const REFRESH_REWIRE_MDX = `# Refresh rewire

## Flow

The flow explains the runtime.

<MermaidDiagram>

\`\`\`mermaid
flowchart LR
  source[Source] -->|ships| result((Result))
\`\`\`

Static SVG content remains readable with scripts disabled.

</MermaidDiagram>

## Delivery

\`\`\`ts
export const deliver = (): string => "package";
\`\`\`

Sending writes one real feedback package beside this plan.
`;

test("should keep shell interactions wired after an agent revision refreshes the plan in place", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // The copy assertion needs a deterministic clipboard in headless Chromium.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as typeof window & { __bigPlanCopiedCode?: string }
          ).__bigPlanCopiedCode = text;
        },
      },
    });
  });
  const directory = await mkdtemp(join(tmpdir(), "big-plan-refresh-rewire-"));
  const planPath = join(directory, "plan.mdx");
  const beforeSource = REFRESH_REWIRE_MDX;
  await writeFile(planPath, beforeSource, "utf8");
  // Use the built renderer here because Playwright's source transform wraps
  // JSX values; the shipped runtime is the authoritative component path.
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const { renderDocument: renderCompiledDocument } =
    await import("../dist/render/render-document.js");
  const runtime = await startCompiledReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const collapseToggle = page
      .locator("[data-slide]")
      .first()
      .locator("[data-collapse-toggle]")
      .first();
    await test.step("the shell is wired at load", async () => {
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "true");
      await collapseToggle.click();
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "false");
      await collapseToggle.click();
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "true");
    });

    await stageComment(page, "Tighten the delivery wording.");
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);
    await rail.getByRole("button", { name: "Close feedback" }).click();

    const session: unknown = await page.evaluate(async () => {
      const root = document.documentElement;
      const response = await fetch("/api/session", {
        headers: {
          "x-big-plan-review-token": root.dataset.reviewToken ?? "",
        },
      });
      return response.json();
    });
    if (
      typeof session !== "object" ||
      session === null ||
      !("sessionId" in session) ||
      !("planId" in session) ||
      !("plan" in session) ||
      typeof session.sessionId !== "string" ||
      typeof session.planId !== "string" ||
      typeof session.plan !== "string"
    ) {
      throw new Error("The refresh journey requires a live review session");
    }
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }

    const afterSource = beforeSource.replace(
      "Sending writes one real feedback package beside this plan.",
      "Sending atomically writes one real feedback package beside this plan.",
    );
    await writeFile(session.plan, afterSource, "utf8");
    const before = renderCompiledDocument({
      markdown: beforeSource,
      fallbackTitle: "Refresh rewire",
      identity: {},
    });
    const after = renderCompiledDocument({
      markdown: afterSource,
      fallbackTitle: "Refresh rewire",
      identity: {},
    });
    const locations = diffSnapshots({
      before: before.blocks,
      after: after.blocks,
    });
    const changedBlocks = new Set(
      locations.flatMap((location) =>
        location.newBlockId === undefined ? [] : [location.newBlockId],
      ),
    );
    const changeTarget = [...changedBlocks].at(-1);
    if (changeTarget === undefined) {
      throw new Error("The simulated revision produced no changed target");
    }
    const resultSnapshot = deriveSnapshotDigest(afterSource);
    await writeSnapshot({
      store,
      snapshot: resultSnapshot,
      source: afterSource,
    });
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: request.comments.map((comment) => ({
            commentId: comment.id,
            state: "changed",
            message: "Tightened the delivery wording.",
            changeTargets: [changeTarget],
          })),
        },
        request: claimed,
        commentsById: commentsFromExchange(exchange),
        changedBlocks,
        currentSnapshot: resultSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
    });

    await test.step("the revision refreshes the article in place", async () => {
      await expect(page.locator("article")).toContainText(
        "Sending atomically writes",
        { timeout: 15_000 },
      );
    });
    await test.step("a slide still collapses after the refresh", async () => {
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "true");
      await collapseToggle.click();
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "false");
      await collapseToggle.click();
      await expect(collapseToggle).toHaveAttribute("aria-expanded", "true");
    });
    await test.step("a diagram node still selects and offers actions", async () => {
      const diagram = page.locator("[data-flow-diagram]").first();
      const node = diagram.locator('[data-flow-node="source"]:visible').first();
      await node.click();
      await expect(node).toHaveAttribute("data-flow-selected", "");
      await expect(
        diagram.locator('[data-flow-action="comment"]'),
      ).toBeVisible();
    });
    await test.step("a copy control still responds", async () => {
      const copy = page.locator(".code-figure [data-copy-code]").first();
      await copy.click();
      await expect(copy).toHaveAttribute("data-copy-state", "copied");
      await expect(copy).toHaveAccessibleName("Copied code");
    });
    await test.step("a component comment reports its batch in the rail", async () => {
      const diagram = page.locator("[data-flow-diagram]").first();
      const node = diagram.locator('[data-flow-node="source"]:visible').first();
      await node.click();
      await diagram.locator('[data-flow-action="comment"]').click();
      await diagram
        .locator(".flow-diagram-compose textarea")
        .fill("Rename this node to Input.");
      await diagram
        .locator('.flow-diagram-compose button[data-variant="primary"]')
        .click();
      // The note joined the diagram's own batch, so a reviewer hunting for it
      // in the rail is told where it waits and where it is submitted from.
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      const batchNote = rail.locator("[data-review-component-batch-note]");
      await expect(batchNote).toContainText(
        "Comments on a diagram wait in that diagram's batch.",
      );
      await expect(batchNote).toContainText(
        "Add them to this review from the diagram's toolbar.",
      );
      await diagram
        .getByRole("button", { name: "Add 1 note to plan feedback" })
        .click();
      await expect(rail).toContainText("Diagram feedback:");
      await expect(rail).toContainText("Rename this node to Input.");
      await expect(batchNote).toHaveCount(0);
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should highlight only changed words inside a revised list", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-list-diff-"));
  const planPath = join(directory, "list.mdx");
  const before = `# List diff

## Promise

- Thread answers carry only the changes caused by that feedback.
- Chat answers carry a grouped, plan-wide change digest.
- Historical answers preserve their claim-time baseline and result snapshots.
- A guided tour moves through every changed place without losing context.
`;
  const after = before.replace(
    "Thread answers carry only the changes caused by that feedback.",
    "Thread answers carry only the changes caused by their own feedback.",
  );
  await writeFile(planPath, after);
  const runtime = await startReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await page
      .getByRole("complementary", { name: "Feedback" })
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await page.getByRole("button", { name: "Review change" }).click();
    const list = page
      .locator("[data-review-diff-lens] [data-review-diff-content]")
      .filter({ has: page.locator("li") });
    await expect(list.locator("li")).toHaveCount(4);
    await expect(list.locator("li").first().locator("del")).toBeVisible();
    await expect(
      list.locator("li").first().locator("ins").first(),
    ).toBeVisible();
    await expect(list.locator("li").nth(1).locator("del, ins")).toHaveCount(0);
    await expect(list.locator("li").nth(2).locator("del, ins")).toHaveCount(0);
    await expect(list.locator("li").nth(3).locator("del, ins")).toHaveCount(0);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should show both pictures when a change swaps one", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-picture-diff-"));
  const planPath = join(directory, "picture.mdx");
  const before = `# Picture diff

## Evidence

![Retry dashboard](${WIDE_PNG_DATA_URI})

The dashboard shows the retry backlog.
`;
  const after = before.replace(WIDE_PNG_DATA_URI, TALL_PNG_DATA_URI);
  await writeFile(planPath, after);
  const runtime = await startReviewRuntime({
    planPath,
    diffPreviewSource: before,
  });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    const pictureHost = page.locator("article [data-review-image-host]");
    await expect(pictureHost).toBeVisible();
    await page.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    // A picture carries no words, so a text-only lens would report the swap
    // with nothing to look at. Each side shows its own compiled picture.
    const pictures = lens.locator("[data-review-diff-content] img");
    await expect(pictures).toHaveCount(2);
    await expect(pictures.first()).toHaveAttribute("src", WIDE_PNG_DATA_URI);
    await expect(pictures.nth(1)).toHaveAttribute("src", TALL_PNG_DATA_URI);
    await expect(lens).toContainText("replaced");
    await expect(pictureHost).toBeHidden();
    // The lens replays a copy of the plan, so its picture never collects the
    // comment affordance that belongs to the picture in the article.
    await expect(lens.locator("[data-review-image-host]")).toHaveCount(0);
    await rail.getByRole("button", { name: "Exit review" }).click();
    await expect(lens).toHaveCount(0);
    await expect(pictureHost).toBeVisible();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test.describe("a picture the plan no longer holds", () => {
  // The browser reports the missing picture as a failed resource load, which
  // is the very condition this journey renders an answer for.
  test.use({
    allowedConsoleErrors: [/Failed to load resource:.*404/u],
  });

  test("should say when a pasted picture cannot be loaded", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.goto(reviewRuntimeUrl);
    // An upload the plan no longer holds: the reference is well formed, so the
    // reader has to be told what happened instead of shown an empty box.
    await stageComment(page, `![Capture](review-image:${"b".repeat(64)})`);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail
      .getByRole("button", { name: /Expand staged comment:.*review-image:/u })
      .click();
    const unavailable = rail.locator("[data-review-image-unavailable]");
    await expect(unavailable).toContainText("Image unavailable");
    await expect(rail.getByRole("img", { name: "Capture" })).toHaveCount(0);
    // The reason is available on demand rather than crowding the message, and
    // it names the possible causes instead of asserting one, because a single
    // load failure covers a stopped runtime as well as a missing picture.
    const reason = unavailable.getByText(/could not load/u);
    await expect(reason).toBeHidden();
    await unavailable.getByText("What happened").click();
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("runtime may be stopped");
  });
});

test("should turn diagram notes and decision proposals into review comments", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await page.waitForFunction(
    () => typeof window.bigPlan?.feedback?.add === "function",
  );
  await page.evaluate(() =>
    window.bigPlan?.feedback?.add({
      source: "flow-diagram",
      anchor: null,
      items: [{ kind: "comment", body: "Keep this source label explicit." }],
    }),
  );
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toContainText("Diagram feedback:");
  await expect(rail).toContainText("Keep this source label explicit.");

  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await page.evaluate(() =>
    window.bigPlan?.feedback?.add({
      source: "decision",
      anchor: null,
      submit: "now",
      items: [{ kind: "comment", body: "local journal." }],
    }),
  );
  expect((await sent).ok()).toBe(true);
  await expect(rail).toContainText("Decision options feedback:");
  await expect(rail).toContainText("local journal.");
});

test("should mark a superseded review as read-only and link to its replacement", async ({
  page,
  reviewRuntimeUrl,
}) => {
  let draftWrites = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/drafts") && request.method() === "PUT") {
      draftWrites += 1;
    }
  });
  await page.goto(reviewRuntimeUrl);
  const session = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("plan" in session) ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The review runtime did not identify its plan");
  }
  // Superseding a session that is still live is exactly what --takeover is
  // for; without it the runtime yields to the session this page is reading.
  const replacement = await startReviewRuntime({
    planPath: session.plan,
    takeover: true,
  });
  try {
    const readOnly = page.getByRole("button", {
      name: /Using read-only session/,
    });
    await expect(readOnly).toBeVisible();
    await readOnly.click();
    const rail = agentSidebar(page);
    await expect(agentStatusTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(rail).toContainText("This review was replaced");
    await expect(
      rail.getByRole("link", { name: "Open latest review" }),
    ).toHaveAttribute("href", replacement.url);
    expect(draftWrites).toBe(0);
  } finally {
    await replacement.close();
  }
});

// Block ids are structural paths, so an id minted for a superseded revision
// can still resolve in the current document while naming different content.
// The lens must detect that drift and fall back to the historical archive
// instead of rendering the change beside the wrong block.
test("should archive a superseded change whose block id now names different content", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-drifted-id-"));
  const planPath = join(directory, "plan.mdx");
  const initialSource = `# Drift plan

## Delivery

The delivery gate runs manual checks before merge.

## Verification

Reviewers confirm the output by hand.
`;
  const revisedSource = initialSource.replace(
    "The delivery gate runs manual checks before merge.",
    "The delivery gate runs automated checks before merge.",
  );
  const latestSource = initialSource.replace(
    "The delivery gate runs manual checks before merge.",
    "A canary rollout now guards every deploy instead of a gate.",
  );
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await stageComment(page, "Automate the delivery gate.");
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);
    await rail.getByRole("button", { name: "Close feedback" }).click();

    const session: unknown = await page.evaluate(async () => {
      const root = document.documentElement;
      const response = await fetch("/api/session", {
        headers: {
          "x-big-plan-review-token": root.dataset.reviewToken ?? "",
        },
      });
      return response.json();
    });
    if (
      typeof session !== "object" ||
      session === null ||
      !("sessionId" in session) ||
      !("planId" in session) ||
      !("plan" in session) ||
      typeof session.sessionId !== "string" ||
      typeof session.planId !== "string" ||
      typeof session.plan !== "string"
    ) {
      throw new Error("The drifted-id journey requires a live review session");
    }
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }

    const fallbackTitle = "Drift plan";
    const initialBlocks = renderDocument({
      markdown: initialSource,
      fallbackTitle,
      identity: {},
    }).blocks;
    const revisedBlocks = renderDocument({
      markdown: revisedSource,
      fallbackTitle,
      identity: {},
    }).blocks;
    const driftedBlockId = diffSnapshots({
      before: initialBlocks,
      after: revisedBlocks,
    }).find((location) => location.status === "changed")?.newBlockId;
    if (driftedBlockId === undefined) {
      throw new Error("The simulated revision produced no changed block");
    }
    const revisedSnapshot = deriveSnapshotDigest(revisedSource);
    const latestSnapshot = deriveSnapshotDigest(latestSource);
    await writeSnapshot({
      store,
      snapshot: revisedSnapshot,
      source: revisedSource,
    });
    await writeSnapshot({
      store,
      snapshot: latestSnapshot,
      source: latestSource,
    });

    await test.step("the agent answers the feedback, then revises the same block again", async () => {
      const answeredAt = new Date().toISOString();
      const claimed = await claimAgentRequest({
        store,
        activeSessionId: session.sessionId,
        requestId: request.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: request.premiseSnapshot,
        now: answeredAt,
      });
      await commitRequestTerminal({
        claimedBy: agentSessionId,
        store,
        response: validateAgentResponseDraft({
          value: {
            requestId: request.requestId,
            outcomes: request.comments.map((comment) => ({
              commentId: comment.id,
              state: "changed",
              message: "Automated the delivery gate.",
              changeTargets: [driftedBlockId],
            })),
          },
          request: claimed,
          commentsById: commentsFromExchange(exchange),
          changedBlocks: new Set([driftedBlockId]),
          currentSnapshot: revisedSnapshot,
          now: answeredAt,
        }),
        now: answeredAt,
      });
      await writeFile(session.plan, latestSource, "utf8");
      const revisedAgainAt = new Date(Date.parse(answeredAt) + 1).toISOString();
      const followUp = messageAgentRequest({
        kind: "chat",
        requestId: randomBytes(8).toString("hex"),
        sessionId: session.sessionId,
        planId: session.planId,
        premiseSnapshot: revisedSnapshot,
        createdAt: revisedAgainAt,
        body: "Replace the gate with a canary rollout.",
      });
      await writeAgentRequest({ store, request: followUp });
      const claimedFollowUp = await claimAgentRequest({
        store,
        activeSessionId: session.sessionId,
        requestId: followUp.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: revisedSnapshot,
        now: revisedAgainAt,
      });
      await commitRequestTerminal({
        claimedBy: agentSessionId,
        store,
        response: validateAgentResponseDraft({
          value: {
            requestId: followUp.requestId,
            message: "The canary rollout replaces the delivery gate.",
          },
          request: claimedFollowUp,
          commentsById: new Map(),
          changedBlocks: new Set(),
          currentSnapshot: latestSnapshot,
          now: revisedAgainAt,
        }),
        now: revisedAgainAt,
      });
    });

    const drifted = page.locator(`[data-block-id="${driftedBlockId}"]`);
    await test.step("the displayed plan keeps the id with different content", async () => {
      await expect(page.locator("article")).toContainText(
        "A canary rollout now guards every deploy",
        { timeout: 15_000 },
      );
      await expect(drifted).toContainText("A canary rollout now guards");
    });

    await test.step("reviewing the superseded change lands in the archive, not beside the drifted block", async () => {
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      await rail
        .getByRole("button", { name: /Expand thread:/u })
        .first()
        .click();
      await rail.getByRole("button", { name: "Review change" }).click();
      const archive = page.locator("[data-review-historical-changes]");
      await expect(archive).toHaveCount(1);
      const lens = archive.locator("[data-review-diff-lens]");
      await expect(lens).toContainText("Updated");
      await expect(lens).toContainText("checks before merge");
      await expect(lens.locator("ins")).toContainText("automated");
      // Every lens host must be the archive's own; none may sit beside the
      // block whose id the superseded diff can still resolve.
      await expect(
        page.locator(
          "[data-review-diff-lens-host]:not([data-review-historical-diff])",
        ),
      ).toHaveCount(0);
      await expect(drifted).toBeVisible();
      const placement = await page.evaluate(() => {
        const archiveElement = document.querySelector(
          "[data-review-historical-changes]",
        );
        const slides = document.querySelectorAll("[data-slide]");
        const lastSlide = slides.item(slides.length - 1);
        if (archiveElement === null || lastSlide === null) return null;
        return {
          isAfterLastSlide:
            (lastSlide.compareDocumentPosition(archiveElement) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
          isOutsideSlides: archiveElement.closest("[data-slide]") === null,
        };
      });
      expect(placement).toEqual({
        isAfterLastSlide: true,
        isOutsideSlides: true,
      });
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should maximize a historical component when the current plan has no slides", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(
    join(tmpdir(), "big-plan-historical-component-"),
  );
  const planPath = join(directory, "plan.mdx");
  const initialSource = `# Historical component plan

<Slide type="desired-experience" />

## Prototype

<Wireframe id="historical" title="Historical prototype">
<Screen id="queue" name="Queue" device="desktop">
<Panel title="Manual queue">
<Text text="Review the queue manually." />
</Panel>
</Screen>
</Wireframe>
`;
  const revisedSource = initialSource
    .replace("Manual queue", "Automated queue")
    .replace("Review the queue manually.", "Review the queue automatically.");
  const latestSource = `# Historical component plan

The current plan contains no slides.
`;
  await writeFile(planPath, initialSource, "utf8");
  const { startReviewRuntime: startCompiledReviewRuntime } =
    await import("../dist/review/server.js");
  const { renderDocument: renderCompiledDocument } =
    await import("../dist/render/render-document.js");
  const runtime = await startCompiledReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await stageComment(page, "Automate the prototype queue.");
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);
    await rail.getByRole("button", { name: "Close feedback" }).click();

    const session: unknown = await page.evaluate(async () => {
      const root = document.documentElement;
      const response = await fetch("/api/session", {
        headers: {
          "x-big-plan-review-token": root.dataset.reviewToken ?? "",
        },
      });
      return response.json();
    });
    if (
      typeof session !== "object" ||
      session === null ||
      !("sessionId" in session) ||
      !("planId" in session) ||
      !("plan" in session) ||
      typeof session.sessionId !== "string" ||
      typeof session.planId !== "string" ||
      typeof session.plan !== "string"
    ) {
      throw new Error("The historical component journey requires a session");
    }
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create component feedback work");
    }
    const initialBlocks = renderCompiledDocument({
      markdown: initialSource,
      fallbackTitle: "Historical component plan",
      identity: {},
    }).blocks;
    const revisedBlocks = renderCompiledDocument({
      markdown: revisedSource,
      fallbackTitle: "Historical component plan",
      identity: {},
    }).blocks;
    const changedBlockId = diffSnapshots({
      before: initialBlocks,
      after: revisedBlocks,
    }).find(
      (location) =>
        location.status === "changed" && location.kind === "wireframe",
    )?.newBlockId;
    if (changedBlockId === undefined) {
      throw new Error("The simulated revision produced no wireframe change");
    }
    const revisedSnapshot = deriveSnapshotDigest(revisedSource);
    const latestSnapshot = deriveSnapshotDigest(latestSource);
    await writeSnapshot({
      store,
      snapshot: revisedSnapshot,
      source: revisedSource,
    });
    await writeSnapshot({
      store,
      snapshot: latestSnapshot,
      source: latestSource,
    });
    const answeredAt = new Date().toISOString();
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: answeredAt,
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: request.comments.map((comment) => ({
            commentId: comment.id,
            state: "changed",
            message: "Automated the prototype queue.",
            changeTargets: [changedBlockId],
          })),
        },
        request: claimed,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set([changedBlockId]),
        currentSnapshot: revisedSnapshot,
        now: answeredAt,
      }),
      now: answeredAt,
    });
    await writeFile(session.plan, latestSource, "utf8");
    const revisedAgainAt = new Date(Date.parse(answeredAt) + 1).toISOString();
    const followUp = messageAgentRequest({
      kind: "chat",
      requestId: randomBytes(8).toString("hex"),
      sessionId: session.sessionId,
      planId: session.planId,
      premiseSnapshot: revisedSnapshot,
      createdAt: revisedAgainAt,
      body: "Remove the historical prototype.",
    });
    await writeAgentRequest({ store, request: followUp });
    const claimedFollowUp = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: followUp.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: revisedSnapshot,
      now: revisedAgainAt,
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: followUp.requestId,
          message: "The current plan no longer contains the prototype.",
        },
        request: claimedFollowUp,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: latestSnapshot,
        now: revisedAgainAt,
      }),
      now: revisedAgainAt,
    });

    await expect(page.locator("article")).toContainText(
      "The current plan contains no slides.",
      { timeout: 15_000 },
    );
    await expect(page.locator("article [data-slide]")).toHaveCount(0);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    await rail.getByRole("button", { name: "Review change" }).click();
    const archive = page.locator("[data-review-historical-changes]");
    const snapshot = archive.locator("[data-review-component-snapshot]");
    await expect(archive).toHaveCount(1);
    await expect(snapshot).toContainText("Automated queue");
    expect(
      await archive.evaluate((element) => element.closest("article") !== null),
    ).toBe(true);
    await snapshot
      .getByRole("button", { name: "Maximize wireframe diff" })
      .click();
    await expect(snapshot).toHaveAttribute("data-figure-maximized", "");
    await expect(snapshot).toHaveCSS("position", "fixed");
    await snapshot
      .getByRole("button", { name: "Restore wireframe diff size" })
      .click();
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should leave shell interactions wired exactly once after repeated re-wires", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const toggle = page
    .locator('[data-collapsible="slide"]')
    .first()
    .locator(":scope > [data-collapse-header] > [data-collapse-toggle]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // Re-wiring is announced, not counted, so the shell has to tolerate an
  // announcement for an article it has already wired. A second listener on an
  // already-wired node would handle one click twice and cancel itself out.
  await page.evaluate(() => {
    for (let index = 0; index < 4; index += 1) {
      document.dispatchEvent(new CustomEvent("bigplan:article-replaced"));
    }
  });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

/** Reads the live session the runtime handed the page, or fails the journey. */
const liveReviewSession = async (
  page: Page,
): Promise<{
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
}> => {
  const session: unknown = await page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/session", {
      headers: { "x-big-plan-review-token": root.dataset.reviewToken ?? "" },
    });
    return response.json();
  });
  if (
    typeof session !== "object" ||
    session === null ||
    !("sessionId" in session) ||
    !("planId" in session) ||
    !("plan" in session) ||
    typeof session.sessionId !== "string" ||
    typeof session.planId !== "string" ||
    typeof session.plan !== "string"
  ) {
    throw new Error("The journey requires a live review session");
  }
  return {
    sessionId: session.sessionId,
    planId: session.planId,
    plan: session.plan,
  };
};

test("should keep a composing comment on its displayed premise through a plan refresh", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-compose-refresh-"));
  const planPath = join(directory, "plan.mdx");
  const initialSource = `# Compose refresh

## Delivery

The delivery gate runs manual checks before merge.

## Rollout

The rollout waits for a green build.
`;
  const revisedSource = initialSource.replace(
    "The rollout waits for a green build.",
    "The rollout waits for a green build and a signed release.",
  );
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  let releaseRefresh = (): void => undefined;
  try {
    await page.goto(runtime.url);
    const session = await liveReviewSession(page);
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const premiseSnapshot = deriveSnapshotDigest(initialSource);
    const revisedSnapshot = deriveSnapshotDigest(revisedSource);
    const request = messageAgentRequest({
      kind: "chat",
      requestId: randomBytes(8).toString("hex"),
      sessionId: session.sessionId,
      planId: session.planId,
      premiseSnapshot,
      createdAt: new Date().toISOString(),
      body: "Require a signed release before rollout.",
    });
    await writeAgentRequest({ store, request });

    await page
      .getByRole("button", { name: "Comment on slide" })
      .first()
      .click();
    const composer = page.getByRole("dialog", { name: /Comment on/u });
    const submitRightAway = composer.getByRole("switch", {
      name: "Submit right away",
    });
    if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
      await submitRightAway.click();
    }
    const commentBody = "Keep the delivery premise visible.";
    await composer.getByLabel("Add a comment").fill(commentBody);

    let markRefreshStarted = (): void => undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    const refreshReleased = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let hasBlockedRefresh = false;
    await page.route("**/*", async (route) => {
      const response = await route.fetch();
      const body = await response.body();
      const isRevisedArticle =
        !hasBlockedRefresh &&
        body.includes(Buffer.from("signed release")) &&
        body.includes(Buffer.from("<article"));
      if (isRevisedArticle) {
        hasBlockedRefresh = true;
        markRefreshStarted();
        await refreshReleased;
      }
      await route.fulfill({ response, body });
    });

    await writeSnapshot({
      store,
      snapshot: revisedSnapshot,
      source: revisedSource,
    });
    await writeFile(session.plan, revisedSource, "utf8");
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          message: "The rollout now waits for a signed release.",
        },
        request: claimed,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: revisedSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
    });

    await refreshStarted;
    const persistedDraft = page.waitForRequest(
      (candidate) =>
        candidate.url().endsWith("/api/drafts") &&
        candidate.method() === "PUT" &&
        candidate.postData()?.includes(commentBody) === true,
    );
    await composer.getByRole("button", { name: "Add Comment" }).click();
    const draftPayload: unknown = (await persistedDraft).postDataJSON();
    releaseRefresh();
    await expect(page.locator("article")).toContainText("signed release", {
      timeout: 15_000,
    });
    expect(draftPayload).toMatchObject({
      drafts: [
        expect.objectContaining({
          body: commentBody,
          premiseSnapshot,
        }),
      ],
    });

    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    await page
      .getByRole("button", {
        name: `Expand staged comment: ${commentBody}`,
      })
      .click();
    const stagedComment = page
      .locator(".review-staged-card")
      .filter({ hasText: commentBody });
    await expect(stagedComment).toContainText(
      "Plan changed since this comment",
    );
  } finally {
    releaseRefresh();
    await page.unroute("**/*");
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Counts the persistent selection highlights and how many of them still cover
 * text in the displayed plan. Removing a node collapses the ranges that held
 * it onto its parent rather than dropping them, so a registry left over from a
 * discarded article stays registered with empty ranges and paints nothing;
 * only a range that still spans text inside the live article is a highlight
 * the reader can see.
 */
const liveSelectionHighlights = async (
  page: Page,
): Promise<{ readonly total: number; readonly inLivePlan: number }> =>
  page.evaluate(() => {
    const registry = (
      CSS as unknown as {
        highlights?: { get(name: string): Iterable<Range> | undefined };
      }
    ).highlights;
    const highlight = registry?.get("big-plan-review-selection");
    const ranges = highlight === undefined ? [] : Array.from(highlight);
    const article = document.querySelector("article");
    return {
      total: ranges.length,
      inLivePlan: ranges.filter(
        (range) =>
          range.toString().trim() !== "" &&
          article?.contains(range.startContainer) === true,
      ).length,
    };
  });

// A digest entry names the slide it will take the reader to, so "a lens is
// visible" is not the promise being made: the lens must land in the slide the
// entry's own header names. A resolver that anchors a plausible-looking
// neighbour keeps every lens assertion green, so this journey compares the
// header the digest rendered with the kicker of the slide the lens reached.
const DIGEST_KICKER_MDX = `# Change digest

## Delivery

The delivery gate runs manual checks before merge.

## Verification

Reviewers confirm the output by hand.
`;

test("should open a digest entry in the slide its section header names", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-digest-kicker-"));
  const planPath = join(directory, "plan.mdx");
  const initialSource = DIGEST_KICKER_MDX;
  const revisedSource = initialSource
    .replace(
      "The delivery gate runs manual checks before merge.",
      "The delivery gate runs automated checks before merge.",
    )
    .replace(
      "Reviewers confirm the output by hand.",
      "Reviewers confirm the output from the recorded run.",
    );
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await stageComment(page, "Automate both checks.");
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);

    const session = await liveReviewSession(page);
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }
    const fallbackTitle = "Change digest";
    const changedBlockIds = diffSnapshots({
      before: renderDocument({
        markdown: initialSource,
        fallbackTitle,
        identity: {},
      }).blocks,
      after: renderDocument({
        markdown: revisedSource,
        fallbackTitle,
        identity: {},
      }).blocks,
    }).flatMap((location) =>
      location.status === "changed" && location.newBlockId !== undefined
        ? [location.newBlockId]
        : [],
    );
    expect(changedBlockIds.length).toBeGreaterThanOrEqual(2);
    const revisedSnapshot = deriveSnapshotDigest(revisedSource);
    await writeSnapshot({
      store,
      snapshot: revisedSnapshot,
      source: revisedSource,
    });
    await writeFile(session.plan, revisedSource, "utf8");
    const answeredAt = new Date().toISOString();
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: answeredAt,
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: request.comments.map((comment) => ({
            commentId: comment.id,
            state: "changed",
            message: "Automated both checks.",
            changeTargets: changedBlockIds,
          })),
        },
        request: claimed,
        commentsById: commentsFromExchange(exchange),
        changedBlocks: new Set(changedBlockIds),
        currentSnapshot: revisedSnapshot,
        now: answeredAt,
      }),
      now: answeredAt,
    });

    await expect(page.locator("article")).toContainText(
      "from the recorded run",
      { timeout: 15_000 },
    );
    await rail
      .getByRole("button", { name: /Expand thread:/u })
      .first()
      .click();
    const sections = rail.locator("[data-review-diff-section]");
    await expect(sections).toHaveCount(2, { timeout: 15_000 });
    const header = sections.nth(1);
    const headerLabel = (
      await header.locator("span").first().textContent()
    )?.trim();
    expect(headerLabel).not.toBe("");
    const entry = header.locator("xpath=following-sibling::button[1]");
    await entry.click();

    const lens = page.locator(
      "[data-review-diff-lens-host]:not([data-review-historical-diff]) [data-review-diff-lens]",
    );
    await expect(lens).toHaveCount(1);
    // The slide the reader actually arrived in must be the slide the entry's
    // header named, not merely some slide.
    const arrivedKicker = await lens.evaluate(
      (element) =>
        element
          .closest("[data-slide]")
          ?.querySelector("[data-slide-kicker]")
          ?.textContent?.trim() ?? null,
    );
    expect(arrivedKicker).toBe(headerLabel);
    await expect(entry).toHaveAttribute("aria-current", "step");
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should jump to the visible lens standing in for a hidden commented block", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-hidden-jump-"));
  const planPath = join(directory, "plan.mdx");
  const lowerContent = Array.from(
    { length: 24 },
    (_, index) => `Checkpoint ${index + 1} keeps the page below the lens.`,
  ).join("\n\n");
  const initialSource = `# Hidden jump

## Delivery

~~~ts
const deliveryBoundary = "original";
~~~

## Verification

The verification section keeps the page tall enough to scroll.

## Rollout

The rollout section gives the reader more content below the commented block.

## Operations

The operations section remains below the review lens.

${lowerContent}
`;
  const revisedSource = initialSource.replace(
    'const deliveryBoundary = "original";',
    'const deliveryBoundary = "revised";',
  );
  const commentBody = "Keep the delivery boundary precise.";
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.waitForFunction(
      () => typeof window.bigPlan?.feedback?.add === "function",
    );
    const target = page.locator(".code-figure").first();
    await target
      .getByRole("button", {
        name: "Comment on this code snippet",
      })
      .click();
    const composer = page.getByRole("dialog", { name: /Comment on/ });
    const submitRightAway = composer.getByRole("switch", {
      name: "Submit right away",
    });
    if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
      await submitRightAway.click();
    }
    await composer.getByLabel("Add a comment").fill(commentBody);
    await composer.getByRole("button", { name: "Add Comment" }).click();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);

    const session = await liveReviewSession(page);
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }
    const comment = request.comments.find(
      (entry) => entry.body === commentBody,
    );
    if (comment === undefined || comment.target.type !== "block") {
      throw new Error("The paragraph comment did not retain a block target");
    }
    const before = renderDocument({
      markdown: initialSource,
      fallbackTitle: "Hidden jump",
      identity: {},
    });
    const after = renderDocument({
      markdown: revisedSource,
      fallbackTitle: "Hidden jump",
      identity: {},
    });
    const locations = diffSnapshots({
      before: before.blocks,
      after: after.blocks,
    });
    const changedBlocks = new Set(
      locations.flatMap((location) =>
        location.newBlockId === undefined ? [] : [location.newBlockId],
      ),
    );
    expect(changedBlocks).toContain(comment.target.blockId);
    const resultSnapshot = deriveSnapshotDigest(revisedSource);
    await writeSnapshot({
      store,
      snapshot: resultSnapshot,
      source: revisedSource,
    });
    await writeFile(session.plan, revisedSource, "utf8");
    const claimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: request.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: request.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: request.requestId,
          outcomes: request.comments.map((entry) => ({
            commentId: entry.id,
            state: "changed",
            message: "Kept the delivery boundary precise.",
            changeTargets: [comment.target.blockId],
          })),
        },
        request: claimed,
        commentsById: commentsFromExchange(exchange),
        changedBlocks,
        currentSnapshot: resultSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
    });

    await expect(page.locator("article")).toContainText(
      'const deliveryBoundary = "revised";',
      { timeout: 15_000 },
    );
    const sentThread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: commentBody });
    await sentThread
      .getByRole("button", { name: "Expand thread", exact: true })
      .click();
    await sentThread.getByRole("button", { name: "Review change" }).click();
    const lens = page.locator("[data-review-diff-lens]");
    await expect(lens).toBeVisible();
    const targetBlock = page.locator(
      `[data-block-id="${comment.target.blockId}"]`,
    );
    await expect(targetBlock).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    const beforeJump = await page.evaluate(() => window.scrollY);
    await sentThread.locator(".review-sent-target").click();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(beforeJump);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const element = document.querySelector<HTMLElement>(
            "[data-review-diff-lens]",
          );
          if (element === null) return false;
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        }),
      )
      .toBe(true);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should refresh a thread digest when a later reply changes another block", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-digest-refresh-"));
  const planPath = join(directory, "plan.mdx");
  const initialSource = `# Digest refresh

## Delivery

~~~ts
const delivery = "first";
~~~

## Verification

~~~ts
const verification = "first";
~~~
`;
  const firstSource = initialSource.replace(
    'const delivery = "first";',
    'const delivery = "revised";',
  );
  const secondSource = firstSource.replace(
    'const verification = "first";',
    'const verification = "revised";',
  );
  const commentBody = "Review both delivery and verification.";
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.waitForFunction(
      () => typeof window.bigPlan?.feedback?.add === "function",
    );
    const target = page.locator(".code-figure").first();
    await target
      .getByRole("button", {
        name: "Comment on this code snippet",
      })
      .click();
    const composer = page.getByRole("dialog", { name: /Comment on/ });
    const submitRightAway = composer.getByRole("switch", {
      name: "Submit right away",
    });
    if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
      await submitRightAway.click();
    }
    await composer.getByLabel("Add a comment").fill(commentBody);
    await composer.getByRole("button", { name: "Add Comment" }).click();
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);

    const session = await liveReviewSession(page);
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const firstExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const firstRequest = nextPendingAgentRequest(firstExchange, agentViewer());
    if (firstRequest === undefined || firstRequest.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }
    const comment = firstRequest.comments.find(
      (entry) => entry.body === commentBody,
    );
    if (comment === undefined || comment.target.type !== "block") {
      throw new Error("The code comment did not retain a block target");
    }
    const firstRender = renderDocument({
      markdown: initialSource,
      fallbackTitle: "Digest refresh",
      identity: {},
    });
    const firstRevisionRender = renderDocument({
      markdown: firstSource,
      fallbackTitle: "Digest refresh",
      identity: {},
    });
    const firstChangedBlocks = new Set(
      diffSnapshots({
        before: firstRender.blocks,
        after: firstRevisionRender.blocks,
      }).flatMap((location) =>
        location.newBlockId === undefined ? [] : [location.newBlockId],
      ),
    );
    const firstSnapshot = deriveSnapshotDigest(firstSource);
    await writeSnapshot({
      store,
      snapshot: firstSnapshot,
      source: firstSource,
    });
    await writeFile(session.plan, firstSource, "utf8");
    const firstClaimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: firstRequest.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: firstRequest.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: firstRequest.requestId,
          outcomes: [
            {
              commentId: comment.id,
              state: "changed",
              message: "Revised the delivery boundary.",
              changeTargets: [comment.target.blockId],
            },
          ],
        },
        request: firstClaimed,
        commentsById: commentsFromExchange(firstExchange),
        changedBlocks: firstChangedBlocks,
        currentSnapshot: firstSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
    });
    await expect(page.locator("article")).toContainText(
      'const delivery = "revised";',
      { timeout: 15_000 },
    );

    const sentThread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: commentBody });
    await sentThread
      .getByRole("button", { name: "Expand thread", exact: true })
      .click();
    const reply = sentThread.getByPlaceholder("Reply to the agent…");
    await reply.fill("Now update verification too.");
    const replyResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await sentThread.getByRole("button", { name: "Reply" }).click();
    expect((await replyResponse).ok()).toBe(true);

    const secondExchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const secondRequest = nextPendingAgentRequest(
      secondExchange,
      agentViewer(),
    );
    if (secondRequest === undefined || secondRequest.kind !== "reply") {
      throw new Error("The thread reply did not create pending work");
    }
    const secondRevisionRender = renderDocument({
      markdown: secondSource,
      fallbackTitle: "Digest refresh",
      identity: {},
    });
    const secondChangedBlocks = new Set(
      diffSnapshots({
        before: firstRevisionRender.blocks,
        after: secondRevisionRender.blocks,
      }).flatMap((location) =>
        location.newBlockId === undefined ? [] : [location.newBlockId],
      ),
    );
    const secondSnapshot = deriveSnapshotDigest(secondSource);
    await writeSnapshot({
      store,
      snapshot: secondSnapshot,
      source: secondSource,
    });
    await writeFile(session.plan, secondSource, "utf8");
    const secondClaimed = await claimAgentRequest({
      store,
      activeSessionId: session.sessionId,
      requestId: secondRequest.requestId,
      claimedBy: agentSessionId,
      baselineSnapshot: secondRequest.premiseSnapshot,
      now: new Date().toISOString(),
    });
    await commitRequestTerminal({
      claimedBy: agentSessionId,
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: secondRequest.requestId,
          outcomes: [
            {
              commentId: comment.id,
              state: "changed",
              message: "Revised the verification boundary.",
              changeTargets: [...secondChangedBlocks],
            },
          ],
        },
        request: secondClaimed,
        commentsById: commentsFromExchange(secondExchange),
        changedBlocks: secondChangedBlocks,
        currentSnapshot: secondSnapshot,
        now: new Date().toISOString(),
      }),
      now: new Date().toISOString(),
    });
    await expect(page.locator("article")).toContainText(
      'const verification = "revised";',
      { timeout: 15_000 },
    );

    await expect(
      sentThread.getByRole("button", { name: "Review change" }).last(),
    ).toBeVisible();
    await sentThread
      .getByRole("button", { name: "Review change" })
      .last()
      .click();
    const lens = page.locator("[data-review-diff-lens]");
    await expect(lens).toContainText('const verification = "revised";');
    await expect(lens).not.toContainText('const delivery = "revised";');
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// The refresh's own status line promises that open threads and review state
// were preserved. Every element the island resolved before the swap belongs to
// the article that was thrown away, and each loss is silent: the hover cache
// still holds entries, the highlight registry still holds ranges, and the lens
// still renders - into nodes no reader can see. These assertions therefore
// check that the state landed back in the live article, not that it exists.
const REFRESH_STATE_MDX = `# Refresh state

## Delivery

The delivery gate runs manual checks before merge.

## Verification

Reviewers confirm the recorded output by hand.

## Rollout

The rollout waits for a green build.
`;

test("should re-anchor an open lens, its highlights, and hover association when a second revision refreshes the plan", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-refresh-state-"));
  const planPath = join(directory, "plan.mdx");
  const initialSource = REFRESH_STATE_MDX;
  const revisedSource = initialSource.replace(
    "The delivery gate runs manual checks before merge.",
    "The delivery gate runs automated checks before merge.",
  );
  const latestSource = revisedSource.replace(
    "The rollout waits for a green build.",
    "The rollout waits for a green build and a signed release.",
  );
  await writeFile(planPath, initialSource, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const commentedSlide = page.locator("[data-slide]").first();
    await stageComment(page, "Automate the delivery gate.");
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/feedback") &&
        response.request().method() === "POST",
    );
    await rail
      .getByRole("button", { name: "Send all comments to agent" })
      .click();
    expect((await submitted).ok()).toBe(true);

    await test.step("a selection comment stages its own persistent highlight", async () => {
      const quoted = page
        .locator("[data-block-kind='paragraph']")
        .filter({ hasText: "Reviewers confirm the recorded output" })
        .first();
      await quoted.scrollIntoViewIfNeeded();
      const selected = await quoted.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        if (!(text instanceof Text)) return "";
        const quote = text.data.slice(0, 18);
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, quote.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return quote;
      });
      expect(selected).not.toBe("");
      await page
        .getByRole("button", { name: "Comment on selected text" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: /Comment on Selected text in/u,
      });
      const submitRightAway = dialog.getByRole("switch", {
        name: "Submit right away",
      });
      if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
        await submitRightAway.click();
      }
      await dialog.getByLabel("Add a comment").fill("Name the recorded run.");
      await dialog.getByRole("button", { name: "Add Comment" }).click();
      expect(await liveSelectionHighlights(page)).toEqual({
        total: 1,
        inLivePlan: 1,
      });
    });

    const session = await liveReviewSession(page);
    const store = reviewStoreFor({
      planPath: session.plan,
      planId: session.planId,
    });
    const exchange = await readAgentExchange({
      store,
      sessionId: session.sessionId,
      planId: session.planId,
    });
    const request = nextPendingAgentRequest(exchange, agentViewer());
    if (request === undefined || request.kind !== "feedback") {
      throw new Error("Sending did not create a pending feedback request");
    }
    const fallbackTitle = "Refresh state";
    const changedBlockId = diffSnapshots({
      before: renderDocument({
        markdown: initialSource,
        fallbackTitle,
        identity: {},
      }).blocks,
      after: renderDocument({
        markdown: revisedSource,
        fallbackTitle,
        identity: {},
      }).blocks,
    }).find((location) => location.status === "changed")?.newBlockId;
    if (changedBlockId === undefined) {
      throw new Error("The simulated revision produced no changed block");
    }
    const revisedSnapshot = deriveSnapshotDigest(revisedSource);
    const latestSnapshot = deriveSnapshotDigest(latestSource);
    await writeSnapshot({
      store,
      snapshot: revisedSnapshot,
      source: revisedSource,
    });
    await writeSnapshot({
      store,
      snapshot: latestSnapshot,
      source: latestSource,
    });

    const answeredAt = new Date().toISOString();
    await test.step("the agent answers the feedback and the plan refreshes", async () => {
      await writeFile(session.plan, revisedSource, "utf8");
      const claimed = await claimAgentRequest({
        store,
        activeSessionId: session.sessionId,
        requestId: request.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: request.premiseSnapshot,
        now: answeredAt,
      });
      await commitRequestTerminal({
        claimedBy: agentSessionId,
        store,
        response: validateAgentResponseDraft({
          value: {
            requestId: request.requestId,
            outcomes: request.comments.map((comment) => ({
              commentId: comment.id,
              state: "changed",
              message: "Automated the delivery gate.",
              changeTargets: [changedBlockId],
            })),
          },
          request: claimed,
          commentsById: commentsFromExchange(exchange),
          changedBlocks: new Set([changedBlockId]),
          currentSnapshot: revisedSnapshot,
          now: answeredAt,
        }),
        now: answeredAt,
      });
      await expect(page.locator("article")).toContainText("automated checks", {
        timeout: 15_000,
      });
    });

    const lensHost = page.locator(
      "[data-review-diff-lens-host]:not([data-review-historical-diff])",
    );
    const anchorKicker = async (): Promise<string | null> =>
      lensHost.evaluate(
        (element) =>
          element
            .closest("[data-slide]")
            ?.querySelector("[data-slide-kicker]")
            ?.textContent?.trim() ?? null,
      );
    let openedKicker: string | null = null;
    await test.step("the reviewer opens the change in its slide", async () => {
      await rail
        .getByRole("button", { name: /Expand thread:/u })
        .first()
        .click();
      await rail.getByRole("button", { name: "Review change" }).click();
      await expect(lensHost).toHaveCount(1);
      openedKicker = await anchorKicker();
      expect(openedKicker).not.toBeNull();
    });

    await test.step("the agent revises a different slide while the lens is open", async () => {
      const revisedAgainAt = new Date(Date.parse(answeredAt) + 1).toISOString();
      const followUp = messageAgentRequest({
        kind: "chat",
        requestId: randomBytes(8).toString("hex"),
        sessionId: session.sessionId,
        planId: session.planId,
        premiseSnapshot: revisedSnapshot,
        createdAt: revisedAgainAt,
        body: "Require a signed release before rollout.",
      });
      await writeAgentRequest({ store, request: followUp });
      await writeFile(session.plan, latestSource, "utf8");
      const claimedFollowUp = await claimAgentRequest({
        store,
        activeSessionId: session.sessionId,
        requestId: followUp.requestId,
        claimedBy: agentSessionId,
        baselineSnapshot: revisedSnapshot,
        now: revisedAgainAt,
      });
      await commitRequestTerminal({
        claimedBy: agentSessionId,
        store,
        response: validateAgentResponseDraft({
          value: {
            requestId: followUp.requestId,
            message: "The rollout now waits for a signed release.",
          },
          request: claimedFollowUp,
          commentsById: new Map(),
          changedBlocks: new Set(),
          currentSnapshot: latestSnapshot,
          now: revisedAgainAt,
        }),
        now: revisedAgainAt,
      });
      await expect(page.locator("article")).toContainText("signed release", {
        timeout: 15_000,
      });
    });

    await test.step("the open lens re-anchors in the live slide it named", async () => {
      await expect(lensHost).toHaveCount(1);
      expect(await anchorKicker()).toBe(openedKicker);
      // The lens stands in for the block it replaces, so that block must be
      // hidden in the live article, not in the one that was discarded.
      await expect(
        page
          .locator("article p[data-block-kind='paragraph']")
          .filter({ hasText: "runs automated checks" }),
      ).toBeHidden();
      await expect(
        page
          .locator("article p[data-block-kind='paragraph']")
          .filter({ hasText: "signed release" }),
      ).toBeVisible();
    });

    await test.step("the selection highlight is registered against live text", async () => {
      await expect
        .poll(() => liveSelectionHighlights(page))
        .toEqual({ total: 1, inLivePlan: 1 });
    });

    await test.step("hovering the commented slide associates it again", async () => {
      await expect(commentedSlide).toHaveAttribute(
        "data-review-has-comment",
        "",
      );
      // Hover association deliberately yields to a focused thread, so the
      // reader turns back to the plan before a hover can mean anything.
      await rail.getByRole("button", { name: "Close feedback" }).click();
      await commentedSlide.locator("h2").first().hover();
      await expect(commentedSlide).toHaveAttribute(
        "data-review-comment-associated",
        "",
      );
    });
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-147. The recovery section is the only place the recovery prompt and the
// connector command are rendered, so an agent falling quiet must never hide it -
// that half is pinned by "should warn about a takeover before inviting one while
// work is held" in commenting-agent-cli.spec.ts. A runtime that cannot be
// reached is the other half: the connector command would be advice about a dead
// endpoint, under a card that already says the review session is offline.
test.describe("recovery section visibility", () => {
  // Aborting every agent poll is how a dead `big-plan review` looks to the
  // page, and the browser logs the failed fetches it is meant to survive.
  test.use({
    allowedConsoleErrors: [/Failed to load resource: net::ERR_FAILED/u],
  });

  test("should withhold the recovery section while the review runtime is unreachable", async ({
    page,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), "big-plan-recovery-gate-"));
    const planPath = join(directory, "plan.mdx");
    await writeFile(
      planPath,
      "# Unreachable runtime\n\nThe review session dies before the agent is ever polled.\n",
      "utf8",
    );
    const runtime = await startReviewRuntime({ planPath });
    const recoveryPanel = page.locator("[data-review-agent-recovery]");
    // The agent surface has its own control in viewer chrome now; it is no
    // longer a tab inside the feedback sidebar.
    const openAgentTab = async () => {
      await agentStatusTrigger(page).click();
      await expect(agentSidebar(page)).toBeVisible();
    };
    try {
      await page.goto(runtime.url);
      await openAgentTab();
      await expect(recoveryPanel).toBeVisible();

      // Every agent poll fails at the network layer, which is what a dead
      // `big-plan review` looks like to the page.
      await page.route("**/api/agent", (route) => route.abort());
      await page.reload();
      await openAgentTab();
      const rail = agentSidebar(page);
      await expect(
        rail.locator("[data-review-connection-health='unobservable']"),
      ).toBeVisible({ timeout: 10_000 });
      await expect(recoveryPanel).toHaveCount(0);

      // It returns as soon as the runtime answers again.
      await page.unroute("**/api/agent");
      await page.reload();
      await openAgentTab();
      await expect(recoveryPanel).toBeVisible();
    } finally {
      await closeReviewRuntime({ page, runtime });
      await rm(directory, { recursive: true, force: true });
    }
  });
});
