// Proves the review service's unknown-address page hands work to an agent
// before relegating the terminal command to the manual path.

import {
  AGENT_SETUP_PROMPT,
  renderPlanUnknownPage,
} from "../dist/render/service-page.js";
import { expect, test } from "./fixtures";

test("should copy the agent prompt from the unknown review address", async ({
  page,
}) => {
  await page.setContent(renderPlanUnknownPage());
  await page.evaluate(() => {
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

  const startReview = page.getByRole("heading", { name: "Start a review" });
  const prompt = page.locator(".code-figure").filter({
    hasText: AGENT_SETUP_PROMPT,
  });
  await expect(startReview).toBeVisible();
  await expect(prompt.locator("code")).toHaveText(AGENT_SETUP_PROMPT);

  await prompt.getByRole("button", { name: "Copy prompt" }).click();
  await expect(
    prompt.getByRole("button", { name: "Copied prompt" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __bigPlanCopiedPrompt?: string })
            .__bigPlanCopiedPrompt,
      ),
    )
    .toBe(AGENT_SETUP_PROMPT);

  await expect(page.getByText("Or run this yourself:")).toBeVisible();
  await expect(page.getByText("big-plan review <your-plan.mdx>")).toBeVisible();
});
