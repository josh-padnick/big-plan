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
import {
  closeReviewRuntime,
  expect,
  startReviewRuntime,
  test,
  type Page,
} from "./fixtures";

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
          name: "Undo acceptance for this change",
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
      await expect(stepper(page)).toContainText("All changes decided");
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
      // Accept-all lives only inside the stepper's overflow menu, so no
      // surface carries a standalone control for it.
      await expect(
        page.getByRole("button", { name: "Accept all" }),
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
        .getByRole("button", { name: "Undo acceptance for this change" })
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
          await rail(page)
            .getByRole("button", { name: "Continue review" })
            .click();
          const unavailableVerdicts = stepper(page).getByRole("button", {
            name: "Accepting is unavailable because this page cannot record review state",
          });
          await expect(unavailableVerdicts).toHaveCount(2);
          await expect(unavailableVerdicts.first()).toBeDisabled();
          await expect(unavailableVerdicts.last()).toBeDisabled();
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
    await expect(stepper(page)).toContainText("All changes decided");
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
      .getByRole("button", { name: "More change set actions" })
      .click();
    await page.getByRole("menuitem", { name: "Accept all changes" }).click();
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
      .getByRole("button", { name: "Undo acceptance for this change" })
      .click();
    expect((await unaccepted).ok()).toBe(true);

    const reaccepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/change-verdicts") &&
        response.request().method() === "POST",
    );
    await stepper(page)
      .getByRole("button", { name: "More change set actions" })
      .click();
    await page.getByRole("menuitem", { name: "Accept all changes" }).click();
    expect((await reaccepted).ok()).toBe(true);
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

