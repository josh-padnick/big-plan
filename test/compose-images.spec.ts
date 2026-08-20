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

const dropPng = async (composer: Locator, name: string) => {
  await composer.evaluate(
    (element, value) => {
      const bytes = Uint8Array.from(atob(value.encoded), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], value.name, { type: "image/png" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      element.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          dataTransfer: transfer,
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

const openSlideCommentComposer = async (page: Page) => {
  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const dialog = page.getByRole("dialog", { name: /Comment on/u });
  const submitRightAway = dialog.getByRole("switch", {
    name: "Submit right away",
  });
  if ((await submitRightAway.getAttribute("aria-checked")) === "true") {
    await submitRightAway.click();
  }
  return {
    composer: dialog.getByLabel("Add a comment"),
    dialog,
  };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

test("should omit the file picker from every image composer", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const { composer, dialog } = await openSlideCommentComposer(page);
  const expectNoPicker = async (surface: Locator) => {
    await expect(
      surface.getByRole("button", { name: "Choose image" }),
    ).toHaveCount(0);
    await expect(surface.locator('input[type="file"]')).toHaveCount(0);
  };

  await expectNoPicker(dialog);
  await dialog.getByRole("button", { name: "About Submit right away" }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Send the comment to the agent immediately",
  );
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const commentBody = "Keep image capture on paste and drag-drop only.";
  await composer.fill(commentBody);
  await dialog.getByRole("button", { name: "Add Comment" }).click();

  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  const rail = page.getByRole("complementary", { name: "Feedback" });
  await rail.getByRole("tab", { name: "Chat" }).click();
  await expect(rail.getByLabel("Plan-wide chat")).toBeVisible();
  await expectNoPicker(rail);
  await rail.getByRole("tab", { name: "Comments" }).click();
  const sent = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
  expect((await sent).ok()).toBe(true);
  const thread = rail
    .locator("[data-review-sent-thread]")
    .filter({ hasText: commentBody });
  await thread
    .getByRole("button", { name: `Expand queued comment: ${commentBody}` })
    .click();
  await expect(thread.getByLabel("Reply to the agent")).toBeVisible();
  await expectNoPicker(thread);
});

test("should capture images through paste and drag-drop", async ({
  page,
  reviewRuntimeUrl,
}) => {
  const { composer } = await openChatComposer({ page, reviewRuntimeUrl });

  await pastePng(composer, "pasted.png");
  await expect(composer).toHaveValue(/review-image:/u);
  await dropPng(composer, "dropped.png");
  await expect(composer).toHaveValue(
    /review-image:[a-f0-9]{64}[^]*review-image:[a-f0-9]{64}/u,
  );
});

test("should keep text and refuse image bytes in a standalone file", async ({
  page,
  sampleViewerUrl,
}) => {
  await page.goto(sampleViewerUrl);
  const { composer, dialog } = await openSlideCommentComposer(page);
  const comment = "Keep this standalone text draft.";
  await composer.fill(comment);

  await pastePng(composer, "standalone.png");

  await expect(composer).toHaveValue(comment);
  await expect(
    dialog.getByText(
      "This plan is open without a live review session. The image was not attached. Start `big-plan review` to send changes.",
      { exact: true },
    ),
  ).toBeVisible();
});

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
  await pastePng(composer, "second.png");
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

test("should discard an image insertion after a comment composer unmounts", async ({
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
  await page.goto(reviewRuntimeUrl);
  const { composer, dialog } = await openSlideCommentComposer(page);
  const comment = "Save this before the image upload finishes.";
  await composer.fill(comment);
  await pastePng(composer, "pending-comment.png");
  await uploadStarted.promise;
  await expect(dialog.getByText("Uploading…", { exact: true })).toBeVisible();

  const draftPersisted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/drafts") &&
      response.request().method() === "PUT",
  );
  await dialog.getByRole("button", { name: "Add Comment" }).click();
  expect((await draftPersisted).ok()).toBe(true);
  await expect(dialog).toHaveCount(0);

  const uploadFinished = page.waitForResponse((response) =>
    response.url().endsWith("/api/review-images"),
  );
  uploadReleased.resolve();
  const uploadResponse = await uploadFinished;
  expect(uploadResponse.ok()).toBe(true);
  await uploadResponse.finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );

  await page.evaluate(() => {
    const fetchFromRuntime = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        window.location.href,
      );
      return ["/api/agent", "/api/progress", "/api/session"].includes(
        url.pathname,
      )
        ? Promise.reject(new TypeError("Failed to fetch"))
        : fetchFromRuntime(input, init);
    };
  });
  const banner = page.getByRole("alert").filter({
    hasText: "This tab lost contact with this review session",
  });
  await expect(banner).toBeVisible({ timeout: 6_000 });
  await expect(banner.getByRole("button", { name: "Refresh" })).toBeEnabled();
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

  test("should suppress an upload failure after a comment composer unmounts", async ({
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
    await page.goto(reviewRuntimeUrl);
    const { composer, dialog } = await openSlideCommentComposer(page);
    await composer.fill("Save this before the failed upload returns.");
    await pastePng(composer, "failed-comment.png");
    await uploadStarted.promise;

    await dialog.getByRole("button", { name: "Add Comment" }).click();
    await expect(dialog).toHaveCount(0);
    const uploadFinished = page.waitForResponse((response) =>
      response.url().endsWith("/api/review-images"),
    );
    uploadReleased.resolve();
    const uploadResponse = await uploadFinished;
    await uploadResponse.finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        }),
    );

    await expect(
      page.getByText("Image storage is unavailable.", { exact: true }),
    ).toHaveCount(0);
    const next = await openSlideCommentComposer(page);
    await expect(
      next.dialog.getByText("Image storage is unavailable.", { exact: true }),
    ).toHaveCount(0);
  });
});
