// Critical browser journey for the local review runtime behind the React
// commenting chrome: server-backed restoration and one real feedback handoff.

import { readFile, stat } from "node:fs/promises";
import { expect, stageComment, test } from "./fixtures";

test("should restore and submit staged comments through the local review runtime", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);

  await stageComment(page, "Clarify the failure boundary.");

  const rail = page.getByRole("complementary", { name: "Feedback" });
  await expect(rail).toBeHidden();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");
  await expect(rail).toContainText("1 · Details");
  await expect(rail).toContainText("Comment staged locally.");

  await page.reload();
  await page.getByRole("button", { name: /Feedback/ }).click();
  await expect(rail).toContainText("Clarify the failure boundary.");

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/feedback") &&
      response.request().method() === "POST",
  );
  await rail
    .getByRole("button", { name: "Send all comments to agent" })
    .click();
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
  await expect(
    rail.getByRole("button", { name: "Send all comments to agent" }),
  ).toBeDisabled();
});
