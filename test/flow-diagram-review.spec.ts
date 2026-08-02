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

test("should preserve authored markup when an edit is canceled or cleared", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").nth(1);
  const body = diagram
    .locator('[data-flow-node="skill"]')
    .locator('[data-flow-field="body"]');
  const original = "Calls big-plan guidance in its workflow";

  await body.dblclick();
  await body.fill("Temporary replacement");
  await page.keyboard.press("Escape");
  await expect(body).toHaveText(original);
  await expect(body.locator("code")).toHaveText("big-plan guidance");

  await body.dblclick();
  await body.fill(original);
  await page.keyboard.press("Enter");
  await expect(body).toHaveText(original);
  await expect(body.locator("code")).toHaveText("big-plan guidance");
  await expect(body).not.toHaveAttribute("data-flow-edited");
});

test("should preserve a panned canvas when feedback repaints it", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);

  const diagram = page.locator("[data-flow-diagram]").first();
  const viewport = diagram.locator("[data-flow-viewport]");
  const sizer = diagram.locator("[data-flow-sizer]");
  const node = diagram.locator('[data-flow-node="authored"]');
  const initialTransform = await sizer.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );

  await viewport.dispatchEvent("wheel", { deltaX: 40, deltaY: 30 });
  const pannedTransform = await sizer.evaluate(
    (element) => (element as HTMLElement).style.transform,
  );
  expect(pannedTransform).not.toBe(initialTransform);

  await node.click();
  await diagram.locator('[data-flow-action="comment"]').click();
  await diagram
    .locator(".flow-diagram-compose textarea")
    .fill("Keep this framing.");
  await diagram
    .locator('.flow-diagram-compose button[data-variant="primary"]')
    .click();
  await expect
    .poll(() =>
      sizer.evaluate((element) => (element as HTMLElement).style.transform),
    )
    .toBe(pannedTransform);

  const unlabeledEdge = diagram.locator(
    '[data-flow-edge-from="generator"][data-flow-edge-to="cli"]',
  );
  await unlabeledEdge.click();
  await expect(diagram.locator(".flow-diagram-actionbar-hint")).toHaveText(
    "Delete to remove",
  );
  await page.keyboard.press("Delete");
  await expect(diagram.locator(".flow-diagram-actionbar-hint")).toHaveText(
    "Delete to restore",
  );
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
  const exitAlert = diagram.getByRole("alertdialog");
  const compose = diagram.locator(".flow-diagram-compose");

  await test.step("render no empty handoff controls or whole-diagram comment action", async () => {
    await expect(toolbarAdd).toBeHidden();
    await expect(toolbarAdd).toHaveText("");
    await expect(toolbarAdd).toHaveAttribute("hidden", "");
    await expect(trayAdd).toBeHidden();
    await expect(trayAdd).toHaveText("");
    await expect(trayAdd).toHaveAttribute("hidden", "");

    await diagram.focus();
    await expect(diagram).not.toHaveAttribute("data-flow-selected");
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

    await node.click();
    await diagram.locator('[data-flow-action="comment"]').click();
    await expect(compose).toBeVisible();
    await diagram.locator("[data-figure-maximize]").click();
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
    await expect(compose).toBeHidden();
    await expect(diagram).not.toHaveAttribute("data-flow-selected");

    await diagram.locator("[data-figure-maximize]").click();
    await page.keyboard.press("Escape");
    await expect(diagram).not.toHaveAttribute("data-figure-maximized");
    await expect(diagram).not.toHaveAttribute("data-flow-selected");
    await expect(diagram).toHaveAttribute("data-figure-focus-quiet", "");
    await expect(diagram).toBeFocused();
    await expect(diagram.locator("[data-figure-maximize]")).not.toBeFocused();
    await expect(exitAlert).toBeHidden();
  });

  await test.step("mark two saved comments at the diagram element", async () => {
    for (const body of [
      "Keep this source explicit.",
      "Preserve the ownership label.",
    ]) {
      await node.click();
      await diagram.locator('[data-flow-action="comment"]').click();
      await diagram.locator(".flow-diagram-compose textarea").fill(body);
      await diagram
        .locator('.flow-diagram-compose button[data-variant="primary"]')
        .click();
    }

    const marker = node.locator("[data-flow-comment-marker]");
    await expect(marker).toBeVisible();
    await expect(
      marker.locator('[data-lucide="message-square"]'),
    ).toBeVisible();
    await expect(marker).toContainText("2");
  });

  await test.step("pin the inline action to the toolbar's left edge", async () => {
    const total = diagram.locator("[data-flow-total]");
    await expect(total).toHaveText("2 notes");
    await expect(toolbarAdd).toBeVisible();
    await expect(toolbarAdd).toHaveText("Add 2 notes to plan feedback");
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
      await expect(trayAdd).toHaveText("Add 2 notes to plan feedback");
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
      await expect(exitAlert).toBeVisible();
      await expect(exitAlert).toContainText(
        "You still have 2 feedback notes to submit. Are you sure you want to exit full screen mode?",
      );
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");
      const stay = exitAlert.getByRole("button", {
        name: "Stay in full screen",
      });
      const exit = exitAlert.getByRole("button", {
        name: "Exit full screen",
      });
      await expect(stay).toBeFocused();
      await expect(diagram.locator("[data-flow-viewport]")).toHaveJSProperty(
        "inert",
        true,
      );
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Control+z");
      await expect(exitAlert).toContainText(
        "You still have 2 feedback notes to submit.",
      );
      await expect(node.locator("[data-flow-comment-marker]")).toContainText(
        "2",
      );
      await page.keyboard.press("Tab");
      await expect(exit).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(stay).toBeFocused();
      await stay.click();
      await expect(exitAlert).toBeHidden();
      await expect(diagram).toHaveAttribute("data-figure-maximized", "");

      await node.click();
      await diagram.locator('[data-flow-action="comment"]').click();
      await expect(compose).toBeVisible();
      await diagram.locator("[data-figure-maximize]").click();
      await expect(exitAlert).toBeVisible();
      await exit.click();
      await expect(exitAlert).toBeHidden();
      await expect(compose).toBeHidden();
      await expect(diagram).not.toHaveAttribute("data-figure-maximized");
      await expect(diagram).not.toHaveAttribute("data-flow-selected");
      await expect(diagram).toHaveAttribute("data-figure-focus-quiet", "");
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
