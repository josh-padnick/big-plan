// Browser journey for CodeSnippet's two captain-feedback fixes: the number
// rail reveals only while maximized when showLineNumbers is unset, carrying
// the authored file-absolute numbering, and declared-language tokens carry
// real color in both themes.

import { expect, test } from "./fixtures";

test("should reveal line numbers only while maximized and keep them highlighted", async ({
  page,
  codeSnippetSyntaxMaximizeViewerUrl,
}) => {
  await page.goto(codeSnippetSyntaxMaximizeViewerUrl);

  const frame = page.locator("[data-code-snippet]").first();
  const numberRail = frame.locator(".code-snippet-line-number").first();
  const trigger = frame.locator("[data-figure-maximize]");

  await expect(frame).not.toHaveAttribute("data-line-numbers");
  await expect(numberRail).toBeAttached();
  await expect(numberRail).toBeHidden();

  await trigger.click();
  await expect(frame).toHaveAttribute("data-figure-maximized", "");
  await expect(numberRail).toBeVisible();
  await expect(numberRail).toHaveText("42");

  await trigger.click();
  await expect(frame).not.toHaveAttribute("data-figure-maximized");
  await expect(numberRail).toBeHidden();
});

test("should highlight declared-language tokens with a non-default color in both themes", async ({
  page,
  codeSnippetSyntaxMaximizeViewerUrl,
}) => {
  await page.goto(codeSnippetSyntaxMaximizeViewerUrl);

  const frame = page.locator("[data-code-snippet]").first();

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);

    const plainColor = await frame
      .locator(".code-snippet-line-content")
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    await expect(frame.locator(".hljs-keyword").first()).toBeVisible();
    const keywordColor = await frame
      .locator(".hljs-keyword")
      .first()
      .evaluate((element) => getComputedStyle(element).color);
    const stringColor = await frame
      .locator(".hljs-string")
      .first()
      .evaluate((element) => getComputedStyle(element).color);

    expect(keywordColor).not.toBe(plainColor);
    expect(stringColor).not.toBe(plainColor);
    expect(keywordColor).not.toBe(stringColor);
  }
});
