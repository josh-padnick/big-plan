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
import { expect, test, type Page } from "./fixtures";

const NON_TEXT_FLOOR = 3;

// BIG-214 makes only these labeled review-panel controls intentionally subtle.
// This product floor guards visible separation without treating the border as
// their only identifying cue or making a WCAG 1.4.11 claim for it.
const REVIEW_PANEL_EDGE_CONTRAST_FLOOR = 1.4;
const REVIEW_PANEL_LABELS = new Set(["Agent Status", "Feedback"]);

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
        const isReviewPanel = [...REVIEW_PANEL_LABELS].some((label) =>
          edge.label?.startsWith(label),
        );
        const floor = isReviewPanel
          ? REVIEW_PANEL_EDGE_CONTRAST_FLOOR
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

test("should scope the default subtle edges to Agent Status and Feedback", async ({
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
  await expect(agentStatus).toHaveCSS("border-top-color", "rgb(71, 71, 71)");
  await expect(feedback).toHaveCSS("border-top-color", "rgb(71, 71, 71)");

  await page.goto(descenderTitleViewerUrl);
  const addComment = page.locator("[data-comment-draft-open]");
  await applyTheme(page, { mode: "light", palette: "default" });
  await expect(addComment).toHaveCSS("border-top-color", "rgb(130, 130, 130)");
  await applyTheme(page, { mode: "dark", palette: "default" });
  await expect(addComment).toHaveCSS("border-top-color", "rgb(118, 118, 118)");
});
