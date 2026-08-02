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

test("should keep review chrome stable through zoom and maximize in both themes", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const node = diagram.locator('[data-flow-node="authored"]');
  const footer = diagram.locator("[data-flow-diagram-footer]");
  const toolbar = diagram.locator("[data-flow-controls]");
  const toolbarAdd = toolbar.locator(":scope > .flow-collector-add");
  const trayAdd = diagram.locator(".flow-collector-foot > .flow-collector-add");

  await test.step("render no empty handoff controls or whole-diagram comment action", async () => {
    await expect(toolbarAdd).toBeHidden();
    await expect(toolbarAdd).toHaveText("");
    await expect(toolbarAdd).toHaveAttribute("hidden", "");
    await expect(trayAdd).toBeHidden();
    await expect(trayAdd).toHaveText("");
    await expect(trayAdd).toHaveAttribute("hidden", "");

    await diagram.focus();
    await expect(
      diagram.locator(
        '.flow-diagram-actionbar-button[data-flow-action="comment"]',
      ),
    ).toBeHidden();

    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).toHaveAttribute("data-figure-maximized", "");
    await expect(
      diagram.locator(
        '.flow-diagram-actionbar-button[data-flow-action="comment"]',
      ),
    ).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
    await expect(diagram).toBeFocused();
    await expect(diagram.locator("[data-figure-maximize]")).not.toBeFocused();
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

  await test.step("pin the inline action to the toolbar's left edge", async () => {
    const total = diagram.locator("[data-flow-total]");
    await expect(total).toHaveText("1 note");
    await expect(toolbarAdd).toBeVisible();
    await expect(toolbarAdd).toHaveText("Add 1 note to plan feedback");
    const placement = await toolbar.evaluate((element) => {
      const add = element.querySelector(":scope > .flow-collector-add");
      const total = element.querySelector("[data-flow-total]");
      if (add === null || total === null) return null;
      const barRect = element.getBoundingClientRect();
      const addRect = add.getBoundingClientRect();
      const totalRect = total.getBoundingClientRect();
      return {
        first: element.firstElementChild === add,
        leftInset: addRect.left - barRect.left,
        paddingLeft: Number.parseFloat(getComputedStyle(element).paddingLeft),
        overlap: Math.max(
          0,
          Math.min(addRect.right, totalRect.right) -
            Math.max(addRect.left, totalRect.left),
        ),
      };
    });
    expect(placement).not.toBeNull();
    expect(placement?.first).toBe(true);
    expect(placement?.leftInset).toBeCloseTo(placement?.paddingLeft ?? -1);
    expect(placement?.overlap).toBe(0);
  });

  for (const theme of ["light", "dark"]) {
    await test.step(`${theme}: keep markers fixed, footer quiet, and Escape focus sensible`, async () => {
      await page.evaluate((value) => {
        document.documentElement.dataset["theme"] = value;
      }, theme);

      await footer.hover();
      await expect
        .poll(() =>
          footer.evaluate((element) => getComputedStyle(element).outlineStyle),
        )
        .toBe("none");

      await diagram.locator('[data-flow-zoom="fit"]').click();
      for (let index = 0; index < 2; index += 1) {
        await diagram.locator('[data-flow-zoom="out"]').click();
      }
      const smallZoomMarker = await node
        .locator("[data-flow-comment-marker]")
        .boundingBox();
      for (let index = 0; index < 4; index += 1) {
        await diagram.locator('[data-flow-zoom="in"]').click();
      }
      const largeZoomMarker = await node
        .locator("[data-flow-comment-marker]")
        .boundingBox();
      expect(smallZoomMarker).not.toBeNull();
      expect(largeZoomMarker).not.toBeNull();
      expect(largeZoomMarker?.width).toBeCloseTo(smallZoomMarker?.width ?? -1);
      expect(largeZoomMarker?.height).toBeCloseTo(
        smallZoomMarker?.height ?? -1,
      );

      await diagram.locator("[data-figure-maximize]").click();
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");
      await expect(toolbarAdd).toBeVisible();
      await expect(trayAdd).toBeVisible();
      await expect(trayAdd).toHaveText("Add 1 note to plan feedback");
      await expect(node.locator("[data-flow-comment-marker]")).toBeVisible();
      const tray = diagram.locator(".flow-collector");
      const head = tray.locator(".flow-collector-head");
      const list = tray.locator(".flow-collector-list");
      await expect(tray).toBeVisible();
      expect(
        await head.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      ).not.toBe(
        await list.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      );

      await footer.hover();
      await expect
        .poll(() =>
          footer.evaluate((element) => getComputedStyle(element).outlineStyle),
        )
        .toBe("none");
      await page.keyboard.press("Escape");
      await expect(diagram).not.toHaveAttribute("data-figure-maximized");
      await expect(diagram).toBeFocused();
      await expect(diagram.locator("[data-figure-maximize]")).not.toBeFocused();
    });
  }

  await test.step("add the note from the viewer toolbar", async () => {
    await toolbarAdd.click();
    const status = diagram.locator(".flow-collector-status");
    await expect(status).not.toHaveAttribute("hidden", "");
    await expect(status).toHaveAttribute("data-tone", "unavailable");
    await expect(status).toContainText("nothing was added");
    await expect(toolbarAdd).toBeVisible();
  });
});
