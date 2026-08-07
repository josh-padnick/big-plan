// Critical browser journey for the local review runtime behind the React thin
// thread kernel: server-backed restoration and one real feedback handoff.

import { readFile, stat } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("should restore and send notes through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  const firstBlock = page.locator("[data-block-kind='paragraph']").first();
  await firstBlock.hover();
  await firstBlock.getByRole("button", { name: "Add note" }).click();
  const composer = page.getByRole("dialog", { name: /Comment on/ });
  await composer.getByLabel("Your note").fill("Clarify the failure boundary.");
  await composer.getByRole("button", { name: "Add note" }).click();

  const kernel = page.getByRole("complementary", { name: "Review notes" });
  await expect(kernel).toContainText("Clarify the failure boundary.");
  await expect(kernel).toContainText("Note saved locally.");

  await page.reload();
  await page.getByRole("button", { name: "Add review comment" }).click();
  await expect(kernel).toContainText("Clarify the failure boundary.");

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await kernel.getByRole("button", { name: "Send notes" }).click();
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

  await expect(kernel).toContainText("1 note handed off.");
  await expect(
    kernel.getByRole("button", { name: "Send notes" }),
  ).toBeDisabled();
});
