// Presents the slide-by-slide evidence shown before deleting a thread.
// Plan identity stays with live-target; this surface only reads its results.

import { useId, useState } from "react";
import { CHEVRON_RIGHT_ICON } from "../../icons/lucide/chevron-right.js";
import { planLossChangeCount } from "../shared/plan-loss.js";
import type { PlanSlideLoss } from "../shared/plan-loss.js";
import { foundElement, liveBlock, liveArticle } from "./live-target.browser.js";
import { Icon } from "./icon.browser.js";
import { ReviewImage } from "./review-image.browser.js";

const PLAN_LOSS_SLIDE_LIMIT = 6;

/** The live slide a scope names, preferring the block the diff pointed at. */
const liveSlideOf = ({
  scope,
  anchorBlockId,
}: {
  readonly scope: string;
  readonly anchorBlockId: string | undefined;
}): HTMLElement | null => {
  const fromBlock =
    anchorBlockId === undefined
      ? null
      : foundElement(liveBlock(anchorBlockId))?.closest<HTMLElement>(
          "[data-slide]",
        );
  if (fromBlock != null) return fromBlock;
  // A scope is the slide heading's own anchor id under a "section/" prefix,
  // so a slide whose blocks all left the plan is still reachable by name.
  const heading = liveArticle()?.querySelector<HTMLElement>(
    `#${CSS.escape(scope.replace(/^section\//u, ""))}`,
  );
  return heading?.closest<HTMLElement>("[data-slide]") ?? null;
};

/**
 * The kicker a slide shows, read from the slide the reader is looking at
 * rather than from the diff.
 *
 * The ordinal in "2 / Goals and non-goals" exists only in the rendered kicker;
 * nothing on the wire carries it. Reading the live slide is therefore not a
 * shortcut but the only way to name the slide the way the document does, and
 * it is the same walk every other surface that names a slide already makes.
 */
const readSlideKicker = (slide: PlanSlideLoss): string | undefined => {
  const kicker = liveSlideOf(slide)
    ?.querySelector<HTMLElement>("[data-slide-kicker]")
    ?.textContent?.trim();
  return kicker === "" ? undefined : kicker;
};

/** The address the browser resolved for a picture the plan is showing. */
const liveImageSource = ({
  slide,
  source,
}: {
  readonly slide: PlanSlideLoss;
  readonly source: string;
}): string => {
  const element = liveSlideOf(slide);
  const match = [
    ...(element?.querySelectorAll<HTMLImageElement>("img") ?? []),
  ].find(
    (image) =>
      image.getAttribute("src") === source || image.currentSrc.endsWith(source),
  );
  return match?.currentSrc ?? match?.src ?? source;
};

/**
 * One affected slide, drawn and behaving the way the plan draws a slide.
 *
 * A reviewer already knows this card: it is the slide, collapsed, with its own
 * kicker over its own title, and it opens the way that slide opens. What it
 * opens onto is the difference that matters here - not the slide's contents,
 * but the passages and pictures this deletion takes off it. Keeping them
 * behind the disclosure is what lets the box answer "which slides?" at a
 * glance and "what exactly?" on demand, instead of answering both at once and
 * reading as the plan reprinted inside a dialog.
 */
const PlanLossSlideRow = ({ slide }: { readonly slide: PlanSlideLoss }) => {
  const [isOpen, setIsOpen] = useState(false);
  const kicker = readSlideKicker(slide) ?? slide.title;
  const changes = `${slide.changeCount} ${slide.changeCount === 1 ? "change" : "changes"}`;
  const panelId = useId();
  return (
    <li
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border border-edge bg-raised shadow-raised"
      data-review-loss-slide={slide.scope}
      {...(isOpen ? { "data-review-loss-slide-open": "" } : {})}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-0 bg-transparent px-3 py-2 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        onClick={() => setIsOpen((open) => !open)}
      >
        {/* The chevron the plan's own slide shows, turning the way that one
            turns: right when closed, down when open. */}
        <span
          className={`text-subtle opacity-40 transition-transform [&_svg]:size-4 ${isOpen ? "rotate-90" : ""}`}
        >
          <Icon icon={CHEVRON_RIGHT_ICON} />
        </span>
        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
          <span className="truncate text-2xs font-semibold uppercase tracking-caps text-subtle">
            {kicker}
          </span>
          <span className="truncate text-sm font-semibold text-ink">
            {slide.title}
          </span>
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-muted">
          {changes}
        </span>
      </button>
      <div id={panelId} hidden={!isOpen}>
        {slide.previews.length === 0 ? (
          <p className="m-0 border-t border-edge px-3 py-2 text-xs text-muted">
            This change leaves no text or picture behind on this slide.
          </p>
        ) : (
          <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 border-t border-edge p-3">
            {slide.previews.map((preview, index) =>
              preview.shape === "image" ? (
                <li
                  key={`image-${index}`}
                  className="flex min-w-0 items-center gap-2"
                >
                  <ReviewImage
                    source={liveImageSource({
                      slide,
                      source: preview.image.source,
                    })}
                    alt={preview.image.alt}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">
                    {preview.image.alt === "" ? "Picture" : preview.image.alt}
                  </span>
                </li>
              ) : (
                <li
                  key={`text-${index}`}
                  className="min-w-0 border-l-2 border-edge pl-2 text-xs text-muted [overflow-wrap:anywhere]"
                >
                  {preview.excerpt.text}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </li>
  );
};

export const PlanLossEvidence = ({
  slides,
  loadError,
}: {
  readonly slides: ReadonlyArray<PlanSlideLoss> | undefined;
  readonly loadError: boolean;
}) => {
  const total = slides === undefined ? 0 : planLossChangeCount(slides);
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-edge bg-surface p-3"
      data-review-plan-loss=""
    >
      <p className="m-0 text-2xs font-semibold uppercase tracking-caps text-subtle">
        {slides === undefined || slides.length === 0
          ? "What you will lose"
          : `What you will lose · ${total} ${total === 1 ? "change" : "changes"} on ${slides.length === 1 ? "one slide" : `${slides.length} slides`}`}
      </p>
      {loadError ? (
        <p className="m-0 text-sm text-ink">
          Could not read what this thread wrote. Cancel and try again.
        </p>
      ) : slides === undefined ? (
        <p className="m-0 text-sm text-ink">Reading what this thread wrote…</p>
      ) : slides.length === 0 ? (
        <p className="m-0 text-sm text-ink">
          Nothing this thread proposed is still waiting on you, so the plan
          keeps exactly what it holds now.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
          {slides.slice(0, PLAN_LOSS_SLIDE_LIMIT).map((slide) => (
            <PlanLossSlideRow key={slide.scope} slide={slide} />
          ))}
          {slides.length > PLAN_LOSS_SLIDE_LIMIT ? (
            <li className="text-xs text-muted">{`and ${slides.length - PLAN_LOSS_SLIDE_LIMIT} more slides`}</li>
          ) : null}
        </ul>
      )}
    </div>
  );
};
