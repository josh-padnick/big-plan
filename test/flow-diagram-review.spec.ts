// Critical browser journeys for reviewing a FlowDiagram: clearing authored
// text remains a visible proposal, comments stay marked at their subject, and
// the diagram's handoff action occupies the correct chrome in each view.

import { expect, test } from "./fixtures";

test("should render cleared node text as a struck-through edit", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const label = node.locator('[data-flow-field="label"]');

  await test.step("clear the selected label through the editing affordance", async () => {
    await node.click();
    await page.keyboard.press("Enter");
    await expect(label).toHaveAttribute("data-flow-editing", "");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
  });

  await test.step("keep the authored text visible as the removal side of the diff", async () => {
    await expect(label).toHaveText("");
    const original = node.locator(".flow-diagram-original");
    await expect(original).toHaveText("Author once");
    await expect(original).toBeVisible();
    await expect(original).toHaveCSS("text-decoration-line", "line-through");
    await expect(node).not.toHaveAttribute("data-flow-proposed", /removed/);
  });
});

test("should keep the handoff hidden on load and place it in active chrome", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const add = diagram.locator(".flow-collector-add");

  await test.step("render no empty handoff control on initial load", async () => {
    await expect(add).toBeHidden();
    await expect(add).toHaveText("");
    await expect(add).toHaveAttribute("hidden", "");
  });

  await test.step("mark a saved comment at its diagram element", async () => {
    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    await diagram
      .locator(".flow-diagram-compose textarea")
      .fill("Keep this source explicit.");
    await diagram
      .locator('.flow-diagram-compose button[data-variant="primary"]')
      .click();

    const marker = node.locator("[data-flow-comment-marker]");
    await expect(marker).toBeVisible();
    await expect(
      marker.locator('[data-lucide="message-square"]'),
    ).toBeVisible();
  });

  await test.step("place the inline action beside the note count", async () => {
    const total = diagram.locator("[data-flow-total]");
    await expect(total).toHaveText("1 note");
    await expect(add).toBeVisible();
    await expect(add).toHaveText("Add 1 note to plan feedback");
    expect(
      await add.evaluate(
        (element) =>
          element.previousElementSibling?.hasAttribute("data-flow-total") ??
          false,
      ),
    ).toBe(true);
    await expect(add.locator("xpath=..")).toHaveAttribute(
      "data-flow-controls",
      "true",
    );
  });

  await test.step("place the maximized action inside the distinct tray footer", async () => {
    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).toHaveAttribute("data-figure-maximized", "");
    await expect(node.locator("[data-flow-comment-marker]")).toBeVisible();

    const tray = diagram.locator(".flow-collector");
    const head = tray.locator(".flow-collector-head");
    const list = tray.locator(".flow-collector-list");
    await expect(tray).toBeVisible();
    await expect(add.locator("xpath=..")).toHaveClass(/flow-collector-foot/);
    await expect(add).toBeVisible();
    expect(
      await head.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).not.toBe(
      await list.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    );
  });
});
