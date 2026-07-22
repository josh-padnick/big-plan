// Host side of the embed full-screen handshake (the embed side lives in the
// renderer's full-screen.browser.ts; keep the message type in sync). When an
// embedded document opens its full-screen dialog it posts
// { type: "big-plan:embed-fullscreen", active } to its parent; this script
// answers by expanding that iframe to a fixed, viewport-covering overlay
// above the docs chrome - so the embed's dialog, which fills its frame,
// reads exactly like the viewer's own modal - and restores the frame when
// the dialog closes. Plain JavaScript (not TypeScript) so the renderer's
// Playwright host fixture can inline this exact source and test the real
// script. One listener serves every ThemeFrame on the page; event.source is
// validated against the ThemeFrame iframes so arbitrary frames cannot drive
// the expansion.

const EMBED_FULLSCREEN_MESSAGE = "big-plan:embed-fullscreen";

/** @type {HTMLIFrameElement | null} The frame currently expanded, if any. */
let expandedFrame = null;

/** @type {(() => void) | null} Undoes the active expansion, if any. */
let restoreExpandedFrame = null;

/** @param {HTMLIFrameElement} frame */
const expandFrame = (frame) => {
  const frameStyle = frame.getAttribute("style");
  const hostOverflow = document.documentElement.style.overflow;
  // A manual popover promotes the frame to the top layer in place - above
  // every stacking context the docs layout creates, with no DOM move (which
  // would reload the iframe and lose the open dialog). Without the Popover
  // API, fixed positioning with a high z-index is the best-effort fallback.
  const usePopover = typeof frame.showPopover === "function";
  frame.style.position = "fixed";
  frame.style.inset = "0";
  frame.style.width = "100vw";
  frame.style.height = "100vh";
  // Neither the content flow's margins nor the popover's default padding
  // may offset or oversize a viewport overlay.
  frame.style.margin = "0";
  frame.style.padding = "0";
  frame.style.boxSizing = "border-box";
  frame.style.border = "0";
  frame.style.borderRadius = "0";
  if (usePopover) {
    frame.setAttribute("popover", "manual");
    frame.showPopover();
  } else {
    frame.style.zIndex = "9999";
  }
  // The overlay owns the only scroll surface while it is open.
  document.documentElement.style.overflow = "hidden";
  expandedFrame = frame;
  restoreExpandedFrame = () => {
    if (usePopover) {
      frame.hidePopover();
      frame.removeAttribute("popover");
    }
    if (frameStyle === null) {
      frame.removeAttribute("style");
    } else {
      frame.setAttribute("style", frameStyle);
    }
    document.documentElement.style.overflow = hostOverflow;
    expandedFrame = null;
    restoreExpandedFrame = null;
  };
};

window.addEventListener("message", (event) => {
  const data = event.data;
  if (
    typeof data !== "object" ||
    data === null ||
    data.type !== EMBED_FULLSCREEN_MESSAGE
  ) {
    return;
  }
  const frames = document.querySelectorAll("iframe[data-theme-frame]");
  const frame = [...frames].find(
    (candidate) => candidate.contentWindow === event.source,
  );
  if (!(frame instanceof HTMLIFrameElement)) {
    return;
  }
  if (data.active === true && expandedFrame === null) {
    expandFrame(frame);
  } else if (
    data.active === false &&
    frame === expandedFrame &&
    restoreExpandedFrame !== null
  ) {
    restoreExpandedFrame();
  }
});
