// Browser tests of the review toolbar's chrome: the plan title has room for the
// glyphs it draws, and the toolbar reads as its own band with control edges a
// reader can see in every palette and both halves of each one. Render-health
// failures are enforced by the fixtures module.

import {
  PALETTES,
  PREFERENCES_STORAGE_KEY,
  serializePreferencesRecord,
  type Palette,
} from "../src/render/preferences.js";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "./fixtures";

const NON_TEXT_FLOOR = 3;

// BIG-214 makes these labeled review-panel controls subtle only in light mode.
// Dark mode keeps the general 3:1 edge that the captain prefers there.
const REVIEW_PANEL_EDGE_CONTRAST_FLOORS = {
  light: 1.4,
  dark: NON_TEXT_FLOOR,
} as const;
const REVIEW_PANEL_LABELS = new Set(["Agent Status", "Feedback"]);
// BIG-130's filled pastel Approve control is a labeled secondary action whose
// sage edge is quieter than this chrome-edge floor on purpose.
const APPROVE_ACTION_LABELS = new Set([
  "Approve plan",
  "Plan approved",
  "Re-approve",
]);

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (color: string): number => {
  const parts = (color.match(/[\d.]+/gu) ?? []).map(Number);
  const [red, green, blue] = parts;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`unreadable colour: ${color}`);
  }
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
};

const contrastRatio = (left: string, right: string): number => {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const isOpaque = (color: string): boolean =>
  !/rgba\([^)]*,\s*0?\.?\d*\s*\)$/u.test(color) ||
  (color.match(/[\d.]+/gu) ?? []).length < 4 ||
  Number((color.match(/[\d.]+/gu) ?? [])[3]) === 1;

const applyTheme = async (
  page: Page,
  {
    mode,
    palette,
  }: { readonly mode: "light" | "dark"; readonly palette: Palette },
): Promise<void> => {
  await page.evaluate(([key, record]) => localStorage.setItem(key, record), [
    PREFERENCES_STORAGE_KEY,
    serializePreferencesRecord({ mode, palette }),
  ] as const);
  await page.reload();
  await page.waitForSelector("header[data-shell-chrome]");
};

// The regression BIG-177 records: `truncate` clips at the line box, so a
// container that also tightens its leading below the type step's own value
// hands the font a box shorter than the inline box it asked to draw, and every
// descender below the baseline is sliced flat. Measuring the inline box against
// the clipping box catches that whatever produced it.
test("should keep the toolbar plan title's descenders inside its clipping box", async ({
  page,
  descenderTitleViewerUrl,
}) => {
  await page.goto(descenderTitleViewerUrl);
  const title = page.locator("[data-plan-title]");
  await expect(title).toHaveText("Paging quality: agent typography guardrails");

  const box = await title.evaluate((span) => {
    const clip = span.parentElement;
    if (clip === null) throw new Error("the plan title has no clipping box");
    const range = document.createRange();
    range.selectNodeContents(span);
    const inline = range.getBoundingClientRect();
    const clipped = clip.getBoundingClientRect();
    const style = getComputedStyle(clip);
    return {
      overflow: style.overflow,
      clipHeight: clipped.height,
      inlineHeight: inline.height,
      belowClip: inline.bottom - clipped.bottom,
      aboveClip: clipped.top - inline.top,
    };
  });

  // The container is still the truncating one; the room is what changed.
  expect(box.overflow).toBe("hidden");
  expect(box.clipHeight).toBeGreaterThanOrEqual(box.inlineHeight);
  expect(box.belowClip).toBeLessThanOrEqual(0);
  expect(box.aboveClip).toBeLessThanOrEqual(0);

  const center = await title.evaluate((span) => {
    const box = span.getBoundingClientRect();
    return {
      titleCenter: box.left + box.width / 2,
      viewportCenter: window.innerWidth / 2,
    };
  });
  expect(Math.abs(center.titleCenter - center.viewportCenter)).toBeLessThan(12);
});

// BIG-178: the toolbar is chrome, not the first inch of the plan, so it carries
// its own opaque ground one step off the page in every palette, and the
// controls standing on it keep a visible edge and a ground that lifts.
test("should give the toolbar its own band and legible control edges in every palette", async ({
  page,
  reviewRuntimeUrl,
}) => {
  test.setTimeout(180_000);
  await page.goto(reviewRuntimeUrl);
  await page.waitForSelector("header[data-shell-chrome]");

  for (const palette of PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      await applyTheme(page, { mode, palette });

      const chrome = await page.evaluate(() => {
        const header = document.querySelector("header[data-shell-chrome]");
        if (header === null) throw new Error("no toolbar");
        const article = document.querySelector("article") ?? document.body;
        const readable = (element: Element): string => {
          let node: Element | null = element;
          while (node !== null) {
            const background = getComputedStyle(node).backgroundColor;
            if (background !== "rgba(0, 0, 0, 0)") return background;
            node = node.parentElement;
          }
          return getComputedStyle(document.documentElement).backgroundColor;
        };
        const edged = [
          ...document.querySelectorAll<HTMLElement>("header button"),
        ].filter(
          (button) =>
            button.offsetParent !== null &&
            getComputedStyle(button).borderTopWidth !== "0px",
        );
        return {
          band: getComputedStyle(header).backgroundColor,
          page: readable(article),
          edges: edged.map((button) => ({
            label: button.getAttribute("aria-label") ?? button.textContent,
            color: getComputedStyle(button).borderTopColor,
          })),
        };
      });

      const where = `${palette}/${mode}`;
      expect(
        chrome.edges.length,
        `${where} has an edged toolbar control`,
      ).toBeGreaterThan(0);
      // A translucent bar would take its colour from whatever scrolled under
      // it, which is the distinction the band exists to make.
      expect(isOpaque(chrome.band), `${where} toolbar band is opaque`).toBe(
        true,
      );
      expect(
        chrome.band,
        `${where} toolbar band differs from the page`,
      ).not.toBe(chrome.page);
      for (const edge of chrome.edges) {
        if (
          [...APPROVE_ACTION_LABELS].some((label) =>
            edge.label?.startsWith(label),
          )
        ) {
          continue;
        }
        const isReviewPanel = [...REVIEW_PANEL_LABELS].some((label) =>
          edge.label?.startsWith(label),
        );
        const floor = isReviewPanel
          ? REVIEW_PANEL_EDGE_CONTRAST_FLOORS[mode]
          : NON_TEXT_FLOOR;
        expect(
          contrastRatio(edge.color, chrome.band),
          `${where} edge on "${edge.label}" against the band`,
        ).toBeGreaterThanOrEqual(floor);
      }

      // The ground a control takes under the pointer is measured from the
      // band, so it lifts in both halves rather than sinking in the dark one.
      const control = page.getByRole("button", { name: "Feedback" });
      await control.hover();
      const lift = await control.evaluate(
        (button) => getComputedStyle(button).backgroundColor,
      );
      expect(
        luminance(lift),
        `${where} hovered control lifts off the band`,
      ).toBeGreaterThan(luminance(chrome.band));
      await page.mouse.move(0, 400);
    }
  }
});