// BIG-19. The review bar is the one surface a reviewer answers a change from,
// so this walks the whole of it: both verdicts per change, undo of each, the
// overflow that decides the set at once, and the thread deletion that settles
// whatever is left. The last one is the load-bearing case - it must reject
// what nobody decided while leaving what was accepted in the plan.
test("should decide, undo, and delete a thread from the review bar", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-review-bar-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, AFTER);
  const runtime = await startPreviewRuntime(planPath);
  const verdictsPath = runtime.store.changeVerdictsPath;
  try {
    await openThread(page, runtime.url);
    await rail(page)
      .getByRole("button", { name: /Review changes \(2\)/u })
      .click();
    await expect(stepper(page)).toContainText("1 of 2");

    // A rejection is a per-change answer from the bar, and it moves the plan:
    // the baseline comes back where the change was.
    await stepper(page)
      .getByRole("button", { name: "Reject this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job once before it gives up.",
      { timeout: 15_000 },
    );

    // Undo takes back either verdict and leaves the change open to the other,
    // so the same place is answered the opposite way straight afterwards.
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job three times before it gives up.",
      { timeout: 15_000 },
    );
    await stepper(page)
      .getByRole("button", { name: "Accept this change" })
      .click();
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await stepper(page)
      .getByRole("button", { name: "Undo acceptance for this change" })
      .click();
    await expect(
      stepper(page).getByRole("button", { name: "Accept this change" }),
    ).toBeVisible();
    await expect
      .poll(async () => (await recordedChanges(verdictsPath)).length)
      .toBe(0);

    // Both whole-set answers live behind the overflow, and nowhere else.
    await expect(
      page.getByRole("button", { name: "Accept all", exact: true }),
    ).toHaveCount(0);
    await stepper(page)
      .getByRole("button", { name: "More change set actions" })
      .click();
    const menu = page.getByRole("menu", { name: "More change set actions" });
    await expect(
      menu.getByRole("menuitem", { name: "Accept all changes" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Reject all changes" }),
    ).toBeVisible();
    await menu.getByRole("menuitem", { name: "Reject all changes" }).click();
    await expect(stepper(page)).toContainText("All changes decided");
    await stepper(page).getByRole("button", { name: "Back to review" }).click();
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    await stepper(page).getByRole("button", { name: "Next change" }).click();
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    await expect
      .poll(async () => (await recordedChanges(verdictsPath)).length)
      .toBe(0);

    // One change accepted, one left undecided: deleting the thread has to
    // answer only the second of those.
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await stepper(page)
      .getByRole("button", { name: "Accept this change" })
      .click();
    await expect(stepper(page)).toContainText("2 of 2");
    await stepper(page)
      .getByRole("button", { name: "More change set actions" })
      .click();
    await page.getByRole("menuitem", { name: "Delete thread" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Delete this thread?",
    });
    await expect(dialog).toContainText(
      "Deleting this thread permanently removes it, and permanently deletes the following content from the plan.",
    );
    await expect(dialog).toContainText(
      "Changes you already accepted stay in the plan.",
    );
    // The warning names only what is going: the accepted change is not on it.
    const loss = dialog.locator("[data-review-plan-loss]");
    await expect(loss).toContainText("1 change on one slide");
    await loss.locator("[data-review-loss-slide]").getByRole("button").click();
    await expect(loss).toContainText("Rolling back is a manual step");
    await expect(loss).not.toContainText("three times before it gives up");
    await dialog.getByRole("button", { name: "Delete thread" }).click();

    // The accepted change stayed; the undecided one was rejected out of the
    // plan; the thread itself is gone.
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job three times before it gives up.",
      { timeout: 15_000 },
    );
    await expect(page.locator("article")).toContainText(
      "Rolling back is automatic.",
      { timeout: 15_000 },
    );
    await expect(
      rail(page).getByRole("button", { name: /Expand thread:/u }),
    ).toHaveCount(0);
    const recorded = await recordedChanges(verdictsPath);
    expect(
      recorded.filter((entry) => entry.verdict === "accepted"),
    ).toHaveLength(1);
    expect(
      recorded.filter((entry) => entry.verdict === "rejected"),
    ).toHaveLength(1);
  } finally {
    await closeReviewRuntime({ page, runtime });
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-19 round 2. The defect this guards is a rendering, not a record: a lens
// whose block is briefly absent from the article drew itself into the
// historical archive at the foot of the page, so a change the reviewer was
// looking at appeared below the whole plan. It is the same shape as every
// earlier instance of this class - a resolver reading "not in the DOM" as
// "not in the plan" - and the fix is that absence stops being one answer.
//
// The condition needs a change that adds a block the baseline does not have:
// rejecting it takes the block out of the article entirely, and undoing that
// rejection asks for a lens on a block the article has not got back yet.
const ADDED_BLOCK_AFTER = `# Retry queue

The queue keeps a failed job alive across a worker restart.

## Delivery

The worker retries a failed job three times before it gives up.

## Operator view

The queue page lists every waiting job with its attempt count, so an operator
can tell a slow queue from a stuck one.
`;

// The whole slide is what the change adds, so rejecting it takes every block
// the lens could anchor on out of the article at once - which is the state
// that used to send the lens to the foot of the page.
const ADDED_BLOCK_BEFORE = `# Retry queue

The queue keeps a failed job alive across a worker restart.

## Delivery

The worker retries a failed job three times before it gives up.
`;

test("should never draw a change below the plan while the article catches up", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-lens-lag-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, ADDED_BLOCK_AFTER);
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startReviewRuntime(
    { planPath, diffPreviewSource: ADDED_BLOCK_BEFORE },
    startCompiledRuntime,
  );
  try {
    await openThread(page, runtime.url);
    await rail(page)
      .getByRole("button", { name: /Review change/u })
      .click();
    await expect(stepper(page)).toContainText("Reviewing change set");

    // Rejecting takes the added paragraph out of the plan entirely.
    await stepper(page)
      .getByRole("button", { name: "Reject this change" })
      .click();
    await expect(page.locator("article")).not.toContainText(
      "The queue page lists every waiting job",
      { timeout: 15_000 },
    );

    // The archive is watched across the undo rather than checked after it: the
    // defect only ever existed while the swap was in flight, and holding the
    // article back is what makes that window wide enough to stand inside on a
    // machine where a local round trip is a few milliseconds.
    await page.evaluate(() => {
      const sightings: Array<string> = [];
      const observer = new MutationObserver(() => {
        const archive = document.querySelector(
          "[data-review-historical-changes]",
        );
        if (archive !== null) sightings.push(archive.textContent ?? "");
      });
      observer.observe(document.body, { childList: true, subtree: true });
      Object.assign(window, { bigPlanArchiveSightings: sightings });
    });
    await page.route(`${runtime.url}/`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await stepper(page).getByRole("button", { name: "Back to review" }).click();
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The queue page lists every waiting job",
      { timeout: 15_000 },
    );
    await page.unroute(`${runtime.url}/`);

    // Never below the plan, and back where it belongs once the article lands.
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { bigPlanArchiveSightings: Array<string> })
            .bigPlanArchiveSightings,
      ),
    ).toEqual([]);
    await expect(page.locator("[data-review-historical-changes]")).toHaveCount(
      0,
    );
    await expect(page.locator("[data-review-diff-lens]")).toBeVisible();
    // The page polls this runtime, so it is taken off it before the runtime
    // goes; otherwise teardown races the polls and the console fills with
    // refusals from a server that is already closing.
    await page.goto("about:blank");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// Filler the change set never touches, so the plan is long enough that a reader
