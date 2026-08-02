// Browser tests of the shared figure maximize journey: every supported figure
// family promotes to the viewport, restores accessibly, and stays inert when
// the review document runs without JavaScript.

import { expect, test } from "./fixtures";

type FigureCase = {
  readonly name: string;
  readonly selector: string;
  readonly maximizeLabel: string;
  readonly restoreLabel: string;
  readonly bodyScrolls: boolean;
};

const FIGURE_CASES: ReadonlyArray<FigureCase> = [
  {
    name: "ComplexDecision",
    selector: "[data-complex-decision]",
    maximizeLabel: "Maximize decision",
    restoreLabel: "Restore decision size",
    bodyScrolls: false,
  },
  {
    name: "FileTreeDiff",
    selector: ".file-tree-diff",
    maximizeLabel: "Maximize tree",
    restoreLabel: "Restore tree size",
    bodyScrolls: false,
  },
  {
    name: "plain fenced code",
    selector: ".code-figure",
    maximizeLabel: "Maximize code",
    restoreLabel: "Restore code size",
    bodyScrolls: true,
  },
  {
    name: "CodeDiff",
    selector: "[data-code-diff]",
    maximizeLabel: "Maximize diff",
    restoreLabel: "Restore diff size",
    bodyScrolls: false,
  },
  {
    name: "CodeSnippet",
    selector: "[data-code-snippet]",
    maximizeLabel: "Maximize code",
    restoreLabel: "Restore code size",
    bodyScrolls: true,
  },
  {
    name: "DatabaseTableSchema",
    selector: "[data-database-table-schema]",
    maximizeLabel: "Maximize schema",
    restoreLabel: "Restore schema size",
    bodyScrolls: true,
  },
];

test("should maximize and restore every supported figure family in both themes", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset["theme"] = value;
    }, theme);

    for (const figureCase of FIGURE_CASES) {
      await test.step(`${theme}: ${figureCase.name}`, async () => {
        const frame = page.locator(figureCase.selector).first();
        const trigger = frame.locator("[data-figure-maximize]");
        await frame.scrollIntoViewIfNeeded();
        await expect(trigger).toBeVisible();
        await expect(trigger).toHaveAccessibleName(figureCase.maximizeLabel);

        await trigger.click();
        await expect(frame).toHaveAttribute("data-figure-maximized", "");
        await expect(frame).toHaveAttribute("role", "dialog");
        await expect(frame).toHaveAttribute("aria-modal", "true");
        await expect(page.locator("html")).toHaveAttribute(
          "data-figure-maximized-open",
          "",
        );
        await expect(page.locator("body > header")).toHaveAttribute(
          "inert",
          "",
        );
        await expect(trigger).toHaveAccessibleName(figureCase.restoreLabel);
        await expect(frame.locator("[data-lucide='maximize-2']")).toBeHidden();
        await expect(frame.locator("[data-lucide='minimize-2']")).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator("body")
              .evaluate(
                (element) => getComputedStyle(element, "::after").opacity,
              ),
          )
          .toBe("1");

        const presentation = await frame.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const frameStyle = getComputedStyle(element);
          const body = element.querySelector(":scope > [data-figure-body]");
          const backdrop = getComputedStyle(document.body, "::after");
          return {
            top: rect.top,
            right: innerWidth - rect.right,
            bottom: innerHeight - rect.bottom,
            left: rect.left,
            margin: frameStyle.margin,
            frameOverflow: frameStyle.overflow,
            bodyOverflow:
              body === null ? null : getComputedStyle(body).overflow,
            backdropOpacity: backdrop.opacity,
            backdropVisibility: backdrop.visibility,
          };
        });
        expect(presentation.top).toBeCloseTo(24);
        expect(presentation.right).toBeCloseTo(24);
        expect(presentation.bottom).toBeCloseTo(24);
        expect(presentation.left).toBeCloseTo(24);
        expect(presentation.margin).toBe("0px");
        expect(presentation.backdropOpacity).toBe("1");
        expect(presentation.backdropVisibility).toBe("visible");
        if (figureCase.bodyScrolls) {
          expect(presentation.frameOverflow).toBe("hidden");
          expect(presentation.bodyOverflow).toBe("auto");
        } else {
          expect(presentation.frameOverflow).toBe("auto");
          expect(presentation.bodyOverflow).toBeNull();
        }

        await page.keyboard.press("Shift+Tab");
        await expect
          .poll(() =>
            frame.evaluate((element) =>
              element.contains(document.activeElement),
            ),
          )
          .toBe(true);

        const info = frame.locator("details[data-info-popover]").first();
        if ((await info.count()) !== 0) {
          const summary = info.locator("summary");
          await summary.focus();
          await info.evaluate((element) => {
            if (element instanceof HTMLDetailsElement) element.open = false;
          });
          await summary.press("Escape");
        } else {
          await page.keyboard.press("Escape");
        }
        await expect(frame).not.toHaveAttribute("data-figure-maximized");
        await expect(frame).not.toHaveAttribute("role");
        await expect(frame).not.toHaveAttribute("aria-modal");
        await expect(page.locator("html")).not.toHaveAttribute(
          "data-figure-maximized-open",
        );
        await expect(page.locator("body > header")).not.toHaveAttribute(
          "inert",
        );
        await expect(trigger).toHaveAccessibleName(figureCase.maximizeLabel);
        await expect(trigger).toBeFocused();
      });
    }
  }
});

test("should traverse disclosures and wrap within maximized figures", async ({
  page,
  componentsViewerUrl,
}) => {
  await page.goto(componentsViewerUrl);
  const cases = [
    {
      name: "ComplexDecision",
      selector: "[data-complex-decision]",
    },
    {
      name: "FileTreeDiff",
      selector: ".file-tree-diff",
    },
  ];

  for (const focusCase of cases) {
    await test.step(focusCase.name, async () => {
      const frame = page.locator(focusCase.selector).first();
      const trigger = frame.locator("[data-figure-maximize]");
      const disclosure = frame
        .locator("details[data-info-popover] > summary:visible")
        .last();
      await trigger.click();
      await expect(disclosure).toBeVisible();

      let reachedDisclosure = false;
      for (let step = 0; step < 80; step += 1) {
        const previous = await page.evaluateHandle(
          () => document.activeElement,
        );
        await page.keyboard.press("Tab");
        if (
          await disclosure.evaluate(
            (element) => element === document.activeElement,
          )
        ) {
          await page.keyboard.press("Shift+Tab");
          expect(
            await previous.evaluate(
              (element) => element === document.activeElement,
            ),
          ).toBe(true);
          await page.keyboard.press("Tab");
          await expect(disclosure).toBeFocused();
          reachedDisclosure = true;
          await previous.dispose();
          break;
        }
        await previous.dispose();
      }
      expect(reachedDisclosure).toBe(true);

      await disclosure.focus();
      await page.keyboard.press("Tab");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(disclosure).toBeFocused();

      await trigger.click();
      await expect(frame).not.toHaveAttribute("data-figure-maximized");
    });
  }
});

test("should keep figure content visible and controls dormant without JavaScript", async ({
  browser,
  componentsViewerUrl,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(componentsViewerUrl);

  for (const figureCase of FIGURE_CASES) {
    const frame = page.locator(figureCase.selector).first();
    await expect(frame).toBeVisible();
    await expect(frame.locator("[data-figure-maximize]")).toBeHidden();
    await expect(frame).not.toHaveAttribute("data-figure-maximized");
  }
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-figure-maximized-open",
  );

  await context.close();
});
