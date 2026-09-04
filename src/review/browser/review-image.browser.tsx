// Presents one picture in the review island: a thumbnail that opens an
// accessible, focus-restoring lightbox, and an honest placeholder when the
// picture cannot be loaded.
//
// The caller resolves the source, because the pictures worth zooming come from
// two places. A reviewer's own attachment is addressed by content digest, so
// it survives every later review session of the same plan; a picture the plan
// itself holds is already loaded in the article, and its resolved source is
// what the browser worked out. Owning one lightbox rather than two is what
// keeps a zoom control reading the same wherever a reader meets a picture.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IMAGE_OFF_ICON } from "../../icons/lucide/image-off.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { Icon } from "./icon.browser.js";
import { Button } from "./ui.browser.js";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

// The lightbox borrows the figure toolbar's vocabulary rather than inventing a
// second one, so the same control reads the same way over a picture as it does
// over a diagram - and, because every colour is a role, it reads correctly in
// both appearances instead of assuming a dark ground.
const CONTROL_CLASSES =
  "inline-flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:h-9 wide:min-w-0 [&_svg]:size-3.5";
const CONTROL_GROUP_CLASSES =
  "inline-flex h-11 shrink-0 items-center overflow-hidden rounded-md border border-edge bg-raised shadow-floating wide:h-9";

/**
 * Says that a picture is missing instead of leaving a bare box the reader has
 * to interpret. The reason is one disclosure away: it explains the failure to
 * a reader who wants it without spending the space on every reader who does
 * not. One load failure covers several causes - a stopped review runtime, a
 * request that failed, a file the runtime could not read, and a picture the
 * plan no longer holds - and the island cannot tell them apart from an image
 * error alone, so the words name the possibilities instead of asserting one.
 */
const UnavailableImage = ({ alt }: { readonly alt: string }) => (
  <span
    className="mt-2 inline-block max-w-full rounded-md border border-edge bg-surface p-2 text-xs text-muted"
    data-review-image-unavailable=""
  >
    <span className="flex items-center gap-1.5 font-medium [&_svg]:size-4 [&_svg]:shrink-0">
      <Icon icon={IMAGE_OFF_ICON} />
      Image unavailable
    </span>
    <details className="mt-1">
      <summary className="min-h-11 min-w-11 cursor-pointer py-3 text-2xs text-subtle underline-offset-2 hover:text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent wide:min-h-0 wide:min-w-0 wide:py-0">
        What happened
      </summary>
      <span className="mt-1 block text-2xs leading-normal text-subtle">
        Big Plan could not load “{alt === "" ? "Screenshot" : alt}”. The review
        runtime may be stopped, or this plan may no longer hold the picture.
      </span>
    </details>
  </span>
);

export const ReviewImage = ({
  source,
  alt,
  className,
}: {
  /** The already-resolved picture address. */
  readonly source: string;
  readonly alt: string;
  /** Spacing the surrounding flow owns; the thumbnail carries none itself. */
  readonly className?: string;
}) => {
  const [isBroken, setIsBroken] = useState(false);
  const [isLightboxBroken, setIsLightboxBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setIsLightboxBroken(false);
    setZoom(1);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (open) {
      setZoom(1);
      closeButton.current?.focus();
    }
  }, [open]);
  // A dialog rendered inside a composer popover would inherit that popover's
  // stacking context and open underneath the surfaces around it, so it is
  // portalled to the document body where its own layer applies.
  const lightbox =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={dialog}
            className="fixed inset-0 z-50 flex flex-col gap-3 bg-backdrop/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={alt}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key !== "Tab") return;
              // The lightbox is modal, so the keyboard cycles inside it
              // instead of walking back into the plan behind the scrim.
              event.stopPropagation();
              event.preventDefault();
              const focusable = Array.from(
                dialog.current?.querySelectorAll<HTMLElement>("*") ?? [],
              ).filter(
                (element) =>
                  element.tabIndex >= 0 &&
                  !element.matches(":disabled") &&
                  element.getClientRects().length > 0,
              );
              if (focusable.length === 0) return;
              const current =
                document.activeElement instanceof HTMLElement
                  ? focusable.indexOf(document.activeElement)
                  : -1;
              const step = event.shiftKey ? -1 : 1;
              const next =
                current === -1
                  ? 0
                  : (current + step + focusable.length) % focusable.length;
              focusable[next]?.focus();
            }}
          >
            {/* The captain placed zoom above the picture: at the top centre it
                sits over the widest part of every picture, and both it and the
                close control stay inside the viewport however tall the
                picture is. */}
            <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
              <span
                className={`${CONTROL_GROUP_CLASSES} col-start-2`}
                role="group"
                aria-label="Image zoom"
              >
                <button
                  type="button"
                  className={CONTROL_CLASSES}
                  aria-label="Zoom out"
                  onClick={() =>
                    setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))
                  }
                >
                  <Icon icon={MINUS_ICON} />
                </button>
                <span
                  className="flex h-11 min-w-12 items-center justify-center border-x border-edge px-2 text-2xs tabular-nums text-muted wide:h-9"
                  aria-live="polite"
                >
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className={CONTROL_CLASSES}
                  aria-label="Zoom in"
                  onClick={() =>
                    setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))
                  }
                >
                  <Icon icon={PLUS_ICON} />
                </button>
                <button
                  type="button"
                  className={`${CONTROL_CLASSES} gap-1.5 border-l border-edge text-2xs font-semibold`}
                  aria-label="Fit image"
                  aria-pressed={zoom === 1}
                  onClick={() => setZoom(1)}
                >
                  <Icon icon={SCAN_ICON} />
                  Fit
                </button>
              </span>
              <Button
                ref={closeButton}
                variant="secondary"
                size="compactIcon"
                className="col-start-3 justify-self-end shadow-floating"
                aria-label="Close image"
                onClick={close}
              >
                <Icon icon={X_ICON} />
              </Button>
            </div>
            {/* A zoomed picture is meant to overflow this stage and be
                scrolled to, so clamping the track to the viewport would take
                the lightbox's reach away. */}
            {/* eslint-disable-next-line no-restricted-syntax */}
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto">
              {isLightboxBroken ? (
                <UnavailableImage alt={alt} />
              ) : (
                <img
                  src={source}
                  alt={alt}
                  className="max-h-full max-w-full rounded-md object-contain shadow-floating motion-reduce:transition-none"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center",
                  }}
                  onError={() => setIsLightboxBroken(true)}
                />
              )}
            </div>
          </div>,
          document.body,
        )
      : null;
  if (isBroken) return <UnavailableImage alt={alt} />;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`block cursor-zoom-in rounded border border-edge p-0.5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent${className === undefined ? "" : ` ${className}`}`}
        aria-label={`Open ${alt}`}
        onClick={() => {
          setIsLightboxBroken(false);
          setOpen(true);
        }}
      >
        <img
          src={source}
          alt={alt}
          className="h-12 w-16 rounded object-cover"
          onError={() => setIsBroken(true)}
        />
      </button>
      {lightbox}
    </>
  );
};
