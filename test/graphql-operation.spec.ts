// Browser journey for GraphqlOperation's static card anatomy, kind palette,
// code examples, and complete inert rendering.

import { expect, test } from "./fixtures";

test("should review a GraphQL operation contract", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (
            window as typeof window & {
              __bigPlanCopiedCode?: string;
            }
          ).__bigPlanCopiedCode = text;
        },
      },
    });
  });
  await page.goto(componentsViewerUrl);
  const operation = page
    .locator('[data-graphql-operation][data-graphql-kind="mutation"]')
    .first();

  await test.step("the header states the operation and its access", async () => {
    await expect(operation).toBeVisible();
    await expect(operation.locator(".graphql-operation-kind-pill")).toHaveText(
      "mutation",
    );
    await expect(operation).toContainText("commentCreate");
    await expect(operation).toContainText("Requires plan write access");
  });

  await test.step("the argument keeps its literal GraphQL type", async () => {
    const argument = operation.locator('[data-graphql-argument="input"]');
    await expect(argument).toContainText("CommentCreateInput!");
  });

  await test.step("the kind pill is tinted, not the neutral text color", async () => {
    const pill = operation.locator(".graphql-operation-kind-pill");
    const [pillColor, bodyColor] = await Promise.all([
      pill.evaluate((element) => getComputedStyle(element).color),
      operation.evaluate((element) => getComputedStyle(element).color),
    ]);
    expect(pillColor).not.toEqual(bodyColor);
  });

  await test.step("code examples expose working copy controls", async () => {
    const copyButtons = operation.locator("[data-copy-code]");
    await expect(copyButtons).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const copy = copyButtons.nth(index);
      await expect(copy).toBeVisible();
      await expect(copy).toBeEnabled();
    }
    const rendered = await operation.locator("pre code").first().textContent();
    const expected =
      rendered?.endsWith("\n") === true ? rendered.slice(0, -1) : rendered;
    await copyButtons.first().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __bigPlanCopiedCode?: string;
              }
            ).__bigPlanCopiedCode,
        ),
      )
      .toBe(expected);
    await expect(copyButtons.first()).toHaveAccessibleName("Copied code");
    await expect(operation.locator("pre code")).toHaveCount(3);
  });

  await test.step("the complete card reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticOperation = staticPage
      .locator('[data-graphql-operation][data-graphql-kind="mutation"]')
      .first();
    await expect(staticOperation).toBeVisible();
    await expect(staticOperation).toContainText("Arguments");
    await expect(staticOperation).toContainText("Returns");
    await expect(staticOperation).toContainText("Operation");
    await expect(staticOperation).toContainText("Variables");
    await expect(staticOperation).toContainText("Response");
    await expect(staticOperation.locator("pre code").first()).toContainText(
      "mutation commentCreate",
    );
    await context.close();
  });
});
