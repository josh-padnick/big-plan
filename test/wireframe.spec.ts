// Browser tests of the wireframe reading journey: the drawing a reviewer
// meets, walking a prototype from one screen to another and back, the
// keyboard route through the same path, and the drawing holding its width on
// a narrow phone. Render-health failures are enforced by the fixtures module.

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

test("should hold the drawing inside a narrow phone viewport", async ({
  page,
  wireframeViewerUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(wireframeViewerUrl);
  const artboard = page.locator("[data-wireframe-viewport]").first();

  await test.step("the artboard reflows rather than widening the page", async () => {
    const box = await boxOf(artboard);
    expect(box.width).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  await test.step("the copy stays at reading size instead of shrinking", async () => {
    const fontSize = await artboard.evaluate(
      (node) => getComputedStyle(node).fontSize,
    );
    expect(Number.parseFloat(fontSize)).toBeGreaterThanOrEqual(14);
  });
});
