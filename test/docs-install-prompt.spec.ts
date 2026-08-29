// Proves the built docs homepage delivers the install prompt as an accessible
// native dialog with a complete copy and keyboard interaction contract.

import { expect, test } from "./fixtures";

const AGENT_SETUP_PROMPT =
  "Set up Big Plan for me: read https://big-plan.ai/setup.md and follow it.";

test("should deliver the install prompt when opened from the built homepage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as typeof window & { __bigPlanCopiedPrompt?: string }
          ).__bigPlanCopiedPrompt = text;
        },
      },
    });
  });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Install now" });
  const dialog = page.getByRole("dialog", {
    name: "Give this to your coding agent",
  });
  await trigger.click();

  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(AGENT_SETUP_PROMPT, { exact: true }),
  ).toBeVisible();

  const installationLink = dialog.getByRole("link", {
    name: "Or install it yourself",
  });
  await installationLink.focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  await dialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(dialog.getByRole("button", { name: "Copied!" })).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText(
    "Prompt copied to clipboard.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __bigPlanCopiedPrompt?: string })
            .__bigPlanCopiedPrompt,
      ),
    )
    .toBe(AGENT_SETUP_PROMPT);
  await expect(installationLink).toHaveAttribute(
    "href",
    "/intro/installation/",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
