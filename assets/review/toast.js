// Owns transient review notifications for every browser surface.
//
// createToastManager({ document }) returns:
// - add({ title, description?, tone?, durationMs?, action? }) -> toast id
// - update(id, patch), dismiss(id), and clear()
//
// `action` is `{ label, run }`. Timers pause while a toast is hovered or
// focused, and the shared polite live region keeps notifications accessible.
// This is the vanilla-DOM adaptation of shadcn/Base UI's global toast manager:
// one viewport and imperative API, without adding a React runtime.

const VIEWPORT_CLASSES =
  "pointer-events-none fixed inset-x-4 bottom-4 z-[90] grid justify-items-end gap-2";
const TOAST_CLASSES =
  "pointer-events-auto grid w-full max-w-sm grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg border border-[var(--edge-c)] bg-[var(--bg)] p-3 text-[var(--ink-c)] shadow-lg data-[tone=danger]:border-[var(--callout-danger-c)] data-[tone=danger]:bg-[var(--callout-danger-bg)]";

const make = (document, tag, attributes = {}) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "text") node.textContent = String(value);
    else node.setAttribute(name, String(value));
  }
  return node;
};

export const createToastManager = ({ document }) => {
  const viewport = make(document, "section", {
    class: VIEWPORT_CLASSES,
    "data-review-toast-viewport": "",
    "aria-label": "Notifications",
    "aria-live": "polite",
    "aria-relevant": "additions text",
  });
  document.body.appendChild(viewport);
  const records = new Map();
  let nextId = 0;

  const dismiss = (id) => {
    const record = records.get(id);
    if (!record) return;
    window.clearTimeout(record.timer);
    record.node.remove();
    records.delete(id);
  };

  const schedule = (record) => {
    window.clearTimeout(record.timer);
    if (record.remaining <= 0) {
      dismiss(record.id);
      return;
    }
    record.startedAt = Date.now();
    record.timer = window.setTimeout(
      () => dismiss(record.id),
      record.remaining,
    );
  };

  const pause = (record) => {
    window.clearTimeout(record.timer);
    record.remaining -= Date.now() - record.startedAt;
  };

  const add = ({
    title,
    description,
    tone = "default",
    durationMs = 5000,
    action,
  }) => {
    const id = `review-toast-${++nextId}`;
    const node = make(document, "article", {
      class: TOAST_CLASSES,
      "data-review-toast": "",
      "data-toast-id": id,
      "data-tone": tone,
      role: "status",
    });
    const copy = make(document, "div", {
      class: "min-w-0 [overflow-wrap:anywhere]",
    });
    copy.appendChild(
      make(document, "strong", {
        class: "block text-xs font-semibold",
        "data-review-toast-title": "",
        text: title,
      }),
    );
    if (description) {
      copy.appendChild(
        make(document, "p", {
          class: "mt-0.5 text-xs text-[var(--muted-c)]",
          "data-review-toast-description": "",
          text: description,
        }),
      );
    }
    const controls = make(document, "div", {
      class: "flex items-start gap-1",
    });
    if (action) {
      const actionButton = make(document, "button", {
        class:
          "cursor-pointer rounded px-1.5 py-0.5 text-xs font-semibold text-[var(--accent-c)] hover:bg-[var(--review-control-hover)] active:opacity-65",
        type: "button",
        "data-review-toast-action": "",
        text: action.label,
      });
      actionButton.addEventListener("click", async () => {
        dismiss(id);
        await action.run();
      });
      controls.appendChild(actionButton);
    }
    const close = make(document, "button", {
      class:
        "cursor-pointer rounded px-1 text-sm leading-none text-[var(--muted-c)] hover:text-[var(--ink-c)] active:opacity-65",
      type: "button",
      "data-review-toast-dismiss": "",
      "aria-label": "Dismiss notification",
      text: "×",
    });
    close.addEventListener("click", () => dismiss(id));
    controls.appendChild(close);
    node.append(copy, controls);
    const record = {
      id,
      node,
      timer: 0,
      remaining: Math.max(0, durationMs),
      startedAt: Date.now(),
    };
    records.set(id, record);
    node.addEventListener("pointerenter", () => pause(record));
    node.addEventListener("pointerleave", () => schedule(record));
    node.addEventListener("focusin", () => pause(record));
    node.addEventListener("focusout", (event) => {
      if (!node.contains(event.relatedTarget)) schedule(record);
    });
    viewport.appendChild(node);
    schedule(record);
    return id;
  };

  const update = (id, patch) => {
    const record = records.get(id);
    if (!record) return;
    if (patch.title !== undefined) {
      record.node.querySelector("[data-review-toast-title]").textContent =
        patch.title;
    }
    if (patch.description !== undefined) {
      const description = record.node.querySelector(
        "[data-review-toast-description]",
      );
      if (description) description.textContent = patch.description;
    }
  };

  return {
    add,
    update,
    dismiss,
    clear: () => [...records.keys()].forEach(dismiss),
  };
};
