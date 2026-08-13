// Fetches reviewer-owned image blobs with the session token and presents a
// thumbnail that opens in one accessible, focus-restoring dialog.

import { useEffect, useRef, useState } from "react";
import { X_ICON } from "../../icons/lucide/x.js";
import { Icon } from "./icon.browser.js";
import { Button } from "./ui.browser.js";

export type ReviewImageIdentity = { readonly token: string };

/** Reads the token injected into the live review document, if present. */
export const runtimeReviewImageIdentity = (): ReviewImageIdentity | null => {
  const token = document.documentElement.getAttribute("data-review-token");
  return token === null || token === "" ? null : { token };
};

export const ReviewImage = ({
  id,
  alt,
  identity,
}: {
  readonly id: string;
  readonly alt: string;
  readonly identity: ReviewImageIdentity | null;
}) => {
  const [url, setUrl] = useState<string>();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setZoom(1);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  useEffect(() => {
    if (identity === null) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    void fetch(`/api/review-images?id=${encodeURIComponent(id)}`, {
      headers: { "x-big-plan-review-token": identity.token },
    })
      .then(async (response) => {
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [id, identity]);
  useEffect(() => {
    if (open) {
      setZoom(1);
      closeButton.current?.focus();
    }
  }, [open]);
  if (url === undefined)
    return <span className="text-xs text-subtle">Image unavailable</span>;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mt-2 block cursor-zoom-in rounded border border-edge p-0.5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Open ${alt}`}
        onClick={() => setOpen(true)}
      >
        <img src={url} alt={alt} className="h-12 w-16 rounded object-cover" />
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--ink-c)_60%,transparent)] p-4"
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
            if (event.key === "Tab") {
              event.stopPropagation();
              event.preventDefault();
              closeButton.current?.focus();
            }
          }}
        >
          <div className="flex max-h-full max-w-full flex-col items-end gap-2">
            <div className="flex w-full justify-end">
              <Button
                ref={closeButton}
                variant="secondary"
                size="compactIcon"
                className="border border-white/50 bg-paper! text-ink shadow-floating"
                aria-label="Close image"
                onClick={close}
              >
                <Icon icon={X_ICON} />
              </Button>
            </div>
            <div className="max-h-[calc(100vh-8rem)] max-w-full overflow-auto rounded-sm bg-[color-mix(in_srgb,var(--ink-c)_20%,transparent)] p-1 shadow-floating">
              <img
                src={url}
                alt={alt}
                className="max-h-[calc(100vh-8.5rem)] max-w-[min(92vw,72rem)] rounded-sm object-contain motion-reduce:transition-none"
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "center",
                }}
              />
            </div>
            <div className="flex items-center gap-1 rounded-md border border-white/30 bg-[color-mix(in_srgb,var(--ink-c)_60%,transparent)] p-1 text-white">
              <Button
                variant="ghost"
                size="compactIcon"
                className="text-white hover:bg-white/20 hover:text-white"
                aria-label="Zoom out"
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
              >
                −
              </Button>
              <Button
                variant="ghost"
                size="compact"
                className="min-w-16 text-white hover:bg-white/20 hover:text-white"
                aria-label="Fit image"
                onClick={() => setZoom(1)}
              >
                Fit image
              </Button>
              <Button
                variant="ghost"
                size="compactIcon"
                className="text-white hover:bg-white/20 hover:text-white"
                aria-label="Zoom in"
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
              >
                +
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
