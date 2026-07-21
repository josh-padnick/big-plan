// Browser journey for HttpEndpoint's static API anatomy, palette distinctions,
// shared code controls, and complete no-JavaScript rendering.

import { expect, test } from "./fixtures";

test("should review HTTP endpoint contracts", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const endpoint = page
    .locator('[data-http-endpoint][data-http-method="POST"]')
    .first();

  await test.step("the endpoint header states the operation", async () => {
    await expect(endpoint).toBeVisible();
    await expect(endpoint.locator(".http-endpoint-method-pill")).toHaveText(
      "POST",
    );
    await expect(endpoint.locator(".http-endpoint-path")).toHaveText(
      "/api/plans/{planId}/comments",
    );
    await expect(endpoint).toContainText("Create a comment on a plan");
  });

  await test.step("methods and status classes use distinct palettes", async () => {
    const post = endpoint.locator(".http-endpoint-method-pill");
    const get = page
      .locator('[data-http-endpoint][data-http-method="GET"]')
      .first()
      .locator(".http-endpoint-method-pill");
    const success = endpoint
      .locator('[data-http-status-class="success"]')
      .first();
    const clientError = endpoint
      .locator('[data-http-status-class="client-error"]')
      .first();
    const colors = await Promise.all(
      [post, get, success, clientError].map((pill) =>
        pill.evaluate((element) => ({
          color: getComputedStyle(element).color,
          background: getComputedStyle(element).backgroundColor,
        })),
      ),
    );
    expect(colors[0]).not.toEqual(colors[1]);
    expect(colors[2]).not.toEqual(colors[3]);
  });

  await test.step("request and response examples receive copy controls", async () => {
    await expect(endpoint.locator("[data-code-block]")).toHaveCount(4);
    await expect(endpoint.locator("[data-copy-code]")).toHaveCount(4);
    for (const button of await endpoint.locator("[data-copy-code]").all()) {
      await expect(button).toHaveAccessibleName("Copy code");
    }
  });

  await test.step("the complete card reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticEndpoint = staticPage
      .locator('[data-http-endpoint][data-http-method="POST"]')
      .first();
    await expect(staticEndpoint).toBeVisible();
    await expect(staticEndpoint).toContainText("Parameters");
    await expect(staticEndpoint).toContainText("Request");
    await expect(staticEndpoint).toContainText("Responses");
    await expect(staticEndpoint.locator("pre code").first()).toContainText(
      '"body"',
    );
    await expect(staticEndpoint.locator("[data-copy-code]")).toHaveCount(4);
    await context.close();
  });
});
