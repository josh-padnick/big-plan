// Browser test of the reviewer's commenting journey over a complete rendered
// document: the quiet reading default, a comment on a block, a comment on a
// highlighted passage, the Feedback sidebar's staged lifecycle, and the guarantee
// that a comment body stays literal text wherever it is shown. The runtime's
// transport and package behavior is covered by its own unit tests; this spec
// covers the half that only exists in a browser. Render-health failures are
// enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should comment on a block and a passage, then revise before sending", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const tray = page.locator("[data-review-rail]");
  const affordance = page.locator("[data-review-affordance]");
  const rows = page.locator("[data-review-drafts] li");

  await test.step("reading stays quiet until the reviewer asks for more", async () => {
    await expect(tray).toBeHidden();
    await expect(affordance).toBeHidden();
    await expect(page.locator("[data-review-toggle]")).toBeVisible();
    await expect(page.locator("[data-review-annotated]")).toHaveCount(0);
  });

  await test.step("hovering a block reveals its comment control", async () => {
    await page.locator("[data-block-kind='list']").first().hover();
    await expect(affordance).toBeVisible();
    await expect(affordance).toHaveAttribute("aria-label", /^Comment on list:/);
  });

  await test.step("saving the first comment floats its card and chips the block", async () => {
    await affordance.click();
    await page
      .locator("[data-review-compose-input]")
      .fill("Say what breaks, not only what works.");
    await page.locator("[data-review-compose-save]").click();
    await expect(tray).toBeHidden();
    await expect(page.locator("[data-review-thread-card]")).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-review-annotated]")).toHaveCount(1);
    await expect(page.locator("[data-review-toggle-count]")).toBeHidden();
  });

  await test.step("highlighting a passage offers to comment on the selection", async () => {
    await page.evaluate(() => {
      const paragraph = document.querySelector("[data-block-kind='paragraph']");
      const target = paragraph?.firstChild;
      if (target === null || target === undefined) return;
      const range = document.createRange();
      range.setStart(target, 0);
      range.setEnd(target, 8);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(affordance).toHaveAttribute(
      "aria-label",
      "Comment on the selected text",
    );
    await affordance.click();
    await expect(page.locator("[data-review-compose-target]")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute(
      "data-review-active-selection-highlight",
      "true",
    );
  });

  await test.step("a comment body stays literal text wherever it is shown", async () => {
    await page
      .locator("[data-review-compose-input]")
      .fill("<img src=x onerror=alert(1)> ## Not a heading");
    await page.locator("[data-review-compose-save]").click();
    const body = page.locator("[data-review-row-body]").nth(1);
    await expect(body).toHaveText(
      "<img src=x onerror=alert(1)> ## Not a heading",
    );
    expect(await body.locator("*").count()).toBe(0);
  });

  await test.step("a pending comment can be rewritten in place", async () => {
    await page.locator("[data-review-toggle]").click();
    await page.locator("[data-review-row-edit]").first().click();
    await page
      .locator("[data-review-row-input]")
      .fill("Rewritten before send.");
    await page.locator("[data-review-row-save]").click();
    await expect(page.locator("[data-review-row-body]").first()).toHaveText(
      "Rewritten before send.",
    );
  });

  await test.step("deleting the last comment on a block clears its chip", async () => {
    await page.locator("[data-review-row-delete]").first().click();
    await expect(page.locator("[data-review-delete-dialog]")).toBeVisible();
    await page.locator("[data-review-delete-confirm]").click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator("[data-review-annotated]")).toHaveCount(1);
  });

  await test.step("the tray hides on demand without making drafts a persistent signal", async () => {
    await page.locator("[data-review-hide]").click();
    await expect(tray).toBeHidden();
    await expect(page.locator("[data-review-toggle-count]")).toBeHidden();
    await page.locator("[data-review-toggle]").click();
    await expect(tray).toBeVisible();
  });

  await test.step("submitting without a runtime says so instead of failing silently", async () => {
    await page.locator("[data-review-send]").click();
    await expect(page.locator("[data-review-send-note]")).toContainText(
      "big-plan review",
    );
    await expect(rows).toHaveCount(1);
  });
});
