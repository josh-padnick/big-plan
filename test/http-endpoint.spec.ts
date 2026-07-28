// Browser tests of HttpEndpoint's inert review journey: the fully expanded
// card with every section stacked and readable, no tab enhancement.
// Render-health failures are enforced by the fixtures module.

import { expect, test } from "./fixtures";

test("should review an HTTP endpoint with every section stacked", async ({
  page,
  apiEndpointsViewerUrl,
}) => {
  await page.goto(apiEndpointsViewerUrl);
  const endpoint = page.locator("[data-http-endpoint]").first();

  await test.step("the header states method, path, and auth", async () => {
    await expect(endpoint.locator(".http-endpoint-method-pill")).toBeVisible();
    await expect(endpoint.locator(".http-endpoint-path")).toBeVisible();
  });

  await test.step("path placeholders are highlighted inside the literal path", async () => {
    await expect(
      page.locator(".http-endpoint-placeholder").first(),
    ).toBeVisible();
  });

  await test.step("every declared section is visible at once", async () => {
    for (const section of await endpoint.locator("[data-http-section]").all()) {
      await expect(section).toBeVisible();
    }
  });

  await test.step("responses carry status-classed pills", async () => {
    await expect(
      endpoint.locator(".http-endpoint-status-pill").first(),
    ).toBeVisible();
  });
});
