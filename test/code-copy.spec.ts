// Browser tests of the code-copy control: copying the exact block text, and
// the visible success and failure feedback around it.
// Render-health failures are enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should copy the exact code-block text", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(sampleViewerUrl);
  const copyButton = page.locator("[data-copy-code]").first();
  const copyMessage = copyButton
    .locator("xpath=ancestor::*[@data-code-block]")
    .locator("[data-copy-message]");

  await test.step("the clipboard is stubbed to capture what gets written", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => {
            document.body.dataset.copiedText = value;
            return Promise.resolve();
          },
        },
      });
    });
  });

  await test.step("clicking copy writes the block's exact text", async () => {
    const expectedText = await page.locator("pre code").first().textContent();
    await expect(copyButton).toHaveAccessibleName("Copy code");
    await copyButton.click();
    expect(await page.locator("body").getAttribute("data-copied-text")).toBe(
      expectedText,
    );
  });

  await test.step("the button announces success and swaps to the check icon", async () => {
    await expect(copyButton).toHaveAccessibleName("Code copied");
    await expect(copyButton.locator('[data-lucide="copy"]')).toBeHidden();
    await expect(copyButton.locator('[data-lucide="check"]')).toBeVisible();
    await expect(copyMessage).toBeVisible();
    await expect(copyMessage).toHaveText("Copied!");
    await expect(copyButton).not.toBeFocused();
  });

  await test.step("the copied message fits beside the button without widening the page", async () => {
    const copiedStateFits = await page.evaluate(() => {
      const wrapper = document.querySelector("[data-code-block]");
      const message = wrapper?.querySelector("[data-copy-message]");
      const button = wrapper?.querySelector("[data-copy-code]");
      if (wrapper === null || wrapper === undefined || message === null ||
          message === undefined || button === null || button === undefined) {
        return false;
      }
      const wrapperBox = wrapper.getBoundingClientRect();
      const messageBox = message.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      const centerDelta = Math.abs(
        messageBox.top + messageBox.height / 2 -
          (buttonBox.top + buttonBox.height / 2),
      );
      return messageBox.left >= wrapperBox.left &&
        messageBox.right <= buttonBox.left &&
        centerDelta <= 0.5 &&
        document.documentElement.scrollWidth === document.documentElement.clientWidth;
    });
    expect(copiedStateFits).toBe(true);
  });
});

test("should show and reset a visible message when copying fails", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  const copyButton = page.locator("[data-copy-code]").first();
  const copyMessage = copyButton
    .locator("xpath=ancestor::*[@data-code-block]")
    .locator("[data-copy-message]");

  await test.step("every copy mechanism is stubbed to fail", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
      document.execCommand = () => false;
    });
  });

  await test.step("clicking copy announces the failure without swapping icons", async () => {
    await copyButton.click();
    await expect(copyButton).toHaveAccessibleName("Could not copy code");
    await expect(copyMessage).toBeVisible();
    await expect(copyMessage).toHaveText("Could not copy");
    await expect(copyButton.locator('[data-lucide="copy"]')).toBeVisible();
    await expect(copyButton.locator('[data-lucide="check"]')).toBeHidden();
  });

  await test.step("the failure state resets so the reader can retry", async () => {
    await expect(copyButton).toHaveAccessibleName("Copy code", { timeout: 3_000 });
    await expect(copyMessage).toBeHidden();
  });
});
