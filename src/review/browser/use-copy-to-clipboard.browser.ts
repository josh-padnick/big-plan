// Copies text with a synchronous fallback, reports the result, and cleans up
// transient feedback when a control unmounts or a later attempt supersedes it.

import { useEffect, useRef, useState } from "react";

/*
The async clipboard, then the synchronous fallback that still works where it is
absent.

`navigator.clipboard` exists only on a secure context, and a Big Plan review is
routinely read over plain http - a proxied tailnet origin is the case the captain
hit - where it is `undefined`. Left there, the copy silently did nothing and the
control never confirmed (BIG-281). The fallback selects the value in an offscreen
textarea and asks the document to copy the selection, which every browser that
lacks the async API still honours from inside a user gesture. It is reached
synchronously - before any `await` - so the click that triggered it is still the
gesture the copy runs under.
*/
const legacyExecCopy = (value: string): boolean => {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  // Out of the layout and out of sight, but still selectable: a display:none or
  // an unappended node cannot hold the selection execCommand copies from.
  textarea.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;opacity:0;pointer-events:none;";
  const selection = document.getSelection();
  const priorRange =
    selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : null;
  const priorActiveElement = document.activeElement;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  if (
    priorActiveElement instanceof HTMLElement &&
    priorActiveElement.isConnected
  ) {
    priorActiveElement.focus();
  }
  // Leave the reader's own selection as it was, not collapsed onto our textarea.
  if (priorRange !== null && selection !== null) {
    selection.removeAllRanges();
    selection.addRange(priorRange);
  }
  return copied;
};

/*
Copying one string, with the outcome shown on the control that did it.

Three surfaces need this now - the recovery payload, a session identifier that
cannot be linked, and the session id in the details - and each needs the same
three states and the same failure wording. The behaviour lives here; the shape
of the control is the caller's.
*/
export const useCopyToClipboard = (value: string) => {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const resetTimeout = useRef<number | undefined>(undefined);
  const copyAttempt = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimeout.current !== undefined) {
        window.clearTimeout(resetTimeout.current);
      }
    };
  }, []);
  const copy = async () => {
    const attempt = copyAttempt.current + 1;
    copyAttempt.current = attempt;
    if (resetTimeout.current !== undefined) {
      window.clearTimeout(resetTimeout.current);
      resetTimeout.current = undefined;
    }
    setCopied(false);
    setFailed(false);
    // The synchronous fallback first where the async API is absent, so the copy
    // runs inside the click gesture rather than after an await has spent it.
    let didCopy: boolean;
    if (navigator.clipboard?.writeText === undefined) {
      didCopy = legacyExecCopy(value);
    } else {
      try {
        await navigator.clipboard.writeText(value);
        didCopy = true;
      } catch {
        // A present-but-refused clipboard (permission, transient failure) still
        // gets the fallback its absence would have.
        didCopy = legacyExecCopy(value);
      }
    }
    if (!mounted.current || attempt !== copyAttempt.current) return;
    if (!didCopy) {
      setFailed(true);
      return;
    }
    setCopied(true);
    resetTimeout.current = window.setTimeout(() => {
      resetTimeout.current = undefined;
      setCopied(false);
    }, 1_500);
  };
  return { copied, failed, copy };
};

/** Names a copy control by what it does and what just happened. */
export const copyControlLabel = ({
  label,
  copied,
  failed,
}: {
  readonly label: string;
  readonly copied: boolean;
  readonly failed: boolean;
}): string =>
  failed
    ? "Copy failed — select and copy manually"
    : copied
      ? `${label} copied`
      : `Copy ${label}`;
