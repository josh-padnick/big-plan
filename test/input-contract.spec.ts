// BIG-128. Proves the review's input contract over the live runtime: the
// sidebar's Inputs tab lists every decision the plan asks and which of them the
// author called critical, and answering one turns that input Answered without a
// reload.
//
// The reload matters. The list and the decision cards are driven by the same
// record, and the panel learns a newer copy arrived only because the page that
// applied it says so. That announcement runs between two modules that never
// reference each other, and when it stops nothing throws: the panel simply
// keeps showing a review the card two inches away has already moved past. This
// is the only place that silence is visible, so it is asserted here.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "./fixtures";

const PLAN = `# Retry queue

Two questions stand between this plan and implementation.

<QuickDecision critical question="Do we ship behind a flag?">

<Option title="Yes" recommended summary="One group first." />

<Option title="No" summary="Everyone at once." />

</QuickDecision>

<QuickDecision question="Do we rename the endpoint?">

<Option title="Keep the name" recommended summary="Callers depend on it." />

<Option title="Rename it" summary="The old name misleads." />

</QuickDecision>
`;

const FLAG_INPUT = "quick-decision-do-we-ship-behind-a-flag";
const RENAME_INPUT = "quick-decision-do-we-rename-the-endpoint";

const feedbackSidebar = (page: Page) =>
  page.getByRole("complementary", { name: "Feedback" });

const sidebar = (page: Page) => page.locator("#review-panel-inputs");

const inputRow = (page: Page, inputId: string) =>
  sidebar(page).locator(`[data-review-input="${inputId}"]`);

test("should list what the review needs and answer an input without a reload", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-input-contract-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, PLAN);
  // Playwright wraps JSX values during source transformation, so component
  // journeys use the built renderer exactly as the shipped runtime does.
  const { startReviewRuntime } = await import("../dist/review/server.js");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
    // The panel mounts with the tab, so the first read of the contract is the
    // one this click starts.
    const contract = page.waitForResponse((response) =>
      response.url().endsWith("/api/input-contract"),
    );
    await feedbackSidebar(page).getByRole("tab", { name: "Inputs" }).click();
    expect((await contract).ok()).toBe(true);

    await test.step("the inventory names every decision and which is critical", async () => {
      await expect(
        sidebar(page).locator("[data-review-input-standing]"),
      ).toHaveText("0 of 2 answered");
      await expect(sidebar(page)).toContainText(
        "1 critical input is still open",
      );
      await expect(inputRow(page, FLAG_INPUT)).toContainText(
        "Do we ship behind a flag?",
      );
      await expect(inputRow(page, FLAG_INPUT)).toHaveAttribute(
        "data-review-input-state",
        "unanswered",
      );
      // Criticality is authored, so exactly the decision that carries the
      // attribute is marked and the other one is not.
      await expect(inputRow(page, FLAG_INPUT)).toContainText("Critical");
      await expect(inputRow(page, RENAME_INPUT)).not.toContainText("Critical");
    });

    await test.step("answering a decision turns its input Answered in place", async () => {
      const decision = page.locator(`#${FLAG_INPUT}[data-decision]`);
      await decision.getByRole("radio", { name: "Yes" }).check();
      await decision.getByRole("button", { name: "Confirm choice" }).click();

      // No reload: the panel is told the record moved by the page that applied
      // it, and it reads the contract again on its own.
      await expect(inputRow(page, FLAG_INPUT)).toHaveAttribute(
        "data-review-input-state",
        "answered",
      );
      await expect(inputRow(page, FLAG_INPUT)).toContainText("Answered: Yes");
      await expect(
        sidebar(page).locator("[data-review-input-standing]"),
      ).toHaveText("1 of 2 answered");
      await expect(sidebar(page)).not.toContainText(
        "critical input is still open",
      );
      await expect(inputRow(page, RENAME_INPUT)).toHaveAttribute(
        "data-review-input-state",
        "unanswered",
      );
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
