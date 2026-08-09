// Critical browser journey for the local review runtime behind the React
// commenting chrome: server-backed restoration and one real feedback handoff.

import { readFile, stat, writeFile } from "node:fs/promises";
import {
  commentsFromExchange,
  deriveSourceRevision,
  nextPendingAgentRequest,
  readAgentExchange,
  validateAgentResponseDraft,
  writeAgentResponse,
} from "../src/review/agent-exchange.js";
import { diffRevisions } from "../src/review/revision-diff.js";
import { reviewStoreFor, writeRevisionSnapshot } from "../src/review/store.js";
import { renderDocument } from "../src/render/render-document.js";
import { expect, stageComment, test } from "./fixtures";

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  await stageComment(page, "Clarify the failure boundary.");

  const rail = page.getByRole("complementary", { name: "Feedback" });
  const kernel = page.locator("#big-plan-review-root");
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("1 · Details");
  await expect(rail).toContainText("Comment staged locally.");

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");

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

  await expect(rail).toContainText("1 comment submitted.");
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Feedback/ }).click();
  const blockedSummary = page.locator(
    ".review-contextual-summary[data-review-sent-thread='queued']",
  );
  await expect(
    blockedSummary.getByRole("img", {
      name: "Blocked - no agent connected",
    }),
  ).toBeVisible();
  await expect(blockedSummary).not.toContainText(
    "BLOCKED - NO AGENT CONNECTED",
  );
  await expect(
    blockedSummary.getByRole("button", {
      name: "Expand comment: Clarify the failure boundary.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Feedback/ }).click();

  await rail.getByRole("tab", { name: "Agent" }).click();
  const currentActivity = rail.locator("[data-review-current-activity]");
  await expect(currentActivity).toHaveAttribute(
    "data-review-current-activity",
    "disconnected",
  );
  await expect(currentActivity).toContainText("The agent is disconnected");
  await expect(currentActivity).not.toContainText("1 · Details");
  await expect(currentActivity.getByText("offline")).toHaveCSS(
    "text-transform",
    "uppercase",
  );
  const connectionLog = rail
    .getByText("Connection log", { exact: true })
    .locator("xpath=ancestor::summary");
  await expect(connectionLog.locator("svg")).toHaveCount(1);
  await currentActivity.getByRole("button", { name: "View thread →" }).click();
  await expect(rail.getByRole("tab", { name: "Comments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const selectedThread = rail.locator("[data-review-comment-id]");
  await expect(selectedThread).toHaveAttribute("data-review-selected", "true");
  await expect(selectedThread).toHaveCSS("outline-width", "3px");
  await expect(page.locator("[data-review-comment-selected]")).not.toHaveCount(
    0,
  );
  const reply = selectedThread.getByPlaceholder("Reply to the agent…");
  await expect(reply).toBeFocused();
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
      name: "Blocked - no agent connected — view Agent tab",
    })
    .click();
  await expect(rail.getByRole("tab", { name: "Agent" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await currentActivity.getByRole("button", { name: "View thread →" }).click();
  await expect(reply).toBeFocused();
  await selectedTitle.click();
  await expect(
    selectedThread.getByRole("button", {
      name: "Expand thread: Clarify the failure boundary.",
    }),
  ).toBeVisible();

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
  const exchange = await readAgentExchange({
    store,
    sessionId: session.sessionId,
    planId: session.planId,
  });
  const request = nextPendingAgentRequest(exchange);
  if (request === undefined || request.kind !== "feedback") {
    throw new Error("Sending did not create a pending feedback request");
  }
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
  const locations = diffRevisions({
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
  const revision = deriveSourceRevision(afterSource);
  await writeRevisionSnapshot({
    store,
    revision,
    source: afterSource,
  });
  await writeAgentResponse({
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
      request,
      commentsById: commentsFromExchange(exchange),
      changedBlocks,
      currentRevision: revision,
      now: new Date().toISOString(),
    }),
  });

  await expect(kernel).toContainText("Changed");
  const sentThread = rail.locator("[data-review-sent-thread]");
  await expect(sentThread.locator(".review-sent-target")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(sentThread.locator(".review-sent-summary")).toHaveCSS(
    "font-size",
    "14px",
  );
  await sentThread.getByRole("button", { name: /^Expand thread:/u }).click();
  await expect(kernel).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  await expect(kernel).toContainText("A revised plan is ready.");
  await kernel.getByRole("button", { name: "See changes" }).click();
  await expect(kernel).toContainText("atomically");
  const resolve = sentThread
    .getByRole("button", { name: "Resolve comment" })
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
  const contextualThread = page.locator(
    "[data-review-thread-side] [data-review-sent-thread]",
  );
  await expect(contextualThread).toContainText("CHANGED");
  await expect(contextualThread).toContainText("Clarify the failure boundary.");
  await expect(contextualThread.locator(".review-sent-target")).toHaveCount(0);
  const contextualActions = contextualThread.locator(":scope > div");
  await expect(contextualActions).toHaveCSS("opacity", "0");
  await contextualThread.hover();
  await expect(contextualThread).toHaveAttribute(
    "data-review-associated",
    "true",
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
  await expect(page.locator("[data-slide]").first()).toHaveAttribute(
    "data-review-comment-associated",
    "",
  );
  await contextualThread
    .getByRole("button", { name: "Resolve comment" })
    .first()
    .click();
  await expect(page.locator("[data-review-thread-side]")).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("1 · Details");
  await expect(rail).not.toContainText(
    "Original target unavailable in this revision.",
  );
});
