// A photograph that lives beside the plan is plan content, so the reviewer has
// to see the picture itself. These journeys hold both halves of that promise:
// the picture a plan already carries, and the picture a real coding agent adds
// during the review. Alt text in place of a photograph is the failure this
// file exists to catch, so every assertion reads the decoded pixels rather
// than the element's presence.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startReviewRuntime } from "../src/review/server.js";
import {
  agentIdOf,
  expect,
  runAgentCli,
  stageComment,
  test,
  closeReviewRuntime,
} from "./fixtures";

// A small real photograph: baseline JPEG with the EXIF and Photoshop segments
// a camera or an editor leaves behind, so the fixture is the file kind an
// agent actually saves beside a plan.
const PHOTOGRAPH_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A0fCfwv8Aufuf0r0T/hV4/wCeP6V3HhPon4V6HWfHnEmL/tOp7x+f+GHFuO/sel7/APWh/9k=";

const PHOTOGRAPH_BYTES = Buffer.from(PHOTOGRAPH_JPEG_BASE64, "base64");

const PLAN_WITH_PHOTOGRAPH = `# Site survey

The survey records what the crew found on site.

## Evidence

The crew photographed the cabinet before any work started.

![The network cabinet before the work](./assets/cabinet.jpg)

The photograph settles the question of the existing cable route.
`;

const PLAN_WITHOUT_PHOTOGRAPH = `# Site survey

The survey records what the crew found on site.

## Evidence

The crew inspected the cabinet before any work started.

The written note leaves the cable route open to interpretation.
`;

test("should render a photograph stored beside the plan", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-photograph-"));
  const planPath = join(directory, "survey.mdx");
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "assets", "cabinet.jpg"), PHOTOGRAPH_BYTES);
  await writeFile(planPath, PLAN_WITH_PHOTOGRAPH, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);
    const photograph = page.getByRole("img", {
      name: "The network cabinet before the work",
    });
    await expect(photograph).toBeVisible();
    // A broken picture is still "visible" and still carries its alt words, so
    // the decoded width is what proves the reviewer sees the photograph.
    await expect
      .poll(() =>
        photograph.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);

    // The picture's comment control belongs in the margin between the picture
    // and the edge of the card, centred in it. Both appearances are measured,
    // because the rule is geometry the reader sees in either one.
    for (const viewport of [
      { name: "wide", width: 1280, height: 720 },
      { name: "narrow", width: 640, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const colorScheme of ["light", "dark"] as const) {
        await test.step(`the comment control stays centred in ${colorScheme} at ${viewport.name} width`, async () => {
          await page.emulateMedia({ colorScheme });
          const host = page.locator("[data-review-image-host]").first();
          await expect(host).toBeVisible();
          await expect
            .poll(() =>
              host.evaluate((element) => {
                const picture = element.previousElementSibling;
                const card =
                  element.closest("[data-slide]") ?? element.closest("article");
                if (picture === null || card === null) {
                  throw new Error("The picture or its card is missing");
                }
                const control = element.getBoundingClientRect();
                const controlCentre = control.left + control.width / 2;
                const midpoint =
                  (picture.getBoundingClientRect().right +
                    card.getBoundingClientRect().right) /
                  2;
                return Math.abs(controlCentre - midpoint);
              }),
            )
            .toBeLessThanOrEqual(1);
        });
      }
    }
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

test("should render a photograph a real agent adds during the review", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-photograph-agent-"));
  const planPath = join(directory, "survey.mdx");
  await writeFile(planPath, PLAN_WITHOUT_PHOTOGRAPH, "utf8");
  const runtime = await startReviewRuntime({ planPath });
  try {
    await page.goto(runtime.url);

    await test.step("the reviewer asks for the photograph", async () => {
      await stageComment(page, "Add the cabinet photograph here.");
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      const rail = page.getByRole("complementary", { name: "Feedback" });
      const send = rail.getByRole("button", {
        name: "Send all comments to agent",
      });
      await expect(send).toBeEnabled();
      await send.click();
      await expect(rail).toContainText("Add the cabinet photograph here.");
    });

    const claim = await runAgentCli(["next", planPath, "--wait"]);
    expect(claim.stdout).toContain("pending: true");
    const requestId = agentIdOf(claim.stdout, "requestId");
    const commentId = agentIdOf(claim.stdout, "- id");
    // Pickup mints the token proving this process holds the request.
    const agentToken = agentIdOf(claim.stdout, "agent_token");
    // The agent edits its own candidate; Big Plan writes the plan when the
    // answer publishes.
    const candidatePath = /candidate_plan: (\S+)/u.exec(claim.stdout)?.[1];
    if (candidatePath === undefined) {
      throw new Error(`The claim named no work: ${claim.stdout}`);
    }

    await test.step("the agent saves the photograph and revises the plan", async () => {
      await mkdir(join(directory, "assets"), { recursive: true });
      await writeFile(
        join(directory, "assets", "cabinet.jpg"),
        PHOTOGRAPH_BYTES,
      );
      await writeFile(
        candidatePath,
        PLAN_WITHOUT_PHOTOGRAPH.replace(
          "The written note leaves the cable route open to interpretation.",
          "![The network cabinet before the work](./assets/cabinet.jpg)\n\nThe photograph settles the question of the existing cable route.",
        ),
        "utf8",
      );
      const responsePath = join(directory, "response.json");
      await writeFile(
        responsePath,
        JSON.stringify({
          requestId,
          outcomes: [
            {
              commentId,
              state: "changed",
              message: "Added the cabinet photograph with its caption.",
              changeTargets: ["section/evidence/image-1"],
            },
          ],
        }),
        "utf8",
      );
      const response = await runAgentCli([
        "respond",
        planPath,
        responsePath,
        "--agent",
        agentToken,
      ]);
      expect(agentIdOf(response.stdout, "responded")).toBe(requestId);
    });

    const photograph = page.getByRole("img", {
      name: "The network cabinet before the work",
    });
    await expect(photograph).toBeVisible();
    await expect
      .poll(() =>
        photograph.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});
