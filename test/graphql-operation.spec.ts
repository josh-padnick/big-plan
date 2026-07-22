// Browser journey for GraphqlOperation's static card anatomy, kind palette,
// shared code controls, and complete no-JavaScript rendering.

import { expect, test } from "./fixtures";

test("should review a GraphQL operation contract", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
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

  await test.step("operation, variables, and response fences get copy controls", async () => {
    await expect(operation.locator("[data-copy-code]")).toHaveCount(3);
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
