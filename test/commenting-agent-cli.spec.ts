// Minimal process-boundary journey: one real agent CLI claim and response
// crosses the same mailbox that the browser chat surface reads.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAgentExchange } from "../src/review/agent-exchange.js";
import { startReviewRuntime } from "../src/review/server.js";
import { agentResponseDraftPath, readProgress } from "../src/review/store.js";
import { expect, test } from "./fixtures";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(repoRoot, "bin", "big-plan.mjs");

const runAgentCli = (
  args: ReadonlyArray<string>,
): Promise<{ readonly stdout: string; readonly stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, "agent", ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Agent CLI timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, 4_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Agent CLI could not start: ${String(error)}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Agent CLI stopped with code ${String(code)} and signal ${String(signal)}.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });

test("should carry one plan-wide chat through the real agent CLI", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-agent-chat-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(
    planPath,
    "# Agent chat\n\nThe review has one short plan-wide question.\n",
    "utf8",
  );
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /Feedback/u }).click();
    const rail = page.getByRole("complementary", { name: "Feedback" });
    await rail.getByRole("tab", { name: "Chat" }).click();
    await rail
      .getByPlaceholder("Ask about the plan as a whole…")
      .fill("What is the plan's purpose?");
    await rail.getByRole("button", { name: "Send", exact: true }).click();

    const chat = rail.locator("li").filter({
      hasText: "What is the plan's purpose?",
    });
    await expect(chat).toContainText("Blocked - no agent connected");

    const claim = await runAgentCli(["next", planPath, "--wait"]);
    expect(claim.stdout).toContain("pending: true");
    const exchange = await readAgentExchange({
      store: runtime.store,
      sessionId: runtime.sessionId,
      planId: runtime.planId,
    });
    const request = exchange.requests.find(
      (candidate) => candidate.kind === "chat",
    );
    if (request === undefined) {
      throw new Error("The real agent CLI did not claim the chat request");
    }
    await expect(
      readProgress({ store: runtime.store, sessionId: runtime.sessionId }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: request.requestId,
          step: "Reviewing plan question",
          state: "live",
        }),
      ]),
    );

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(chat).toContainText("Agent is working on your feedback");

    const responsePath = agentResponseDraftPath({
      store: runtime.store,
      requestId: request.requestId,
    });
    await writeFile(
      responsePath,
      JSON.stringify({
        requestId: request.requestId,
        message: "It lets a reviewer understand and discuss the plan.",
      }),
      "utf8",
    );
    const response = await runAgentCli(["respond", planPath, responsePath]);
    expect(response.stdout).toContain(`responded: ${request.requestId}`);

    await page.reload();
    await page.getByRole("button", { name: /Feedback/u }).click();
    await rail.getByRole("tab", { name: "Chat" }).click();
    await expect(chat).toContainText(
      "It lets a reviewer understand and discuss the plan.",
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
