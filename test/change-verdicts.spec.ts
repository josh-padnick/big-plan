// BIG-127. Proves that accepting a change is a review fact rather than
// something one browser remembers: it survives a reload and a runtime restart,
// it is readable on disk, and every surface that shows how much of the change
// set is still open agrees with every other one.
//
// BIG-201 adds the second verdict to the same journey. A rejection has to be
// as visible as an acceptance and as reversible: a reviewer who cannot see
// their rejection cannot tell it happened, and one who cannot undo it has been
// given a decision they cannot take back.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, startReviewRuntime, test, type Page } from "./fixtures";

const AFTER = `# Retry queue

## Delivery

The worker retries a failed job three times before it gives up.

## Rollback

Rolling back is a manual step the release engineer runs by hand.
`;

const BEFORE = AFTER.replace(
  "The worker retries a failed job three times before it gives up.",
  "The worker retries a failed job once before it gives up.",
).replace(
  "Rolling back is a manual step the release engineer runs by hand.",
  "Rolling back is automatic.",
);

const startPreviewRuntime = async (
  planPath: string,
  { takeover = false }: { readonly takeover?: boolean } = {},
) => {
  // Playwright wraps JSX values during source transformation, so component
  // journeys use the built renderer exactly as the shipped runtime does.
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  return startReviewRuntime(
    { planPath, diffPreviewSource: BEFORE, takeover },
    startCompiledRuntime,
  );
};

const openThread = async (page: Page, url: string): Promise<void> => {
  if (page.url() === `${url}/`) {
    // A stopped upstream invalidates the service's cached resolution on the
    // first attempt; the next request resolves the replacement runtime.
    await page.reload();
  }
  const verdicts = page.waitForResponse((response) =>
    response.url().endsWith("/api/change-verdicts"),
  );
  await page.goto(url);
  expect((await verdicts).ok()).toBe(true);
  await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
  await page
    .getByRole("complementary", { name: "Feedback" })
    .getByRole("button", { name: /Expand thread:/u })
    .first()
    .click();
};

const rail = (page: Page) =>
  page.getByRole("complementary", { name: "Feedback" });

const stepper = (page: Page) => page.locator("[data-review-diff-stepper]");

/** What the verdict record holds on disk, without going through a route. */
const recordedChanges = async (
  path: string,
): Promise<
  ReadonlyArray<{ readonly placeId: string; readonly verdict: string }>
> => {
  const stored: unknown = JSON.parse(await readFile(path, "utf8"));
  return typeof stored === "object" && stored !== null && "decided" in stored
    ? (stored.decided as ReadonlyArray<{
        readonly placeId: string;
        readonly verdict: string;
      }>)
    : [];
};

