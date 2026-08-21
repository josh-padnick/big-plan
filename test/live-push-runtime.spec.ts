// Proves the shipped runtime invariants that live plan push will reuse:
// candidate edits stay hidden until respond commits, and the resulting article
// replacement preserves the reviewer's reading and composing context.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSnapshotDigest } from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import {
  agentIdOf,
  closeReviewRuntime,
  expect,
  runAgentCli,
  stageComment,
  test,
  type Page,
} from "./fixtures";

const PLAN = `# Live push runtime probe

The reviewer keeps reading while an agent prepares a revision.

${Array.from(
  { length: 28 },
  (_, index) =>
    `Reading context ${String(index + 1)} keeps the delivery section below the fold.`,
).join("\n\n")}

## Delivery boundary

The terminal response publishes the candidate atomically.

${Array.from(
  { length: 20 },
  (_, index) =>
    `Trailing context ${String(index + 1)} prevents the reading position from being clamped after refresh.`,
).join("\n\n")}
`;

const candidatePlanOf = (stdout: string): string => {
  const candidate = /candidate_plan: (\S+)/u.exec(stdout)?.[1];
  if (candidate === undefined) {
    throw new Error(`The agent CLI returned no candidate plan:\n${stdout}`);
  }
  return candidate;
};

const responseDraftOf = (stdout: string): string => {
  const draft = /response_file: (\S+)/u.exec(stdout)?.[1];
  if (draft === undefined) {
    throw new Error(`The agent CLI returned no response file:\n${stdout}`);
  }
  return draft;
};

/** Reads the snapshot selected by the runtime's answered-gated agent payload. */
const agentSnapshot = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const root = document.documentElement;
    const response = await fetch("/api/agent", {
      headers: {
        "x-big-plan-review-token": root.dataset.reviewToken ?? "",
      },
    });
    const payload: unknown = await response.json();
    return typeof payload === "object" &&
      payload !== null &&
      "currentSnapshot" in payload &&
      typeof payload.currentSnapshot === "string"
      ? payload.currentSnapshot
      : "";
  });

test("should reveal a real agent edit only at commit and preserve review context across the article swap", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-live-push-probe-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  const previousModel = process.env.BIG_PLAN_AGENT_MODEL;
  process.env.BIG_PLAN_AGENT_MODEL = "live-push-probe-model";

  try {
    await page.goto(runtime.url);
    const requestBody = "Make the terminal publication boundary explicit.";
    await stageComment(page, requestBody);
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
    const thread = rail
      .locator("[data-review-sent-thread]")
      .filter({ hasText: requestBody });
    await thread
      .getByRole("button", { name: `Expand queued comment: ${requestBody}` })
      .click();
    await expect(
      thread.getByRole("button", { name: "Minimize thread" }).first(),
    ).toBeVisible();

    const deliverySlide = page.locator("[data-slide]").filter({
      has: page.getByRole("heading", { name: "Delivery boundary" }),
    });
    await deliverySlide.hover();
    await deliverySlide
      .getByRole("button", { name: "Comment on slide" })
      .click();
    const composerBody = "Keep this unfinished note through the live refresh.";
    const composer = page.getByRole("dialog", { name: /Comment on/u });
    await composer.getByLabel("Add a comment").fill(composerBody);
    await deliverySlide.scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      window.scrollBy({ top: 180, behavior: "instant" }),
    );
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);

    const baselineSnapshot = deriveSnapshotDigest(PLAN);
    await expect(agentSnapshot(page)).resolves.toBe(baselineSnapshot);
    const claim = await runAgentCli(["next", planPath, "--wait"]);
    const requestId = agentIdOf(claim.stdout, "requestId");
    const commentId = agentIdOf(claim.stdout, "- id");
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    const candidatePath = candidatePlanOf(claim.stdout);
    const revised = PLAN.replace(
      "The terminal response publishes the candidate atomically.",
      "The terminal response publishes the staged candidate atomically.",
    );
    await writeFile(candidatePath, revised, "utf8");
    await expect(readFile(planPath, "utf8")).resolves.toBe(PLAN);

    await expect(agentSnapshot(page)).resolves.toBe(baselineSnapshot);
    await expect(page.locator("article")).toContainText(
      "publishes the candidate atomically",
    );
    await expect(page.locator("article")).not.toContainText(
      "publishes the staged candidate atomically",
    );

    const responsePath = responseDraftOf(claim.stdout);
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId,
        outcomes: [
          {
            commentId,
            state: "changed",
            message: "Made the publication boundary explicit.",
            changeTargets: ["section/delivery-boundary/paragraph-1"],
          },
        ],
      }),
      "utf8",
    );
    const published = await runAgentCli([
      "respond",
      planPath,
      responsePath,
      "--agent",
      agentToken,
    ]);
    expect(agentIdOf(published.stdout, "responded")).toBe(requestId);

    const resultSnapshot = deriveSnapshotDigest(revised);
    await expect.poll(() => agentSnapshot(page)).toBe(resultSnapshot);
    await expect(page.locator("article")).toContainText(
      "publishes the staged candidate atomically",
      { timeout: 15_000 },
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
    await expect(
      thread.getByRole("button", { name: "Minimize thread" }).first(),
    ).toBeVisible();
    await expect(composer.getByLabel("Add a comment")).toHaveValue(
      composerBody,
    );
  } finally {
    if (previousModel === undefined) delete process.env.BIG_PLAN_AGENT_MODEL;
    else process.env.BIG_PLAN_AGENT_MODEL = previousModel;
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
