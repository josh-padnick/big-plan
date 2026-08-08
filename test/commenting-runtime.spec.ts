// Critical browser journey for the local review runtime behind the React
// commenting chrome: server-backed restoration and one real feedback handoff.

import { readFile, stat } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  const slide = page.locator("[data-slide]").first();
  await slide.hover();
  await slide.getByRole("button", { name: "Comment on slide" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/ });
  await composer
    .getByLabel("Add a comment")
    .fill("Clarify the failure boundary.");
  await composer.getByRole("switch", { name: "Submit right away" }).click();
  await composer.getByRole("button", { name: "Submit Now" }).click();

  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("Comment staged locally.");

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail.getByRole("button", { name: "Submit all" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const answer: unknown = await response.json();
  if (
    typeof answer !== "object" ||
    answer === null ||
    !("package" in answer) ||
    !("brief" in answer) ||
    typeof answer.package !== "string" ||
    typeof answer.brief !== "string"
  ) {
    throw new Error("The feedback response did not name its output files");
  }
  expect((await stat(answer.package)).isFile()).toBe(true);
  expect((await stat(answer.brief)).isFile()).toBe(true);
  expect(await readFile(answer.brief, "utf8")).toContain(
    "Clarify the failure boundary.",
  );

  await expect(rail).toContainText("1 comment handed off.");
  await expect(rail.getByRole("button", { name: "Submit all" })).toBeDisabled();
});
