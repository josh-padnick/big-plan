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
    await expect(page).toHaveURL(/#inline-retries-delay-checkout$/);
    const heading = page.getByRole("heading", {
      level: 2,
      name: "Inline retries delay checkout",
    });
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

test("should keep deck content readable and collapse controls dormant without JavaScript", async ({
  browser,
  deckViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(deckViewerUrl);

  await expect(page.locator("[data-noscript-notice]")).toBeVisible();
  await expect(page.locator("[data-noscript-notice]")).toContainText(
    "Interactive affordances",
  );
  expect(
    await page
      .locator("[data-collapse-toggle]")
      .evaluateAll((controls) =>
        controls.every((control) => (control as HTMLElement).hidden),
      ),
  ).toBe(true);
  await expect(page.locator("[data-collapse-header]").first()).toHaveCSS(
    "cursor",
    "auto",
  );
  await expect(
    page.getByText(
      "Inline retries couple checkout latency to processor health.",
    ),
  ).toBeVisible();

  await context.close();
});

test("should collapse and expand deck parts, slides, and sub-slides", async ({
  page,
  deckViewerUrl,
}) => {
  await page.goto(deckViewerUrl);
  const toc = page.getByRole("navigation", { name: "Contents" });

  await test.step("blocks start open so body content is visible", async () => {
    const statusHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="inline-retries-delay-checkout"]',
    );
    await expect(statusHost).toHaveAttribute("data-slide-type", "status-quo");
    await expect(statusHost.locator("[data-slide-kicker]")).toHaveText(
      "1.1 / Status quo",
    );
    await expect(statusHost).not.toHaveAttribute("data-collapsed", "");
    await expect(
      statusHost.getByText(
        "Inline retries couple checkout latency to processor health.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Inline retries delay checkout",
      }),
    ).toBeVisible();
  });

  await test.step("collapsing a slide hides its body but keeps the title", async () => {
    const statusHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="inline-retries-delay-checkout"]',
    );
    const toggle = statusHost.locator(
      ":scope > [data-collapse-header] > [data-collapse-toggle]",
    );
    await statusHost.hover();
    await toggle.click();
    await expect(statusHost).toHaveAttribute("data-collapsed", "");
    await expect(
      statusHost.getByText(
        "Inline retries couple checkout latency to processor health.",
      ),
    ).toBeHidden();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Inline retries delay checkout",
      }),
    ).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await statusHost.getByRole("heading", { level: 2 }).click();
    await expect(statusHost).not.toHaveAttribute("data-collapsed", "");
    await expect(
      statusHost.getByText(
        "Inline retries couple checkout latency to processor health.",
      ),
    ).toBeVisible();
  });

  await test.step("slide title opens only, while kicker and chevron toggle", async () => {
    const successHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="success-looks-like"]',
    );
    const title = successHost.getByRole("heading", { level: 2 });
    const kicker = successHost.locator(
      ":scope > [data-collapse-header] [data-slide-kicker]",
    );
    const toggle = successHost.locator(
      ":scope > [data-collapse-header] > [data-collapse-toggle]",
    );
    await expect(successHost).not.toHaveAttribute("data-collapsed", "");
    await expect(title).toHaveCSS("cursor", "text");

    await title.click();
    await expect(successHost).not.toHaveAttribute("data-collapsed", "");

    await title.click();
    await expect(successHost).not.toHaveAttribute("data-collapsed", "");

    await kicker.click();
    await expect(successHost).toHaveAttribute("data-collapsed", "");
    await expect(title).toHaveCSS("cursor", "pointer");
    await kicker.click();
    await expect(successHost).not.toHaveAttribute("data-collapsed", "");
    await expect(title).toHaveCSS("cursor", "text");

    await toggle.click();
    await expect(successHost).toHaveAttribute("data-collapsed", "");
    await expect(title).toHaveCSS("cursor", "pointer");
    await toggle.click();
    await expect(successHost).not.toHaveAttribute("data-collapsed", "");
    await expect(title).toHaveCSS("cursor", "text");
  });

  await test.step("hovering the header keeps the toggle while moving onto it", async () => {
    const successHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="success-looks-like"]',
    );
    const header = successHost.locator(":scope > [data-collapse-header]");
    const toggle = header.locator(":scope > [data-collapse-toggle]");
    await header.hover();
    await expect(toggle).toBeVisible();
    await toggle.hover();
    await expect(toggle).toBeVisible();
  });

  await test.step("collapsing a sub-slide hides only that frame's body", async () => {
    const worker = page.locator(
      '[data-collapsible="subslide"][data-collapse-id="the-worker"]',
    );
    await worker.hover();
    await worker
      .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
      .click();
    await expect(worker).toHaveAttribute("data-collapsed", "");
    await expect(worker.getByText("Claims due schedules")).toBeHidden();
    await expect(
      page.locator(
        '[data-collapsible="subslide"][data-collapse-id="the-audit-trail"]',
      ),
    ).toContainText("Every state change");
  });

  // Regression: a sub-slide's body used to sit inside its parent group's hit
  // target, so toggling one collapsed the other and the page jumped.
  await test.step("toggling a sub-slide leaves its parent slide expanded", async () => {
    const worker = page.locator(
      '[data-collapsible="subslide"][data-collapse-id="the-worker"]',
    );
    const parent = worker.locator(
      'xpath=ancestor::*[@data-collapsible="slide"][1]',
    );
    await expect(parent).not.toHaveAttribute("data-collapsed", "");
    const headerBox = await worker
      .locator(":scope > [data-collapse-header]")
      .boundingBox();
    await worker.locator(":scope > [data-collapse-header]").click();
    await expect(parent).not.toHaveAttribute("data-collapsed", "");
    // Header chrome is geometry-stable, so the row must not move on screen.
    const afterBox = await worker
      .locator(":scope > [data-collapse-header]")
      .boundingBox();
    expect(Math.abs((afterBox?.y ?? 0) - (headerBox?.y ?? 0))).toBeLessThan(1);
    await worker.locator(":scope > [data-collapse-header]").click();
  });

  // Regression: body content used to live inside the click hit target, so
  // selecting or clicking ordinary prose collapsed the slide.
  await test.step("clicking slide body content does not collapse the slide", async () => {
    const statusHost = page.locator(
      '[data-collapsible="slide"][data-collapse-id="inline-retries-delay-checkout"]',
    );
    // An earlier step left this slide collapsed; reopen it first.
    if ((await statusHost.getAttribute("data-collapsed")) !== null) {
      await statusHost.locator(":scope > [data-collapse-header]").click();
    }
    await expect(statusHost).not.toHaveAttribute("data-collapsed", "");
    await statusHost
      .getByText("Inline retries couple checkout latency to processor health.")
      .click();
    await expect(statusHost).not.toHaveAttribute("data-collapsed", "");
  });

  // Regression: within one parent, a collapsed chip and an expanded header
  // must share a left edge and a chevron column. The chevron used to be two
  // borders of a rotated square, whose ink sits off-center, so each state
  // painted it somewhere different while every box still measured identical.
  await test.step("collapsed and expanded siblings share one chevron column", async () => {
    const drift = await page.evaluate(() => {
      // Transform animates for 150ms, so geometry read straight after a click
      // samples the old state and any comparison passes vacuously.
      const kill = document.createElement("style");
      // overflow-anchor:none disables Chrome's own scroll anchoring, which
      // would otherwise compensate for the layout change by itself and hide
      // whether the viewer script anchors the bulk run at all.
      kill.textContent =
        "*{transition:none !important;animation:none !important;overflow-anchor:none !important}";
      document.head.appendChild(kill);
      const header = (block: Element) =>
        block.querySelector(":scope > [data-collapse-header]") as HTMLElement;
      const inkCenter = (block: Element) => {
        const path = header(block).querySelector(
          "[data-collapse-toggle] svg path",
        ) as Element;
        const rect = path.getBoundingClientRect();
        const base = header(block).getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - base.left,
          y: rect.top + rect.height / 2 - base.top,
        };
      };
      const worst = { chevronX: 0, chevronY: 0, headerLeft: 0 };
      for (const body of document.querySelectorAll("[data-collapse-body]")) {
        const kids = Array.from(body.children).filter((child) =>
          child.hasAttribute("data-collapsible"),
        );
        if (kids.length < 2) continue;
        // Alternate the siblings so the parent holds a mixed state.
        kids.forEach((kid, index) => index % 2 === 0 && header(kid).click());
        const rows = kids.map((kid) => ({
          ink: inkCenter(kid),
          left: header(kid).getBoundingClientRect().left,
        }));
        const spread = (values: ReadonlyArray<number>) =>
          Math.max(...values) - Math.min(...values);
        worst.chevronX = Math.max(
          worst.chevronX,
          spread(rows.map((r) => r.ink.x)),
        );
        worst.chevronY = Math.max(
          worst.chevronY,
          spread(rows.map((r) => r.ink.y)),
        );
        worst.headerLeft = Math.max(
          worst.headerLeft,
          spread(rows.map((r) => r.left)),
        );
        kids.forEach((kid, index) => index % 2 === 0 && header(kid).click());
      }
      kill.remove();
      return worst;
    });
    expect(drift.chevronX).toBeLessThan(0.5);
    expect(drift.chevronY).toBeLessThan(0.5);
    expect(drift.headerLeft).toBeLessThan(0.5);
  });

  // Regression: the toggle used to be an in-flow flex item with a negative
  // margin. That shrinks the item's OUTER width, dragging the kicker and
  // title left by one card padding while the body stayed put, so header
  // chrome and content sat on two different left edges.
  await test.step("header chrome shares the body's left edge at every level", async () => {
    const worst = await page.evaluate(() => {
      const offsets: Array<{ kind: string; delta: number }> = [];
      for (const block of document.querySelectorAll("[data-collapsible]")) {
        const header = block.querySelector(
          ":scope > [data-collapse-header]",
        ) as HTMLElement | null;
        const body = block.querySelector(
          ":scope > [data-collapse-body]",
        ) as HTMLElement | null;
        if (header === null || body === null) continue;
        if (block.hasAttribute("data-collapsed")) continue;
        const chrome =
          (header.querySelector(
            ":scope > .plan-collapse-chrome",
          ) as HTMLElement) ?? header;
        const content = Array.from(body.children).find(
          (child) => child.getBoundingClientRect().width > 0,
        );
        if (content === undefined) continue;
        offsets.push({
          kind: block.getAttribute("data-collapsible") ?? "?",
          delta:
            chrome.getBoundingClientRect().left -
            content.getBoundingClientRect().left,
        });
      }
      return {
        checked: offsets.length,
        max: offsets.reduce((acc, o) => Math.max(acc, Math.abs(o.delta)), 0),
      };
    });
    expect(worst.checked).toBeGreaterThan(0);
    expect(worst.max).toBeLessThan(0.5);
  });

  await test.step("expand all and collapse all reach every region", async () => {
    const controls = page.locator("[data-collapse-all-controls]:visible");
    await expect(controls).toHaveCount(1);
    const regions = page.locator("[data-collapsible]");
    const total = await regions.count();
    await controls.locator("[data-collapse-all]").click();
    await expect(
      page.locator("[data-collapsible][data-collapsed]"),
    ).toHaveCount(total);
    await controls.locator("[data-expand-all]").click();
    await expect(
      page.locator("[data-collapsible][data-collapsed]"),
    ).toHaveCount(0);
  });

  await test.step("desktop bulk controls sit flush with the sidebar edge in both themes", async () => {
    const desktopToc = page.locator(
      'nav[aria-label="Contents"]:not([data-mobile-toc])',
    );
    const header = desktopToc.locator("[data-toc-header]");
    const controls = header.locator("[data-collapse-all-controls]");
    for (const theme of ["light", "dark"]) {
      await page.locator("html").evaluate((root, nextTheme) => {
        root.setAttribute("data-theme", nextTheme);
      }, theme);
      const tocBox = await boxOf(desktopToc);
      const controlsBox = await boxOf(controls);
      expect(
        Math.abs(tocBox.x + tocBox.width - (controlsBox.x + controlsBox.width)),
      ).toBeLessThan(0.5);
    }
  });

  // A bulk run applies state to every region and corrects the viewport once,
  // so per-region behaviour has to survive it untouched.
  await test.step("a bulk run leaves geometry stable and toggles independent", async () => {
    const result = await page.evaluate(() => {
      const kill = document.createElement("style");
      kill.textContent =
        "*{transition:none !important;animation:none !important}";
      document.head.appendChild(kill);
      const blocks = () =>
        Array.from(document.querySelectorAll("[data-collapsible]"));
      const header = (block: Element) =>
        block.querySelector(":scope > [data-collapse-header]") as HTMLElement;
      const shown = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).find(
          (node) => node.getBoundingClientRect().width > 0,
        ) as HTMLElement;
      const expandAll = shown("[data-expand-all]");
      const collapseAll = shown("[data-collapse-all]");
      // Only top-level regions stay visible in both states, so only they can
      // be compared across a bulk run; nested ones report a zero rect.
      const topLevel = () =>
        blocks().filter(
          (block) => block.parentElement?.closest("[data-collapsible]") == null,
        );
      expandAll.click();
      const before = topLevel().map(
        (block) => header(block).getBoundingClientRect().height,
      );
      collapseAll.click();
      const during = topLevel().map(
        (block) => header(block).getBoundingClientRect().height,
      );
      // Scroll anchoring across a bulk run is deliberately NOT asserted here.
      // This fixture cannot express it: it has three top-level regions, the
      // collapsed document barely exceeds one viewport, and scroll clamping
      // dominates any correction - an assertion here was verified to pass even
      // with the anchoring removed. It is measured directly on a large
      // document instead; see the task regression checklist.
      expandAll.click();
      const after = topLevel().map(
        (block) => header(block).getBoundingClientRect().height,
      );
      // Independence must survive the bulk run.
      const vector = () =>
        blocks().map((block) => (block.hasAttribute("data-collapsed") ? 1 : 0));
      let collateral = 0;
      const list = blocks();
      for (let index = 0; index < list.length; index += 1) {
        const target = list[index] as Element;
        if (header(target).getBoundingClientRect().height === 0) continue;
        const start = vector();
        header(target).click();
        const end = vector();
        for (let other = 0; other < list.length; other += 1) {
          if (other !== index && start[other] !== end[other]) collateral += 1;
        }
        header(target).click();
      }
      kill.remove();
      return {
        headerDrift: Math.max(
          ...before.map((height, index) =>
            Math.abs((during[index] ?? 0) - height),
          ),
          ...before.map((height, index) =>
            Math.abs((after[index] ?? 0) - height),
          ),
        ),
        collateral,
      };
    });
    expect(result.headerDrift).toBeLessThan(0.5);
    expect(result.collateral).toBe(0);
  });

  await test.step("collapsing a part tucks away every slide in the act", async () => {
    const shipping = page.locator(
      '[data-collapsible="part"][data-collapse-id="part-shipping-your-review"]',
    );
    await shipping.evaluate((element) =>
      element.scrollIntoView({ block: "end" }),
    );
    await shipping.hover();
    await shipping
      .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
      .click();
    await expect(shipping).toHaveAttribute("data-collapsed", "");
    await expect(
      shipping.locator(":scope > [data-collapse-body]"),
    ).toBeHidden();
    await expect(
      shipping.locator(":scope > [data-collapse-header]"),
    ).toBeVisible();
  });

  await test.step("a TOC jump expands collapsed ancestors and lands on the target", async () => {
    await toc.getByRole("link", { name: "Acceptance criteria" }).click();
    await expect(page).toHaveURL(/#restarts-preserve-scheduled-retries$/);
    const heading = page.getByRole("heading", {
      level: 2,
      name: "Restarts preserve scheduled retries",
    });
    const shipping = page.locator(
      '[data-collapsible="part"][data-collapse-id="part-shipping-your-review"]',
    );
    await expect(shipping).not.toHaveAttribute("data-collapsed", "");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(heading).toBeInViewport();
    await expect(
      page.locator(
        '[data-collapsible="slide"][data-collapse-id="restarts-preserve-scheduled-retries"]',
      ),
    ).toBeVisible();
  });

  await test.step("a hashchange expands collapsed ancestors and lands on the target", async () => {
    await page.evaluate(() => {
      location.hash = "#inline-retries-delay-checkout";
    });
    await expect(page).toHaveURL(/#inline-retries-delay-checkout$/);
    const shipping = page.locator(
      '[data-collapsible="part"][data-collapse-id="part-shipping-your-review"]',
    );
    await shipping.evaluate((element) =>
      element.scrollIntoView({ block: "end" }),
    );
    await shipping
      .locator(":scope > [data-collapse-header] > [data-collapse-toggle]")
      .click();
    await expect(shipping).toHaveAttribute("data-collapsed", "");
    await page.evaluate(() => {
      const scrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) {
        if (this.id === "restarts-preserve-scheduled-retries") {
          document.documentElement.setAttribute(
            "data-hash-target-scrolled",
            "",
          );
        }
        scrollIntoView.call(this, options);
      };
    });
    await page.evaluate(() => {
      location.hash = "#restarts-preserve-scheduled-retries";
    });
    await expect(page).toHaveURL(/#restarts-preserve-scheduled-retries$/);
    await expect(shipping).not.toHaveAttribute("data-collapsed", "");
    await expect(page.locator("html")).toHaveAttribute(
      "data-hash-target-scrolled",
      "",
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Restarts preserve scheduled retries",
      }),
    ).toBeInViewport();
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
