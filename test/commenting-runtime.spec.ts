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

  await expect(rail).toContainText("1 comment handed off.");
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();

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
  await expect(kernel).toContainText(
    "Removed the ambiguous promise and tightened delivery.",
  );
  await expect(kernel).toContainText("A revised plan is ready.");
  await kernel.getByRole("button", { name: "What changed" }).click();
  await expect(kernel.locator('[aria-label="Revision changes"]')).toContainText(
    "atomically",
  );

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText(
    "Original target unavailable in this revision.",
  );
});