// who scrolls away really does leave the change behind. Without it, "took the
// reader back" is unfalsifiable: every change is on screen from anywhere.
const REVEAL_FILLER = `
## Verification

We replay a recorded burst of failing jobs against a worker that restarts
halfway through, and assert that every job either completes or is still listed
as waiting.

## Rollout

The change ships behind a flag for one release. Operators turn it on per queue,
watch the waiting list for a day, then turn it on everywhere.

## Out of scope

Retry policy per job type, dead-letter queues, and the operator alerting rules
all stay as they are.
`;

const REVEAL_AFTER = `${AFTER}${REVEAL_FILLER}`;
const REVEAL_BEFORE = `${BEFORE}${REVEAL_FILLER}`;

// BIG-19 round 3. Three things the bar owes a reviewer once it carries both
// verdicts: an undo that puts the change back in front of them, an accepted
// change that reads as the plan even after the plan moved past it, and a way
// into the conversation that does not require abandoning the review first.
test("should reveal an undone change, keep an accepted one as plan content, and reach the thread", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-review-bar-r3-"));
  const planPath = join(directory, "plan.mdx");
  await writeFile(planPath, REVEAL_AFTER);
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startReviewRuntime(
    { planPath, diffPreviewSource: REVEAL_BEFORE },
    startCompiledRuntime,
  );
  try {
    // A viewport the plan scrolls well past, so "took the reader back" is a
    // claim the test can actually make.
    await page.setViewportSize({ width: 1_280, height: 620 });
    await openThread(page, runtime.url);
    await rail(page)
      .getByRole("button", { name: /Review changes \(2\)/u })
      .click();
    await expect(stepper(page)).toContainText("Reviewing change set");

    // Rejecting takes the change out of the plan, so undoing it puts content
    // back - and the reader may have scrolled anywhere in between.
    await stepper(page)
      .getByRole("button", { name: "Reject this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job once before it gives up.",
      { timeout: 15_000 },
    );
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await page.evaluate(() => window.scrollTo({ top: 1e6, behavior: "auto" }));
    await stepper(page)
      .getByRole("button", { name: "Undo rejection for this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "The worker retries a failed job three times before it gives up.",
      { timeout: 15_000 },
    );
    // The change the reviewer asked back for is on screen, not wherever they
    // had scrolled to while it was gone.
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const lens = document.querySelector("[data-review-diff-lens]");
            if (lens === null) return "no lens";
            const rect = lens.getBoundingClientRect();
            const floor =
              document
                .querySelector("[data-review-diff-stepper]")
                ?.getBoundingClientRect().top ??
              document.documentElement.clientHeight;
            return Math.min(rect.bottom, floor) - Math.max(rect.top, 0) > 0
              ? "on screen"
              : "off screen";
          }),
        { timeout: 15_000 },
      )
      .toBe("on screen");

    // Accepting reads as the plan. Rejecting the other change then moves the
    // plan past this revision, and an accepted change must not go back to
    // asking a question the reviewer already answered (BIG-19 round 3 item 2).
    await stepper(page)
      .getByRole("button", { name: "Accept this change" })
      .click();
    // Accepting advances to the next open change, which has a lens of its own,
    // so the claim is about the accepted place: step back to it and read it
    // there rather than counting lenses on the page at a moment the tour is
    // already moving.
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await expect(
      stepper(page).getByRole("button", {
        name: "Undo acceptance for this change",
      }),
    ).toBeVisible();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    await stepper(page).getByRole("button", { name: "Next change" }).click();
    await stepper(page)
      .getByRole("button", { name: "Reject this change" })
      .click();
    await expect(page.locator("article")).toContainText(
      "Rolling back is automatic.",
      { timeout: 15_000 },
    );

    // The set is settled, so the bar says so - without a tally the reviewer
    // cannot act on - and offers the conversation rather than only a verdict.
    await expect(stepper(page)).toContainText("All changes decided");
    await expect(stepper(page)).not.toContainText("accepted,");
    await expect(stepper(page)).not.toContainText("Reviewing change set");
    // Chat opens under the bar rather than navigating away, so the review the
    // reviewer is standing in survives the conversation.
    await stepper(page)
      .getByRole("button", { name: "Chat", exact: true })
      .click();
    await expect(stepper(page)).toHaveCount(1);
    await expect(
      stepper(page).locator("[data-review-change-chat]"),
    ).toBeVisible();
    await stepper(page).getByRole("button", { name: "Close chat" }).click();
    await expect(
      stepper(page).locator("[data-review-change-chat]"),
    ).toHaveCount(0);

    // The plan has now moved past the revision both changes belong to. The
    // accepted one still reads as the plan rather than going back to asking a
    // question the reviewer already answered.
    await stepper(page).getByRole("button", { name: "Back to review" }).click();
    await stepper(page)
      .getByRole("button", { name: "Previous change" })
      .click();
    await expect(
      stepper(page).getByRole("button", {
        name: "Undo acceptance for this change",
      }),
    ).toBeVisible();
    await expect(page.locator("[data-review-diff-lens]")).toHaveCount(0);
    // The decision is made, so the conversation moves to the thread: the
    // decided row drops Chat (BIG-292 item 2), and the reviewer reaches the
    // conversation through the top-row thread link instead, still without
    // abandoning the review.
    await expect(
      stepper(page).getByRole("button", { name: "Chat about this change" }),
    ).toHaveCount(0);
    await expect(
      stepper(page).getByRole("button", { name: /^Open comment thread:/u }),
    ).toBeVisible();
    await page.goto("about:blank");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-19 round 4. Chatting used to mean leaving for the thread, which meant
// describing a change you could no longer see. The conversation now happens
// under the bar with the change still on screen, it tells the agent which
// change it is about, and it is one conversation rather than a copy: the same
// message is in the drawer and in the thread.
test("should chat about a change without losing sight of it", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-change-chat-"));
  const planPath = join(directory, "plan.mdx");
  // The long plan, so "the change stayed reachable" is a claim the test can
  // make: on a short one the reviewer cannot scroll far enough to lose it.
  await writeFile(planPath, REVEAL_AFTER);
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startReviewRuntime(
    { planPath, diffPreviewSource: REVEAL_BEFORE },
    startCompiledRuntime,
  );
  try {
    await page.setViewportSize({ width: 1_280, height: 800 });
    await openThread(page, runtime.url);
    await rail(page)
      .getByRole("button", { name: /Review changes \(2\)/u })
      .click();
    const drawer = stepper(page).locator("[data-review-change-chat]");
    await expect(drawer).toHaveCount(0);

    await stepper(page)
      .getByRole("button", { name: "Chat about this change" })
      .click();
    await expect(drawer).toBeVisible();
    // The change is still on screen, above the bar the drawer hangs from.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const lens = document.querySelector("[data-review-diff-lens]");
          const bar = document.querySelector("[data-review-diff-stepper]");
          if (lens === null || bar === null) return "no lens";
          const rect = lens.getBoundingClientRect();
          const floor = bar.getBoundingClientRect().top;
          return Math.min(rect.bottom, floor) - Math.max(rect.top, 0) > 0
            ? "in view"
            : "hidden";
        }),
      )
      .toBe("in view");
    // The drawer is about this change, not the whole thread, so it opens with
    // nothing in it until something is said about this change (BIG-19 r6).
    await expect(drawer).not.toContainText(
      "Make every causal change reviewable",
    );
    // And the reviewer can type straight away.
    await expect
      .poll(async () =>
        page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? "none",
        ),
      )
      .toBe("Message the agent about this change");

    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/agent-requests") &&
        response.request().method() === "POST",
    );
    await drawer
      .getByRole("textbox", { name: "Message the agent about this change" })
      .fill("Say it in the operator's words.");
    await drawer.getByRole("button", { name: /^Send/u }).click();
    expect((await sent).ok()).toBe(true);

    // What the agent receives names the change, so it never has to guess which
    // of the set the reviewer meant.
    await expect
      .poll(
        async () => {
          const requests: {
            readonly requests: ReadonlyArray<{
              readonly kind: string;
              readonly body?: string;
            }>;
          } = await page.evaluate(async () => {
            const token = document.documentElement.dataset.reviewToken ?? "";
            return (
              await fetch("api/agent", {
                headers: { "x-big-plan-review-token": token },
              })
            ).json();
          });
          return (
            requests.requests.find((request) => request.kind === "reply")
              ?.body ?? ""
          );
        },
        { timeout: 15_000 },
      )
      .toMatch(
        /^About the .+ change on .+\(1 of 2 in this change set\):\n\nSay it in the operator's words\.$/u,
      );

    // One conversation drawn twice: the message is in the drawer and in the
    // thread, and the change is still there to answer once the reviewer is
    // happy with it.
    await expect(drawer).toContainText("Say it in the operator's words.");
    await expect(rail(page)).toContainText("Say it in the operator's words.");
    // The reviewer's own bubble shows their words, not the line the drawer
    // added for the agent - they are looking at the change it names.
    const myTurn = drawer
      .locator("[data-review-change-chat-message='reviewer']")
      .last();
    await expect(myTurn).not.toContainText("About the");
    // And the state of the conversation sits outside the bubble rather than
    // reading as part of what they said. No agent is attached here, so the
    // honest state is queued rather than a spinner promising work nobody has
    // started (BIG-19 round 7).
    await expect(
      myTurn.locator("[data-review-change-chat-awaiting='queued']"),
    ).toContainText("Queued for the agent");
    await expect(
      myTurn.locator("[data-review-change-chat-bubble]"),
    ).not.toContainText("Queued for the agent");

    // The change stays reachable however far the reviewer scrolls while they
    // talk: the bar reserves room for its own height, and one control puts the
    // change back where it can be read.
    const shownFraction = () =>
      page.evaluate(() => {
        const lens = document.querySelector("[data-review-diff-lens]");
        const bar = document.querySelector("[data-review-diff-stepper]");
        if (lens === null || bar === null) return 0;
        const rect = lens.getBoundingClientRect();
        const floor = bar.getBoundingClientRect().top;
        return Math.max(
          0,
          (Math.min(rect.bottom, floor) - Math.max(rect.top, 0)) / rect.height,
        );
      });
    await page.evaluate(() => window.scrollTo({ top: 1e6, behavior: "auto" }));
    await expect.poll(shownFraction).toBe(0);
    await drawer
      .getByRole("button", { name: "View the diff this chat is about" })
      .click();
    await expect.poll(shownFraction, { timeout: 15_000 }).toBeGreaterThan(0.5);
    await expect(
      stepper(page).getByRole("button", { name: "Accept this change" }),
    ).toBeVisible();
    await page.goto("about:blank");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// BIG-292. The bar is two different rows, and which controls sit in it - and in
