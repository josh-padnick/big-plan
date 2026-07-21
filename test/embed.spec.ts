// Browser tests of the embed surface: the chromeless envelope drives the
// components' full-screen control through the browser Fullscreen API and
// keeps the copy feedback visible inside a height-fitted frame.
// Render-health failures are enforced by fixtures.

import { boxOf, expect, test } from "./fixtures";

test("should enter and exit browser full screen when the embed's control is used", async ({
  page,
  embedUrl,
}) => {
  await page.goto(embedUrl);
  const diff = page.locator("[data-code-diff]");
  const expand = diff.locator("[data-diff-expand]");
  const fullscreenTag = () =>
    page.evaluate(() => document.fullscreenElement?.tagName ?? null);

  await test.step("the control is revealed and offers full screen", async () => {
    await expect(expand).toBeVisible();
    await expect(expand).toHaveAttribute("aria-label", "View diff full screen");
  });

  await test.step("the control fullscreens the component itself", async () => {
    await expand.click();
    await expect.poll(fullscreenTag).toBe("FIGURE");
    await expect(expand).toHaveAttribute("aria-label", "Exit full screen");
  });

  await test.step("the control exits back to the inline component", async () => {
    await expand.click();
    await expect.poll(fullscreenTag).toBe(null);
    await expect(expand).toHaveAttribute("aria-label", "View diff full screen");
    await expect(diff).toBeVisible();
  });

  await test.step("a browser-initiated exit (Esc's pathway) restores the control", async () => {
    // The browser handles Esc itself and only reports the exit through
    // fullscreenchange - the same event a synthetic exit raises here, since
    // the harness cannot deliver a trusted Esc to the browser chrome.
    await expand.click();
    await expect.poll(fullscreenTag).toBe("FIGURE");
    await page.evaluate(() => document.exitFullscreen());
    await expect(expand).toHaveAttribute("aria-label", "View diff full screen");
    await expect.poll(fullscreenTag).toBe(null);
  });
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
