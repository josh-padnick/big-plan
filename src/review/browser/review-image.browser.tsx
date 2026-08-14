// Presents one reviewer-uploaded picture: a thumbnail that opens an
// accessible, focus-restoring lightbox, and an honest placeholder when the
// picture cannot be loaded. The source path names only the content digest, so
// the picture survives every later review session of the same plan.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IMAGE_OFF_ICON } from "../../icons/lucide/image-off.js";
import { MINUS_ICON } from "../../icons/lucide/minus.js";
import { PLUS_ICON } from "../../icons/lucide/plus.js";
import { SCAN_ICON } from "../../icons/lucide/scan.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { reviewImageSource } from "../shared/review-image.js";
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
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent px-2 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5";
const CONTROL_GROUP_CLASSES =
  "inline-flex h-9 shrink-0 items-center overflow-hidden rounded-md border border-edge bg-raised shadow-floating";

/**
 * Says that a picture is missing instead of leaving a bare box the reader has
 * to interpret. The reason is one disclosure away: it explains the failure to
 * a reader who wants it without spending the space on every reader who does
 * not.
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
      <summary className="cursor-pointer text-2xs text-subtle underline-offset-2 hover:text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        What happened
      </summary>
      <span className="mt-1 block text-2xs leading-normal text-subtle">
        This plan no longer holds the picture “{alt === "" ? "Screenshot" : alt}
        ”. It was removed from the plan's review store, or it was uploaded to a
        different plan.
      </span>
    </details>
  </span>
);

export const ReviewImage = ({
  id,
  alt,
}: {
  readonly id: string;
  readonly alt: string;
}) => {
  const [isBroken, setIsBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const source = reviewImageSource(id);
  const close = () => {
    setOpen(false);
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
              const controls = Array.from(
                dialog.current?.querySelectorAll("button") ?? [],
              );
              if (controls.length === 0) return;
              const current = controls.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const step = event.shiftKey ? -1 : 1;
              const next =
                current === -1
                  ? 0
                  : (current + step + controls.length) % controls.length;
              controls[next]?.focus();
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
                  className="flex h-9 min-w-12 items-center justify-center border-x border-edge px-2 text-2xs tabular-nums text-muted"
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
                className="col-start-3 justify-self-end border border-edge shadow-floating"
                aria-label="Close image"
                onClick={close}
              >
                <Icon icon={X_ICON} />
              </Button>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto">
              <img
                src={source}
                alt={alt}
                className="max-h-full max-w-full rounded-md object-contain shadow-floating motion-reduce:transition-none"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center",
                }}
              />
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
        className="mt-2 block cursor-zoom-in rounded border border-edge p-0.5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Open ${alt}`}
        onClick={() => setOpen(true)}
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