// what order - is the product decision under test here. Undecided, the row
// offers the conversation and the two verdicts, then the set-wide overflow:
// badge (none yet), Chat, Reject, Accept, overflow. Once a change is decided
// the row changes shape - Chat is gone, because the decision is made and the
// conversation belongs in the thread the top-row link reaches - and the
// verdict badge sits after the actions with the set-wide overflow closing the
// row at its far right.
test("should lay out the review bar differently before and after a change is decided", async ({
  page,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "big-plan-bar-layout-"));
  const planPath = join(directory, "plan.mdx");
  // The reveal fixture attaches the conversation to the change set, so the
  // undecided row actually offers Chat - which is the button the decided row
  // has to be shown dropping.
  await writeFile(planPath, REVEAL_AFTER);
  const { startReviewRuntime: startCompiledRuntime } =
    await import("../dist/review/server.js");
  const runtime = await startReviewRuntime(
    { planPath, diffPreviewSource: REVEAL_BEFORE },
    startCompiledRuntime,
  );
  try {
    await openThread(page, runtime.url);
    await rail(page)
      .getByRole("button", { name: /Review changes \(2\)/u })
      .click();
    await expect(stepper(page)).toContainText("1 of 2");

    // The ordered controls in the action row, left to right: a button reads as
    // its accessible name, and the verdict badge reads as "badge:<verdict>", so
    // its position in the row is as observable as any button's.
    const barControls = (): Promise<ReadonlyArray<string>> =>
      stepper(page)
        .locator("[data-review-bar-actions]")
        .evaluate((row) =>
          Array.from(
            row.querySelectorAll("button, [data-review-verdict-badge]"),
          ).map((element) =>
            element.matches("[data-review-verdict-badge]")
              ? `badge:${(element.textContent ?? "").trim()}`
              : (element.getAttribute("aria-label") ??
                (element.textContent ?? "").trim()),
          ),
        );

    await test.step("undecided: Chat, Reject, Accept, then the overflow", async () => {
      // The conversation is pushed onto the open tour a moment after it opens,
      // so wait for the row to hold Chat before reading its order - otherwise
      // the read races the sync and sees the row without it.
      await expect(
        stepper(page).getByRole("button", { name: "Chat about this change" }),
      ).toBeVisible();
      // No verdict is recorded yet, so there is no badge to lead the row - the
      // BIG-153 "Changed again" badge that will sit there is out of scope here.
      // What this locks is the three buttons and their order: the conversation,
      // then the two verdicts, then the set-wide overflow at the end.
      expect(await barControls()).toEqual([
        "Exit review",
        "Chat about this change",
        "Reject this change",
        "Accept this change",
        "More change set actions",
      ]);
    });

    await test.step("decided by rejecting: evidence, Undo, badge, then overflow", async () => {
      await stepper(page)
        .getByRole("button", { name: "Reject this change" })
        .click();
      // Rejecting the first change advances to the still-open second one, so the
      // decided row is read by stepping back to the change that now holds a
      // verdict rather than by reading the change the tour moved on to.
      await stepper(page)
        .getByRole("button", { name: "Previous change" })
        .click();
      await expect(
        stepper(page).getByRole("button", {
          name: "Undo rejection for this change",
        }),
      ).toBeVisible();
      expect(await barControls()).toEqual([
        "Exit review",
        "View changes",
        "Undo rejection for this change",
        "badge:Rejected",
        "More change set actions",
      ]);
      await expect(page.locator("article")).toContainText(
        "The worker retries a failed job once before it gives up.",
      );
      await expect(
        page.locator("article").getByText("three times before it gives up"),
      ).toHaveCount(0);

      await stepper(page).getByRole("button", { name: "View changes" }).click();
      const lens = page.locator("[data-review-diff-lens]");
      await expect(lens).toContainText("What changed");
      await expect(lens.locator("del")).toContainText("once");
      await expect(lens.locator("ins").first()).toContainText("three");
      await expect(stepper(page)).toContainText("Rejected");

      await stepper(page).getByRole("button", { name: "Hide changes" }).click();
      await expect(lens).toHaveCount(0);
      await expect(page.locator("article")).toContainText(
        "The worker retries a failed job once before it gives up.",
      );
      await expect(
        page.locator("article").getByText("three times before it gives up"),
      ).toHaveCount(0);
    });

    await test.step("decided by accepting: View changes and Undo, then the overflow, then the badge", async () => {
      await stepper(page)
        .getByRole("button", { name: "Undo rejection for this change" })
        .click();
      await stepper(page)
        .getByRole("button", { name: "Accept this change" })
        .click();
      await stepper(page)
        .getByRole("button", { name: "Previous change" })
        .click();
      await expect(
        stepper(page).getByRole("button", {
          name: "Undo acceptance for this change",
        }),
      ).toBeVisible();
      // An accepted change keeps its evidence one control away, so the row is
      // View changes, Undo, the Accepted badge, and the set-wide overflow at
      // the far right - and Chat is nowhere in it.
      expect(await barControls()).toEqual([
        "Exit review",
        "View changes",
        "Undo acceptance for this change",
        "badge:Accepted",
        "More change set actions",
      ]);
    });

    await page.goto("about:blank");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
