// Browser journey for GrpcMethod's streaming-aware signature, palette hooks,
// grouped field sections, and complete inert rendering.

import { expect, test } from "./fixtures";

test("should review a gRPC method contract", async ({
  browser,
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const method = page
    .locator('[data-grpc-method][data-grpc-kind="serverStreaming"]')
    .first();

  await test.step("the header shows the service and the streaming signature", async () => {
    await expect(method).toBeVisible();
    await expect(method).toContainText("bigplan.v1.CommentService");
    await expect(method.locator(".grpc-method-signature")).toHaveText(
      "rpc WatchComments(WatchCommentsRequest) returns (stream Comment)",
    );
    await expect(method.locator(".grpc-method-kind-pill")).toHaveText(
      "Server streaming",
    );
  });

  await test.step("the stream keyword is tinted apart from the plain signature", async () => {
    const stream = method.locator(".grpc-method-stream");
    await expect(stream).toHaveCount(1);
    const [streamColor, signatureColor] = await Promise.all([
      stream.evaluate((element) => getComputedStyle(element).color),
      method
        .locator(".grpc-method-signature")
        .evaluate((element) => getComputedStyle(element).color),
    ]);
    expect(streamColor).not.toEqual(signatureColor);
  });

  await test.step("fields group by side and the error carries its code pill", async () => {
    await expect(method).toContainText("WatchCommentsRequest");
    await expect(method).toContainText("Comment");
    await expect(method.locator('[data-grpc-error="NOT_FOUND"]')).toBeVisible();
    await expect(method.locator(".grpc-method-error-code")).toHaveText(
      "NOT_FOUND",
    );
  });

  await test.step("the proto fence ships without dead controls", async () => {
    await expect(method.locator("[data-copy-code]")).toHaveCount(0);
    await expect(method.locator("pre code").first()).toContainText(
      "rpc WatchComments",
    );
  });

  await test.step("the complete card reads without JavaScript", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await context.newPage();
    await staticPage.goto(componentsViewerUrl);
    const staticMethod = staticPage
      .locator('[data-grpc-method][data-grpc-kind="serverStreaming"]')
      .first();
    await expect(staticMethod).toBeVisible();
    await expect(staticMethod).toContainText("gRPC status codes");
    await expect(staticMethod).toContainText("Proto");
    await expect(staticMethod.locator("pre code").first()).toContainText(
      "rpc WatchComments",
    );
    await context.close();
  });
});
