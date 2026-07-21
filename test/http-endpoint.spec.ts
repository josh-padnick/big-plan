// Browser journey for HttpEndpoint's static API anatomy, palette distinctions,
// tabbed section navigation, shared code controls, and complete no-JavaScript
// rendering.

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

  await test.step("the sections fold behind a tab bar, first tab active", async () => {
    const tablist = endpoint.getByRole("tablist", {
      name: "Endpoint contract sections",
    });
    await expect(tablist).toBeVisible();
    const tabs = endpoint.getByRole("tab");
    await expect(tabs).toHaveText([
      "Path1",
      "Query1",
      "Headers1",
      "Body1",
      "Responses3",
      "Review",
    ]);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(
      endpoint.locator('[data-http-section="path-params"]'),
    ).toBeVisible();
    await expect(
      endpoint.locator('[data-http-section="responses"]'),
    ).toBeHidden();
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

  await test.step("the body tab states the media type and carries its copy control", async () => {
    await expect(endpoint.locator("[data-code-block]")).toHaveCount(4);
    await expect(endpoint.locator("[data-copy-code]")).toHaveCount(4);
    await endpoint.getByRole("tab", { name: "Body" }).click();
    const bodySection = endpoint.locator('[data-http-section="request-body"]');
    await expect(bodySection).toBeVisible();
    await expect(bodySection).toContainText("application/json");
    await expect(
      bodySection.locator(".card-section-label").first(),
    ).toBeHidden();
    await expect(bodySection.getByText("Example")).toBeVisible();
    await expect(bodySection.locator("[data-copy-code]")).toHaveAccessibleName(
      "Copy code",
    );
  });

  await test.step("the responses tab reveals every status", async () => {
    await endpoint.getByRole("tab", { name: "Responses" }).click();
    await expect(endpoint.locator("[data-http-response]")).toHaveCount(3);
    await expect(
      endpoint.locator('[data-http-section="request-body"]'),
    ).toBeHidden();
  });

  await test.step("the review tab holds the checklist and its task list", async () => {
    await endpoint.getByRole("tab", { name: "Review" }).click();
    await expect(endpoint.locator("[data-review-checklist]")).toBeHidden();
    const boxes = endpoint.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    await expect(boxes.first()).toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
  });

  await test.step("the complete card reads stacked without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticEndpoint = staticPage
      .locator('[data-http-endpoint][data-http-method="POST"]')
      .first();
    await expect(staticEndpoint).toBeVisible();
    await expect(staticEndpoint.getByRole("tab")).toHaveCount(0);
    await expect(staticEndpoint).toContainText("Path parameters");
    await expect(staticEndpoint).toContainText("Headers");
    await expect(staticEndpoint).toContainText("Request body");
    await expect(staticEndpoint).toContainText("Responses");
    await expect(staticEndpoint).toContainText("Review checklist");
    await expect(staticEndpoint.locator("pre code").first()).toContainText(
      '"body"',
    );
    await expect(staticEndpoint.locator("[data-copy-code]")).toHaveCount(4);
    await context.close();
  });
});

test("should present the catalog request as HTTP JSON", async ({
  page,
  httpEndpointViewerUrl,
}) => {
  await page.goto(httpEndpointViewerUrl);
  const endpoint = page.locator(
    '[data-http-endpoint][data-http-method="POST"]',
  );
  await endpoint.getByRole("tab", { name: "Body" }).click();
  const bodySection = endpoint.locator('[data-http-section="request-body"]');

  await expect(bodySection.locator("[data-http-body-type]")).toHaveCount(0);
  await expect(bodySection).toContainText("application/json");
  await expect(bodySection).toContainText("cacheKeys");
  await expect(bodySection.locator("pre code")).toContainText(
    '"catalog:eu:electronics"',
  );
});
