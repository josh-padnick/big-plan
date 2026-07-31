// Browser tests of the wireframe reading journey: the drawing a reviewer
// meets, walking a prototype from one screen to another and back, the
// keyboard route through the same path, and true-size drawings scaling into
// the review surface. Render-health failures are enforced by the fixtures.

import { boxOf, expect, test } from "./fixtures";

test("should walk the wireframe prototype between screens", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const wireframe = page.locator("[data-wireframe]");
  const home = page.locator('[data-wireframe-screen="child-home"]');
  const lesson = page.locator('[data-wireframe-screen="loan-lesson"]');

  await test.step("the initial screen is the one drawn", async () => {
    await expect(home).toBeVisible();
    await expect(lesson).toBeHidden();
    await expect(home).toContainText("Hi, Eddy!");
    await expect(home).toContainText("$42.50");
  });

  await test.step("an action inside the drawing moves the prototype", async () => {
    await page.getByRole("button", { name: "Start lesson" }).click();
    await expect(lesson).toBeVisible();
    await expect(home).toBeHidden();
    await expect(lesson).toContainText("Borrow now, repay later");
  });

  await test.step("the screen switcher follows the walk", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await expect(
      switcher.getByRole("button", { name: "Loan lesson" }),
    ).toHaveAttribute("aria-current", "true");
  });

  await test.step("the prototype walks back the way it came", async () => {
    await page.getByRole("button", { name: "I understand" }).click();
    await expect(home).toBeVisible();
    await expect(lesson).toBeHidden();
  });

  await test.step("the switcher jumps straight to any screen", async () => {
    const switcher = page.getByRole("navigation", {
      name: "Prototype screens",
    });
    await switcher.getByRole("button", { name: "Loan lesson" }).click();
    await expect(lesson).toBeVisible();
  });

  await test.step("the drawing carries no script of its own", async () => {
    await expect(wireframe.locator("script")).toHaveCount(0);
  });
});

test("should reach every prototype action from the keyboard", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.goto(wireframeViewerUrl);
  const lesson = page.locator('[data-wireframe-screen="loan-lesson"]');

  const action = page.getByRole("button", { name: "Start lesson" });
  await action.focus();
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(lesson).toBeVisible();
});

test("should scale a true-size drawing inside a narrow review viewport", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(wireframeViewerUrl);
  const artboard = page.locator(".wireframe-artboard").first();

  await test.step("the artboard keeps device geometry without widening the page", async () => {
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1112);
    const box = await boxOf(artboard);
    expect(box.width).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  await test.step("the drawing scales as a unit instead of reflowing its copy", async () => {
    const fontSize = await artboard.evaluate(
      (node) => getComputedStyle(node).fontSize,
    );
    expect(Number.parseFloat(fontSize)).toBeGreaterThanOrEqual(14);
  });
});

test("should preserve the captain's desktop and phone measurements", async ({
  page,
  wireframeFormFactorsViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(wireframeFormFactorsViewerUrl);

  await test.step("desktop drawings borrow width but stop at the shared cap", async () => {
    const desktop = page.locator('[data-wireframe-screen="d-ticket"]');
    const artboard = desktop.locator(".wireframe-artboard");
    const frame = desktop.locator(".wireframe-frame");
    await expect
      .poll(() => artboard.evaluate((node) => node.clientWidth))
      .toBe(1440);
    expect((await boxOf(frame)).width).toBeLessThanOrEqual(920);
  });

  await test.step("selection does not indent the selected queue row", async () => {
    const desktop = page.locator('[data-wireframe-screen="d-ticket"]');
    const selected = desktop.locator(
      ".wireframe-list-item[data-wireframe-selected] .wireframe-list-label",
    );
    const following = desktop
      .locator(".wireframe-list-item:not([data-wireframe-selected])")
      .first()
      .locator(".wireframe-list-label");
    expect((await boxOf(selected)).x).toBeCloseTo(
      (await boxOf(following)).x,
      1,
    );
  });

  await test.step("phone controls retain measured touch targets", async () => {
    await page
      .getByRole("navigation", { name: "Prototype screens" })
      .last()
      .getByRole("button", { name: "Phone · Inbox" })
      .click();
    const phone = page.locator('[data-wireframe-screen="m-inbox"]');
    await expect(phone).toBeVisible();
    expect(
      (await boxOf(phone.locator(".wireframe-list-item").first())).height,
    ).toBeGreaterThanOrEqual(52);
    expect(
      (await boxOf(phone.locator(".wireframe-button").first())).height,
    ).toBeGreaterThanOrEqual(44);
    await expect(phone.locator(".wireframe-bottom-bar")).toBeVisible();
    await expect(phone.locator(".wireframe-app-shell")).toHaveCount(0);
  });
});

test("should size a short artboard to content instead of device height", async ({
  page,
  wireframeShortContentViewerUrl,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(wireframeShortContentViewerUrl);
  const artboard = page.locator(".wireframe-artboard");

  expect(await artboard.evaluate((node) => node.clientHeight)).toBeLessThan(
    400,
  );
  expect(await artboard.evaluate((node) => node.clientWidth)).toBe(1440);
});
