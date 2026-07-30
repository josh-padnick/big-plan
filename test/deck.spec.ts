// Browser tests of the deck reading journey: Part divider bands, grouped TOC
// navigation to a part anchor, TableOfContents rows linking to their slides,
// sub-slide frames with kicker headings, context-builder lines, and the FlowDiagram
// diagram's staged fork. Render-health failures are enforced by the fixtures
// module.

import { boxOf, expect, test } from "./fixtures";

test("should read the deck plan through parts, the overview, and sub-slides", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const toc = page.getByRole("navigation", { name: "Contents" });

  await test.step("the Part dividers render as numbered bands", async () => {
    const firstBand = page.locator("[data-part]").first();
    await expect(firstBand).toContainText("Part 1");
    await expect(firstBand).toContainText("Context");
    await expect(page.locator("[data-part]")).toHaveCount(3);
  });

  await test.step("the TOC groups sections under linked part headers", async () => {
    const partHeaders = toc.locator("[data-toc-part]");
    await expect(partHeaders).toHaveText([
      "[1] Context",
      "[2] The proposal",
      "[3] Shipping & your review",
    ]);
    await partHeaders.nth(1).click();
    await expect(page).toHaveURL(/#part-the-proposal$/);
    await expect(page.locator("#part-the-proposal")).toBeInViewport();
  });

  await test.step("a TableOfContents row jumps to its numbered slide", async () => {
    await page.goto(deckViewerUrl);
    const row = page.locator("[data-table-of-contents-row]", {
      hasText: "Status quo",
    });
    await expect(row.locator("[data-table-of-contents-num]")).toHaveText("1.1");
    await row.click();
    await expect(page).toHaveURL(/#status-quo$/);
    const heading = page.getByRole("heading", { level: 2, name: "Status quo" });
    await expect(heading).toBeInViewport();
    const box = await boxOf(heading);
    expect(box.y).toBeGreaterThan(0);
  });

  await test.step("an h3 section renders as sub-slides under a parent header", async () => {
    const parent = page.locator("[data-subpart]");
    await expect(parent).toContainText("2.1 / The retry queue");
    const subSlides = page.locator("[data-subslide]");
    await expect(subSlides).toHaveCount(2);
    await expect(subSlides.first()).toContainText("2.1.1 / The worker");
  });

  await test.step("context builders read as muted lines, not emphasis", async () => {
    const context = page.locator("[data-slide-context]").first();
    await expect(context).toHaveText(
      "What the queue worker does on every attempt.",
    );
    await expect(context.locator("em")).toHaveCount(0);
  });
});

test("should collapse and expand deck parts, slides, and sub-slides", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const toc = page.getByRole("navigation", { name: "Contents" });

  await test.step("blocks start open so body content is visible", async () => {
    const statusHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="status-quo"]',
    );
    await expect(statusHost).not.toHaveAttribute("data-collapsed", "");
    await expect(statusHost.getByText("Inline retries")).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Status quo" }),
    ).toBeVisible();
  });

  await test.step("collapsing a slide hides its body but keeps the title", async () => {
    const statusHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="status-quo"]',
    );
    const toggle = statusHost.locator(":scope > [data-collapse-toggle]");
    await statusHost.hover();
    await toggle.click();
    await expect(statusHost).toHaveAttribute("data-collapsed", "");
    await expect(statusHost.getByText("Inline retries")).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 2, name: "Status quo" }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("hover host keeps the toggle while moving onto it", async () => {
    const successHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="success-looks-like"]',
    );
    const toggle = successHost.locator(":scope > [data-collapse-toggle]");
    await successHost.locator(".plan-slide").hover();
    await expect(toggle).toBeVisible();
    await toggle.hover();
    await expect(toggle).toBeVisible();
  });

  await test.step("collapsing a sub-slide hides only that frame's body", async () => {
    const worker = page.locator(
      '[data-collapsible="subslide"][data-collapse-id="the-worker"]',
    );
    await worker.hover();
    await worker.locator(":scope > [data-collapse-toggle]").click();
    await expect(worker).toHaveAttribute("data-collapsed", "");
    await expect(worker.getByText("Claims due schedules")).toBeHidden();
    await expect(
      page.locator(
        '[data-collapsible="subslide"][data-collapse-id="the-audit-trail"]',
      ),
    ).toContainText("Every state change");
  });

  await test.step("collapsing a part tucks away every slide in the act", async () => {
    const proposal = page.locator(
      '[data-collapsible="part"][data-collapse-id="part-the-proposal"]',
    );
    await proposal.hover();
    await proposal.locator(":scope > [data-collapse-toggle]").click();
    await expect(proposal).toHaveAttribute("data-collapsed", "");
    await expect(
      proposal.locator(":scope > [data-collapse-body]"),
    ).toBeHidden();
    await expect(page.locator("#part-the-proposal")).toBeVisible();
  });

  await test.step("a TOC jump expands collapsed ancestors and lands on the target", async () => {
    await toc.getByRole("link", { name: "The retry queue" }).click();
    await expect(page).toHaveURL(/#the-retry-queue$/);
    const proposal = page.locator(
      '[data-collapsible="part"][data-collapse-id="part-the-proposal"]',
    );
    await expect(proposal).not.toHaveAttribute("data-collapsed", "");
    const heading = page.getByRole("heading", {
      level: 2,
      name: "The retry queue",
    });
    await expect(heading).toBeInViewport();
    await expect(
      page.locator(
        '[data-collapsible="slide"][data-collapse-id="the-retry-queue"]',
      ),
    ).toBeVisible();
  });
});

test("should draw the FlowDiagram pipeline as staged cards with an explicit fork", async ({
  page,
  flowDiagramViewerUrl,
}) => {
  await page.goto(flowDiagramViewerUrl);
  const flow = page.locator("[data-flow-diagram]").first();

  await test.step("stage headers and toned cards render in columns", async () => {
    await expect(flow.locator("[data-flow-diagram-stage]")).toHaveText([
      "Source of truth",
      "Generate",
      "Available through",
    ]);
    await expect(
      flow.locator('[data-flow-diagram-node][data-flow-diagram-tone="source"]'),
    ).toHaveCount(1);
    await expect(
      flow.locator(
        '[data-flow-diagram-node][data-flow-diagram-tone="destination"]',
      ),
    ).toHaveCount(3);
  });

  await test.step("the fan-out draws one branch per destination card", async () => {
    await expect(flow.locator("[data-flow-diagram-fork-stub]")).toHaveCount(1);
    await expect(flow.locator("[data-flow-diagram-branch]")).toHaveCount(3);
    // Each branch's row centers on its card, so the branch and card boxes
    // overlap vertically and the connector touches the card.
    const branch = flow.locator('[data-flow-diagram-branch="first"]');
    const card = flow
      .locator('[data-flow-diagram-node][data-flow-diagram-tone="destination"]')
      .first();
    const branchBox = await boxOf(branch);
    const cardBox = await boxOf(card);
    expect(branchBox.x + branchBox.width).toBeGreaterThanOrEqual(cardBox.x - 1);
    expect(
      Math.abs(
        branchBox.y + branchBox.height / 2 - (cardBox.y + cardBox.height / 2),
      ),
    ).toBeLessThan(2);
  });

  await test.step("the verb label and footer line render inside the graphic", async () => {
    await expect(flow).toContainText("feeds");
    await expect(flow.locator("[data-flow-diagram-footer]")).toContainText(
      "One authored file",
    );
  });
});
