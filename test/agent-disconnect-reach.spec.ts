// BIG-282. A Disconnect click on a session this tab cannot use has to say so.
// It answered with nothing: refused in the browser when contact was lost,
// refused by the runtime with a 401 when the tab was out of date, and both
// answers went to a status string a served review never renders. The failing
// sessions are provoked at the network boundary, because what is under test is
// the page's reading of its session and what it lets the reviewer do with it;
// a real runtime restarted under a real tab looks exactly like a refused poll
// from here, and nothing below this rung can see the control, the card, the
// banner, and the notice together.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentSidebar,
  agentStatusTrigger,
  closeReviewRuntime,
  expect,
  startReviewRuntime,
  test,
} from "./fixtures";

const binPath = fileURLToPath(new URL("../bin/big-plan.mjs", import.meta.url));

const PLAN =
  "# Disconnect\n\nThe review has one agent attached and nothing open.\n";

const REFUSAL = {
  status: 401,
  contentType: "application/json",
  body: JSON.stringify({ error: "Missing or wrong session token" }),
};

// The runtime is made to refuse and to vanish on purpose. Chromium logs each
// failed load as a console error, and this journey proves the page says so.
test.use({ allowedConsoleErrors: [/^Failed to load resource/u] });

test("should never let a Disconnect click on an unusable session go unanswered", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "big-plan-disconnect-reach-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  // A real agent session, attached and waiting: the state a review spends
  // most of its time in, and the one the captain clicked from.
  const waiting = spawn(
    process.execPath,
    [binPath, "agent", "next", planPath, "--wait"],
    { stdio: "ignore" },
  );
  const disconnectPosts: Array<string> = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/agent-disconnect")
    ) {
      disconnectPosts.push(request.url());
    }
  });
  try {
    await page.goto(runtime.url);
    await agentStatusTrigger(page).click();
    const sidebar = agentSidebar(page);
    const card = sidebar.locator("[data-review-current-activity]");
    const disconnect = sidebar.locator("[data-review-agent-disconnect]");
    const reason = sidebar.locator("[data-review-agent-disconnect-block]");
    await expect(card).toHaveAttribute("data-review-current-activity", "idle", {
      timeout: 20_000,
    });
    await expect(disconnect).toBeEnabled();

    await test.step("a runtime that refuses this tab makes the control inert, with a reload as the way back", async () => {
      await page.route("**/api/**", (route) => route.fulfill(REFUSAL));
      await expect(card).toHaveAttribute(
        "data-review-current-activity",
        "offline",
        { timeout: 10_000 },
      );
      await expect(card).toContainText("Review session out of date");
      await expect(card).toContainText("Reload this page to reconnect.");
      await expect(agentStatusTrigger(page)).toHaveAccessibleName(
        "Agent Status: Review session out of date",
      );
      const banner = page.locator("[data-review-session-out-of-date]");
      await expect(banner).toContainText(
        "This tab's review session is out of date",
      );
      await expect(
        banner.getByRole("button", { name: "Reload" }),
      ).toBeEnabled();
      await expect(disconnect).toBeDisabled();
      await expect(reason).toHaveText("Review session out of date");
      await expect(reason).toHaveAttribute(
        "data-review-agent-disconnect-block",
        "session-refused",
      );
      // The connect section's claim that an agent is answering is withheld
      // under a card that says this page cannot see it (BIG-264).
      await expect(
        sidebar.getByText("Connect another agent", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath("disconnect-out-of-date.png"),
      });
      await page.unroute("**/api/**");
      await expect(card).toHaveAttribute(
        "data-review-current-activity",
        "idle",
        { timeout: 10_000 },
      );
      await expect(disconnect).toBeEnabled();
      expect(disconnectPosts).toEqual([]);
    });

    await test.step("a refusal from the runtime is reported where the reviewer is looking", async () => {
      // The gate is open, so the request leaves; the runtime's answer has to
      // come back as a notice rather than into the silence it used to.
      await page.route("**/api/agent-disconnect", (route) =>
        route.fulfill(REFUSAL),
      );
      await disconnect.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Disconnect agent" })
        .click();
      const notice = page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "Agent not disconnected" });
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("Missing or wrong session token");
      await expect(disconnect).toHaveText("Disconnect agent");
      await expect(disconnect).toBeEnabled();
      await page.screenshot({
        path: testInfo.outputPath("disconnect-refused-notice.png"),
      });
      await page.unroute("**/api/agent-disconnect");
      expect(disconnectPosts).toHaveLength(1);
    });

    await test.step("lost contact makes the card, the banner, and the control agree", async () => {
      await page.route("**/api/**", (route) => route.abort("failed"));
      await expect(page.locator("[data-review-server-gone]")).toBeVisible({
        timeout: 10_000,
      });
      await expect(card).toHaveAttribute(
        "data-review-current-activity",
        "offline",
      );
      await expect(card).toContainText("Review session unreachable");
      await expect(disconnect).toBeDisabled();
      await expect(reason).toHaveText("Review session unreachable");
      await page.screenshot({
        path: testInfo.outputPath("disconnect-lost-contact.png"),
      });
      await page.unroute("**/api/**");
      await expect(card).toHaveAttribute(
        "data-review-current-activity",
        "idle",
        { timeout: 10_000 },
      );
      expect(disconnectPosts).toHaveLength(1);
    });
  } finally {
    waiting.kill("SIGTERM");
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
