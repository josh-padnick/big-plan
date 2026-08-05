// Browser tests of the inert export's theme behavior: the document follows
// the OS color-scheme preference through CSS alone and ships no theme
// control. Render-health failures are enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should follow the system color scheme without a theme control", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(sampleViewerUrl);

  await test.step("no theme control ships in the inert export", async () => {
    await expect(
      page.getByRole("button", { name: /Use (?:light|dark) theme/ }),
    ).toHaveCount(0);
    await expect(page.locator("[data-theme-toggle]")).toHaveCount(0);
  });

  const lightBackground = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).backgroundColor);

  await test.step("code blocks use a quiet GitHub-like container", async () => {
    const codeBlock = page.locator("article pre").first();
    await expect(codeBlock).toHaveCSS("border-top-width", "0px");
    await expect(codeBlock).toHaveCSS("border-radius", "6px");
    await expect
      .poll(() =>
        codeBlock.evaluate(
          (node) =>
            getComputedStyle(node).backgroundColor !==
            getComputedStyle(document.body).backgroundColor,
        ),
      )
      .toBe(true);
  });

  await test.step("switching the OS preference reskins the document", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() =>
        page
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      )
      .not.toBe(lightBackground);
  });

  await test.step("code blocks keep their quiet contrast in dark mode", async () => {
    const codeBlock = page.locator("article pre").first();
    await expect(codeBlock).toHaveCSS("border-top-width", "0px");
    await expect
      .poll(() =>
        codeBlock.evaluate(
          (node) =>
            getComputedStyle(node).backgroundColor !==
            getComputedStyle(document.body).backgroundColor,
        ),
      )
      .toBe(true);
  });

  await test.step("returning to light restores the original palette", async () => {
    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(() =>
        page
          .locator("body")
          .evaluate((body) => getComputedStyle(body).backgroundColor),
      )
      .toBe(lightBackground);
  });
});
