// Browser tests of the embed surface: the chromeless envelope reuses the
// viewer's full-screen dialog while a cross-frame handshake lets the host
// page expand the iframe into a viewport-covering overlay, and the copy
// feedback stays visible inside a height-fitted frame. Render-health
// failures are enforced by fixtures.

import { boxOf, expect, test } from "./fixtures";

test("should expand the host frame into a viewport overlay when the embed goes full screen", async ({
  page,
  embedHostUrl,
}) => {
  await page.goto(embedHostUrl);
  const hostFrame = page.locator("iframe[data-theme-frame]");
  const embed = page.frameLocator("iframe[data-theme-frame]");
  const expand = embed.locator("[data-diff-expand]");
  const dialog = embed.locator("dialog.component-dialog");
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("expected a page viewport");
  }
  const inlineBox = await boxOf(hostFrame);

  await test.step("the control opens the same modal dialog the viewer uses", async () => {
    await expand.click();
    await expect(dialog).toBeVisible();
    await expect(expand).toHaveAttribute("aria-label", "Exit full screen");
  });

  await test.step("the handshake expands the frame to cover the host viewport", async () => {
    await expect
      .poll(async () => await boxOf(hostFrame))
      .toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  });

  await test.step("closing via the control restores the inline frame", async () => {
    await expand.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => await boxOf(hostFrame)).toEqual(inlineBox);
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
    await expect(expand).toHaveAttribute("aria-label", "View diff full screen");
  });

  await test.step("Esc inside the frame closes the dialog and restores too", async () => {
    await expand.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => await boxOf(hostFrame)).toEqual(inlineBox);
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  });
});

test("should keep the dialog usable when no host is listening", async ({
  page,
  embedUrl,
}) => {
  // A standalone embed (or a non-ThemeFrame host) has nobody to expand the
  // frame; the dialog still opens, confined, and closes cleanly.
  await page.goto(embedUrl);
  const expand = page.locator("[data-diff-expand]");
  const dialog = page.locator("dialog.component-dialog");

  await expand.click();
  await expect(dialog).toBeVisible();
  await expand.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-code-diff]")).toBeVisible();
});

test("should keep the copy feedback fully visible when copying inside an embed", async ({
  page,
  embedUrl,
}) => {
  await page.goto(embedUrl);
  const diff = page.locator("[data-code-diff]");

  await test.step("copying from the actions menu confirms visibly", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    });
    await diff.getByRole("button", { name: "More actions" }).click();
    await diff.getByRole("menuitem", { name: "Copy diff" }).click();
  });

  await test.step("the feedback chip stays inside the embed's viewport", async () => {
    // The component hugs the top of the embed document, so a chip above the
    // header would land at a negative y and be clipped by the frame edge.
    const chip = diff.locator("[data-diff-copy-message]");
    await expect(chip).toBeVisible();
    const chipBox = await boxOf(chip);
    const buttonBox = await boxOf(
      diff.getByRole("button", { name: "More actions" }),
    );
    expect(chipBox.y).toBeGreaterThanOrEqual(0);
    expect(chipBox.y).toBeGreaterThan(buttonBox.y + buttonBox.height);
  });
});