test("should keep an accepted change accepted across a reload and a restart", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-verdicts-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, AFTER);
  let runtime = await startPreviewRuntime(planPath);
  const verdictsPath = runtime.store.changeVerdictsPath;
  try {
    await openThread(page, runtime.url);
    const digest = rail(page).getByRole("button", {
      name: /changes across .* slides?/u,
    });
    // The change set holds two changes, which is what makes a partial count
    // observable rather than a set that goes from nothing to everything.
    await expect(digest).toContainText("2 changes across 2 slides");

    await test.step("accepting one change is recorded and counted once", async () => {
      const written = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/change-verdicts") &&
          response.request().method() === "POST",
      );
      await rail(page)
        .getByRole("button", { name: /Review changes \(2\)/u })
        .click();
      await expect(stepper(page)).toContainText("1 of 2");
      // The open change is presented as a proposal, which is the treatment the
      // acceptance below has to retire.
      await expect(page.locator("[data-review-diff-lens]")).toHaveCount(1);
      await stepper(page)
        .getByRole("button", { name: "Accept this change" })
        .click();
      expect((await written).ok()).toBe(true);
      await expect(digest.getByLabel("1 of 2 changes accepted")).toHaveText(
        "1/2",
      );
      expect(await recordedChanges(verdictsPath)).toHaveLength(1);
    });

    // BIG-14. An acceptance is an answer, so the plan stops asking: the change
    // reads as the plan's own content, and the evidence for it is one control
    // away rather than permanently in front of the reader.
    await test.step("an accepted change reads as plan content, with its evidence on request", async () => {
      await stepper(page)
        .getByRole("button", { name: "Previous change" })
        .click();
      await expect(stepper(page)).toContainText("1 of 2");
      await expect(stepper(page)).toContainText("Accepted");
      // Nothing of the proposal survives: no lens beside the block, no word
      // runs inside it, and the plan's own paragraph is what the reader meets.
      await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
      const acceptedPlace = page.locator("[data-review-accepted-place]");
      await expect(acceptedPlace).toHaveCount(1);
      await expect(acceptedPlace.locator("ins, del")).toHaveCount(0);
      await expect(acceptedPlace).toContainText(
        "The worker retries a failed job three times before it gives up.",
      );

      await stepper(page).getByRole("button", { name: "View changes" }).click();
      const lens = page.locator("[data-review-diff-lens]");
      await expect(lens).toContainText("What changed");
      await expect(lens.locator("del")).toContainText("once");
      await expect(lens.locator("ins").first()).toContainText("three");
      // Asking for the evidence does not reopen the change, and the record it
      // was recorded in is untouched by looking at it.
      await expect(stepper(page)).toContainText("Accepted");
      expect(await recordedChanges(verdictsPath)).toHaveLength(1);

      await stepper(page).getByRole("button", { name: "Hide changes" }).click();
      await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
      await expect(page.locator("[data-review-accepted-place]")).toHaveCount(1);
    });

    await test.step("the acceptance and the count survive a reload", async () => {
      await page.reload();
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      await rail(page)
        .getByRole("button", { name: /Expand thread:/u })
        .first()
        .click();
      // The count is the same number in the digest and in the stepper that
      // reviews the same set, because both read the one selector.
      await expect(digest.getByLabel("1 of 2 changes accepted")).toHaveText(
        "1/2",
      );
      // The stepper opens on the first change, and the acceptance it shows
      // there came from the store rather than from anything this page did.
      await rail(page).getByRole("button", { name: "Continue review" }).click();
      await expect(stepper(page)).toContainText("1 of 2");
      await expect(
        stepper(page).getByRole("button", {
          name: "Unaccept this change",
        }),
      ).toBeVisible();
    });

    await test.step("accepting the rest closes the set everywhere at once", async () => {
      await stepper(page).getByRole("button", { name: "Next change" }).click();
      // The page shows the acceptance before the runtime has stored it, so the
      // record on disk is read only once the write it came from has answered.
      const written = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/change-verdicts") &&
          response.request().method() === "POST",
      );
      await stepper(page)
        .getByRole("button", { name: "Accept this change" })
        .click();
      await expect(stepper(page)).toContainText(
        "All changes accepted (2 of 2)",
      );
      await expect(
        rail(page).locator("[data-review-changes-accepted]"),
      ).toContainText("Change set accepted");
      expect((await written).ok()).toBe(true);
      expect(await recordedChanges(verdictsPath)).toHaveLength(2);
    });

    await test.step("a restarted runtime serves the same closed change set", async () => {
      await runtime.close();
      runtime = await startPreviewRuntime(planPath);
      await openThread(page, runtime.url);
      await expect(
        rail(page).locator("[data-review-changes-accepted]"),
      ).toContainText("Change set accepted");
      await expect(
        rail(page).getByRole("button", { name: "Accept all" }),
      ).toHaveCount(0);
    });

    await test.step("undoing an acceptance reopens it durably", async () => {
      await rail(page)
        .getByRole("button", { name: /Review changes \(2\)/u })
        .click();
      const withdrawn = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/change-verdicts") &&
          response.request().method() === "POST",
      );
      await stepper(page)
        .getByRole("button", { name: "Back to review" })
        .click();
      await stepper(page)
        .getByRole("button", { name: "Unaccept this change" })
        .click();
      expect((await withdrawn).ok()).toBe(true);
      await expect(
        rail(page).locator("[data-review-changes-accepted]"),
      ).toHaveCount(0);
      expect(await recordedChanges(verdictsPath)).toHaveLength(1);

      await page.reload();
      await page.getByRole("button", { name: /^Feedback(?: \d+)?$/u }).click();
      await rail(page)
        .getByRole("button", { name: /Expand thread:/u })
        .first()
        .click();
      await expect(digest.getByLabel("1 of 2 changes accepted")).toHaveText(
        "1/2",
      );
    });

    await test.step("the stable address follows a replacement and keeps the verdict", async () => {
      // Superseding a session that is still live is exactly what --takeover is
      // for; without it the runtime yields to the session this page is reading.
      const replacement = await startPreviewRuntime(planPath, {
        takeover: true,
      });
      try {
        if (process.env["BIG_PLAN_PROXY"] === "0") {
          await expect(
            page.getByRole("button", { name: /Using read-only session/u }),
          ).toBeVisible();
          await expect(
            rail(page).getByRole("button", {
              name: "Accepting is unavailable because this page cannot record review state",
            }),
          ).toBeDisabled();
          expect(await recordedChanges(verdictsPath)).toHaveLength(1);
          return;
        }
        await expect
          .poll(() =>
            page.evaluate(async () => {
              const response = await fetch("api/session", {
                headers: {
                  "x-big-plan-review-token":
                    document.documentElement.dataset.reviewToken ?? "",
                },
              });
              const current: unknown = await response.json();
              return typeof current === "object" &&
                current !== null &&
                "sessionId" in current
                ? current.sessionId
                : undefined;
            }),
          )
          .toBe(replacement.sessionId);
        await page.reload();
        await expect(page).toHaveURL(`${runtime.url}/`);
        await page
          .getByRole("button", { name: /^Feedback(?: \d+)?$/u })
          .click();
        await rail(page)
          .getByRole("button", { name: /Expand thread:/u })
          .first()
          .click();
        await expect(digest.getByLabel("1 of 2 changes accepted")).toHaveText(
          "1/2",
        );
        expect(await recordedChanges(verdictsPath)).toHaveLength(1);
      } finally {
        await replacement.close();
      }
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("should show a rejected change and let the reviewer undo it", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-rejections-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, AFTER);
  const runtime = await startPreviewRuntime(planPath);
  const verdictsPath = runtime.store.changeVerdictsPath;
  try {
    await openThread(page, runtime.url);
    await expect(
      rail(page).getByRole("button", { name: /changes across .* slides?/u }),
    ).toContainText("2 changes across 2 slides");
    // Recording it through the runtime is what BIG-19's review bar will do
    // from the page; this journey is about what the surface shows once the
    // verdict exists, which is the half BIG-201 owns.
    const rejected = await page.evaluate(async () => {
      const token = document.documentElement.dataset.reviewToken ?? "";
      const headers = { "x-big-plan-review-token": token };
      const sets: {
        readonly changeSets: ReadonlyArray<Record<string, string>>;
      } = await (await fetch("api/change-sets", { headers })).json();
      const set = sets.changeSets[0];
      if (set === undefined) return false;
      const diff: { readonly places: ReadonlyArray<{ placeId: string }> } =
        await (
          await fetch(
            `api/snapshot-diff?from=${set.baseSnapshot}&to=${set.resultSnapshot}`,
            { headers },
          )
        ).json();
      const response = await fetch("api/change-verdicts", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          op: "reject",
          from: set.baseSnapshot,
          to: set.resultSnapshot,
          placeIds: diff.places.map((place) => place.placeId),
        }),
      });
      return response.ok;
    });
    expect(rejected).toBe(true);

    // The sidebar marks a rejected place the way it marks an accepted one,
    // and says how the set was closed rather than calling it accepted.
    await expect(
      rail(page).locator("[data-review-place-verdict='rejected']"),
    ).toHaveCount(2);
    await expect(
      rail(page).locator("[data-review-changes-accepted]"),
    ).toHaveCount(0);
    await expect(
      rail(page).locator("[data-review-changes-decided]"),
    ).toContainText("0 accepted, 2 rejected");

    // The plan shows the baseline where the change was, and nothing else
    // anywhere: an unanchored lens used to fall back to an archive at the foot
    // of the page, which put the rejected wording back on screen.
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job once before it gives up.",
    );
    await expect(
      page.locator("article").getByText("three times before it gives up"),
    ).toHaveCount(0);

    await rail(page)
      .getByRole("button", { name: /Review changes \(2\)/u })
      .click();
    await expect(stepper(page)).toContainText(
      "All changes decided (0 accepted, 2 rejected)",
    );
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await expect(page.locator("[data-review-historical-changes]")).toHaveCount(
      0,
    );
    await expect(
      stepper(page).getByRole("button", { name: "View changes" }),
    ).toHaveCount(0);
    const undone = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/change-verdicts") &&
        response.request().method() === "POST",
    );
    await stepper(page).getByRole("button", { name: "Back to review" }).click();
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    expect((await undone).ok()).toBe(true);
    // Undecided again, and open to either verdict: the control that replaces
    // Undo is the one that offers the other answer.
    await expect(
      stepper(page).getByRole("button", { name: "Accept this change" }),
    ).toBeVisible();
    expect(
      (await recordedChanges(verdictsPath)).filter(
        (entry) => entry.verdict === "rejected",
      ),
    ).toHaveLength(1);

    const stepperAccepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/change-verdicts") &&
        response.request().method() === "POST",
    );
    await stepper(page)
      .getByRole("button", { name: "Accept all changes" })
      .click();
    expect((await stepperAccepted).ok()).toBe(true);
    expect(await recordedChanges(verdictsPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verdict: "accepted" }),
        expect.objectContaining({ verdict: "rejected" }),
      ]),
    );
    await expect(page.locator("article")).toContainText(
      "Rolling back is automatic.",
    );
    await expect(page.locator("article")).not.toContainText(
      "Rolling back is a manual step the release engineer runs by hand.",
    );

    const unaccepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/change-verdicts") &&
        response.request().method() === "POST",
    );
    await stepper(page).getByRole("button", { name: "Back to review" }).click();
    await stepper(page)
      .getByRole("button", { name: "Unaccept this change" })
      .click();
    expect((await unaccepted).ok()).toBe(true);
    await stepper(page).getByRole("button", { name: "Exit review" }).click();

    const railAccepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/change-verdicts") &&
        response.request().method() === "POST",
    );
    await rail(page)
      .getByRole("button", { name: "Accept all changes" })
      .click();
    expect((await railAccepted).ok()).toBe(true);
    expect(await recordedChanges(verdictsPath)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ verdict: "accepted" }),
        expect.objectContaining({ verdict: "rejected" }),
      ]),
    );
    await expect(page.locator("article")).toContainText(
      "Rolling back is automatic.",
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
