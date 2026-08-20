// BIG-171. The one journey that proves the reviewer can actually move primacy.
//
// Everything below the browser is unit-proven: the roles in
// shared/agent-primacy.test.ts, the durable roster in agent-roster.test.ts, the
// route in agent-primacy-route.test.ts. What none of them can answer is whether
// the surface the whole observer model exists for works end to end - a real
// second connector, the reviewer reading a card and clicking through a
// confirmation, and both agents finding out what they now are.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewRuntime } from "../src/review/server.js";
import { readAgentRoster } from "../src/review/store.js";
import {
  agentIdOf,
  agentSidebar,
  agentStatusTrigger,
  closeReviewRuntime,
  expect,
  runAgentCli,
  runRefusedAgentCli,
  stageComment,
  test,
  untilObserverAttaches,
} from "./fixtures";

const PLAN = `# Two agents, one review

The plan starts with one committed section.

## Hand-off

The reviewer decides which attached agent answers them.
`;

const HALF_WRITTEN = "The first agent had written this much when";

test.setTimeout(120_000);

test("should let the reviewer hand primacy to a second agent and tell both", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-primacy-handoff-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await stageComment(page, "Say which agent answers this review.");
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

    // The first connector takes the work and starts editing its own candidate.
    const firstClaim = await runAgentCli(["next", planPath, "--wait"]);
    const firstToken = agentIdOf(firstClaim.stdout, "agent_token");
    const firstCandidate = /candidate_plan: (\S+)/u.exec(
      firstClaim.stdout,
    )?.[1];
    if (firstCandidate === undefined) {
      throw new Error(`No candidate plan:\n${firstClaim.stdout}`);
    }
    await writeFile(firstCandidate, `${PLAN}\n${HALF_WRITTEN}\n`, "utf8");

    // A second connector arrives while the first holds the plan. Its loop stays
    // alive on purpose: it is waiting to be told what it is.
    const secondPickup = runAgentCli(["next", planPath, "--wait"]);
    const observer = await untilObserverAttaches(runtime);

    // What the reviewer sees: one question, naming the agent that asked.
    await page.reload();
    await agentStatusTrigger(page).click();
    await expect(agentSidebar(page)).toBeVisible();
    const requestCard = agentSidebar(page).locator(
      '[data-review-agent-card="request"]',
    );
    await expect(requestCard).toBeVisible();
    await expect(requestCard).toContainText(
      "A second agent wants to answer you",
    );
    await expect(
      agentSidebar(page).locator(
        `[data-review-agent-writer="${observer.writerId}"]`,
      ),
    ).toBeVisible();
    // The toolbar says a decision is owed, and says nothing else.
    await expect(
      agentStatusTrigger(page).locator("[data-review-agent-status]"),
    ).toHaveAttribute("data-review-agent-status", "decision-owed");

    // Answering it is two deliberate steps, and the second one is a real modal.
    await requestCard.getByRole("button", { name: "Make it primary" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("No submitted comments are lost");
    // The reviewer chooses to carry the outgoing draft across as reference.
    await confirm.getByRole("checkbox").check();
    const answered = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-primacy") &&
        response.request().method() === "POST",
    );
    await confirm.getByRole("button", { name: "Make primary" }).click();
    expect((await answered).ok()).toBe(true);

    // The second connector is released with the work, and with the draft the
    // reviewer chose to hand it - as a path to read, not as its candidate.
    const promoted = await secondPickup;
    expect(promoted.stdout).toContain("previous_agent_draft");
    expect(agentIdOf(promoted.stdout, "agent_token")).not.toBe(firstToken);
    const carried = /previous_agent_draft: (\S+)/u.exec(promoted.stdout)?.[1];
    if (carried === undefined) {
      throw new Error(`No carried draft:\n${promoted.stdout}`);
    }
    await expect(readFile(carried, "utf8")).resolves.toContain(HALF_WRITTEN);
    const promotedCandidate = /candidate_plan: (\S+)/u.exec(
      promoted.stdout,
    )?.[1];
    expect(promotedCandidate).not.toBe(firstCandidate);
    // A pointer, never a seed: the new primary starts from the published plan.
    await expect(
      readFile(promotedCandidate ?? "", "utf8"),
    ).resolves.not.toContain(HALF_WRITTEN);

    // The roster names one primary, and it is the agent the reviewer picked.
    const roster = await readAgentRoster({
      store: runtime.store,
      sessionId: runtime.sessionId,
    });
    expect(
      roster.filter((agent) => agent.role === "primary").map((a) => a.writerId),
    ).toEqual([observer.writerId]);

    // The displaced agent finds out at its next command rather than after
    // paying for a whole turn, and it is told who holds the plan now.
    const refused = await runRefusedAgentCli([
      "note",
      planPath,
      "Still working on it",
      "--agent",
      firstToken,
    ]);
    expect(`${refused.stdout}${refused.stderr}`).toMatch(
      /no longer the primary/u,
    );

    // And the question is gone from the reviewer's surface, not merely answered
    // underneath it. The toolbar names what is true now - the agent they chose
    // is working - rather than still holding a hazard for a settled decision.
    await page.reload();
    await agentStatusTrigger(page).click();
    await expect(
      agentSidebar(page).locator('[data-review-agent-card="request"]'),
    ).toHaveCount(0);
    await expect(
      agentStatusTrigger(page).locator("[data-review-agent-status]"),
    ).toHaveAttribute("data-review-agent-status", "working");
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