// The value the brief names for the product palette, checked where a reader
// sees it rather than where it is declared.
test("should paint the default light toolbar the requested chrome grey", async ({
  page,
  descenderTitleViewerUrl,
}) => {
  await page.goto(descenderTitleViewerUrl);
  await applyTheme(page, { mode: "light", palette: "default" });
  // Both chrome bands - the toolbar and the sections bar under it at narrow
  // widths - are one continuous band rather than a partially tinted strip.
  for (const band of await page.locator("[data-shell-chrome]").all()) {
    await expect(band).toHaveCSS("background-color", "rgb(232, 232, 232)");
  }
});

test("should split the default review-panel edges by theme", async ({
  descenderTitleViewerUrl,
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const agentStatus = page.getByRole("button", { name: "Agent Status" });
  const feedback = page.getByRole("button", { name: "Feedback" });

  await applyTheme(page, { mode: "light", palette: "default" });
  await expect(agentStatus).toHaveCSS("border-top-color", "rgb(196, 196, 196)");
  await expect(feedback).toHaveCSS("border-top-color", "rgb(196, 196, 196)");

  await applyTheme(page, { mode: "dark", palette: "default" });
  await expect(agentStatus).toHaveCSS("border-top-color", "rgb(118, 118, 118)");
  await expect(feedback).toHaveCSS("border-top-color", "rgb(118, 118, 118)");

  await page.goto(descenderTitleViewerUrl);
  const addComment = page.locator("[data-comment-draft-open]");
  await applyTheme(page, { mode: "light", palette: "default" });
  await expect(addComment).toHaveCSS("border-top-color", "rgb(130, 130, 130)");
  await applyTheme(page, { mode: "dark", palette: "default" });
  await expect(addComment).toHaveCSS("border-top-color", "rgb(118, 118, 118)");
});

test("should put Export then Settings in the live More actions menu only", async ({
  page,
  reviewRuntimeUrl,
  sampleViewerUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  await expect(
    page.getByRole("button", { name: "Approve plan" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Feedback" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Agent Status" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeHidden();

  const more = page.getByRole("button", { name: "More actions" });
  await expect(more).toHaveAttribute("aria-haspopup", "menu");
  await more.click();
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Export", "Settings"]);

  await menu.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();

  await page.goto(sampleViewerUrl);
  await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
});

test("should keyboard-dismiss the More actions menu and return focus", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const more = page.getByRole("button", { name: "More actions" });
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Export" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem", { name: "Export" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await page.locator("article").click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("should hold the export dialog pending and recover from a refusal", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.addInitScript(() => {
    const fetchRuntime = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input) !== "/api/export-markdown") {
        return fetchRuntime(input, init);
      }
      return new Promise<Response>((resolve) => {
        window.addEventListener(
          "bigplan:test-release-export",
          () =>
            resolve(
              new Response(
                JSON.stringify({
                  error:
                    "Review state changed while the export was being prepared.",
                }),
                {
                  status: 409,
                  headers: { "content-type": "application/json" },
                },
              ),
            ),
          { once: true },
        );
      });
    };
  });
  await page.goto(reviewRuntimeUrl);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Export this plan as Markdown?",
  });
  await dialog.getByRole("button", { name: "Export" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Preparing export...");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Export" })).toBeDisabled();

  await page.evaluate(() =>
    window.dispatchEvent(new Event("bigplan:test-release-export")),
  );
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Export" })).toBeEnabled();
  await expect(page.getByText("The plan could not be exported.")).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("should confirm and download the latest plan as Markdown", async ({
  page,
  reviewRuntimeUrl,
}) => {
  await page.goto(reviewRuntimeUrl);
  const more = page.getByRole("button", { name: "More actions" });
  await more.click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Export this plan as Markdown?",
  });
  await expect(dialog).toContainText(
    "Download the latest saved plan as a Markdown file. Draft agent edits and comments are not included.",
  );

  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("plan.md");
  const path = await download.path();
  if (path === null) throw new Error("Markdown download had no local path");
  expect(await readFile(path, "utf8")).toContain("# Review persistence");
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(
    page.getByRole("status").filter({ hasText: "Downloaded plan.md." }),
  ).toBeAttached();
});
