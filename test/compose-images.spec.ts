// Critical browser journeys for image composition ownership across pending
// uploads and externally controlled composer changes.

import { expect, test, type Locator, type Page } from "./fixtures";

const PASTED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const pastePng = async (composer: Locator, name: string) => {
  await composer.evaluate(
    (element, value) => {
      const bytes = Uint8Array.from(atob(value.encoded), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], value.name, { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      element.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          clipboardData: transfer,
        }),
      );
    },
    { encoded: PASTED_PNG_BASE64, name },
  );
};

const openChatComposer = async ({
  page,
  reviewRuntimeUrl,
}: {
  readonly page: Page;
  readonly reviewRuntimeUrl: string;
}) => {
  await page.goto(reviewRuntimeUrl);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await rail.getByRole("tab", { name: "Chat" }).click();
  return {
    composer: rail.getByLabel("Plan-wide chat"),
    rail,
  };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

test("should refuse a second image capture while one is uploading", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const uploadStarted = deferred();
  const uploadReleased = deferred();
  let uploadRequestCount = 0;
  await page.route("**/api/review-images", async (route) => {
    uploadRequestCount += 1;
    uploadStarted.resolve();
    await uploadReleased.promise;
    await route.continue();
  });
  const { composer, rail } = await openChatComposer({
    page,
    reviewRuntimeUrl,
  });
  const question = "Keep this question while the image uploads.";
  await composer.fill(question);

  await pastePng(composer, "first.png");
  await uploadStarted.promise;
  await expect(rail.getByText("Uploading…", { exact: true })).toBeVisible();
  await rail.locator('input[type="file"]').setInputFiles({
    name: "second.png",
    mimeType: "image/png",
    buffer: Buffer.from(PASTED_PNG_BASE64, "base64"),
  });
  await expect(
    rail.getByText("Wait for the current image upload to finish.", {
      exact: true,
    }),
  ).toBeVisible();

  uploadReleased.resolve();
  await expect(rail.getByText("Uploading…", { exact: true })).toHaveCount(0);
  expect(uploadRequestCount).toBe(1);
  const body = await composer.inputValue();
  expect(body).toContain(question);
  expect(body.match(/review-image:/gu)).toHaveLength(1);
});

test("should discard an image insertion after the composer is sent", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const uploadStarted = deferred();
  const uploadReleased = deferred();
  await page.route("**/api/review-images", async (route) => {
    uploadStarted.resolve();
    await uploadReleased.promise;
    await route.continue();
  });
  const { composer, rail } = await openChatComposer({
    page,
    reviewRuntimeUrl,
  });
  const question = "Send this before the image upload finishes.";
  await composer.fill(question);
  await pastePng(composer, "pending.png");
  await uploadStarted.promise;

  await rail.getByRole("button", { name: "Send", exact: true }).click();
  const waitingChat = rail.locator("li").filter({ hasText: question });
  await expect(waitingChat).toBeVisible();
  await expect(composer).toHaveValue("");

  uploadReleased.resolve();
  await expect(rail.getByText("Uploading…", { exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue("");
});

test.describe("image upload failures", () => {
  test.use({ allowedConsoleErrors: [/Failed to load resource:.*503/u] });

  test("should report an image upload failure for the current composer", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    await page.route("**/api/review-images", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Image storage is unavailable." }),
      });
    });
    const { composer, rail } = await openChatComposer({
      page,
      reviewRuntimeUrl,
    });
    const question = "Keep this question after the failed upload.";
    await composer.fill(question);

    await pastePng(composer, "failed.png");

    await expect(
      rail.getByText("Image storage is unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(rail.getByText("Uploading…", { exact: true })).toHaveCount(0);
    await expect(composer).toHaveValue(question);
  });

  test("should suppress an upload failure after the composer is sent", async ({
    page,
    reviewRuntimeUrl,
  }) => {
    const uploadStarted = deferred();
    const uploadReleased = deferred();
    await page.route("**/api/review-images", async (route) => {
      uploadStarted.resolve();
      await uploadReleased.promise;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Image storage is unavailable." }),
      });
    });
    const { composer, rail } = await openChatComposer({
      page,
      reviewRuntimeUrl,
    });
    const question = "Send this before the failed upload returns.";
    await composer.fill(question);
    await pastePng(composer, "stale-failure.png");
    await uploadStarted.promise;

    await rail.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      rail.locator("li").filter({ hasText: question }),
    ).toBeVisible();
    await expect(composer).toHaveValue("");

    uploadReleased.resolve();
    await expect(rail.getByText("Uploading…", { exact: true })).toHaveCount(0);
    await expect(
      rail.getByText("Image storage is unavailable.", { exact: true }),
    ).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });
});
