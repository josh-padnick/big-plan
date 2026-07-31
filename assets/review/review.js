// The reviewer's half of plan commenting, authored as the one browser script
// a rendered plan ships for review. scripts/gen-review-script.mjs bundles it
// into src/render/shell/review-script.generated.ts; the shell embeds that
// module, so a document stays self-contained and plan content still
// contributes no script of its own.
//
// Three rules run through every line here, and they are security properties,
// not style:
//
//  1. Reviewer text, quoted plan text, and agent progress text are DATA.
//     Everything user- or agent-supplied reaches the page through textContent
//     or a value property. This file never assigns innerHTML and never builds
//     markup from a string.
//  2. The session token travels in a header, never in a URL, so it stays out
//     of history, referrers, and any log that records paths.
//  3. Nothing leaves the machine. Every request is a same-origin path against
//     the runtime that served this document; a document opened from file://
//     makes no request at all and keeps drafts locally.

(() => {
  "use strict";

  const root = document.documentElement;
  const planId = root.getAttribute("data-plan-id") || "";
  const sessionId = root.getAttribute("data-review-session") || "";
  const sessionToken = root.getAttribute("data-review-token") || "";
  // A runtime is present only when it rendered and served this very document,
  // which is the only way the session attributes can be here at all.
  const hasRuntime = sessionId !== "" && sessionToken !== "";

  const blocks = Array.from(document.querySelectorAll("[data-block-id]"));
  if (blocks.length === 0) return;

  const TOKEN_HEADER = "x-big-plan-review-token";
  const QUOTE_LIMIT = 400;
  const BODY_LIMIT = 4000;
  const PROGRESS_INTERVAL_MS = 1500;

  // ---------------------------------------------------------------- elements

  // The only DOM builder in this file. Text always arrives as a child string
  // and is set with textContent, so a comment body can never become chrome.
  const el = (tag, props, children) => {
    const node = document.createElement(tag);
    for (const name of Object.keys(props || {})) {
      const value = props[name];
      if (value === undefined || value === false) continue;
      if (name === "text") node.textContent = String(value);
      else if (name === "value") node.value = String(value);
      else if (value === true) node.setAttribute(name, "");
      else node.setAttribute(name, String(value));
    }
    for (const child of children || []) {
      if (child) node.appendChild(child);
    }
    return node;
  };

  const icon = (path) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    shape.setAttribute("d", path);
    svg.appendChild(shape);
    return svg;
  };

  // Lucide message-square-text and x, the two glyphs this chrome needs.
  const ICON_COMMENT =
    "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM7 8h10M7 12h6";
  const ICON_CLOSE = "M18 6 6 18M6 6l12 12";

  // ------------------------------------------------------------------ target

  // A selection's common ancestor is usually a text node, which has no
  // closest(), so the search starts from the nearest element either way.
  const blockOf = (node) => {
    const element =
      node instanceof Element ? node : (node && node.parentElement) || null;
    return element === null ? null : element.closest("[data-block-id]");
  };

  const labelFor = (block) =>
    (block && block.getAttribute("data-block-label")) || "This block";

  const kindFor = (block) =>
    (block && block.getAttribute("data-block-kind")) || "block";

  // How a target reads in the tray, on a chip, and in the agent's brief. The
  // kind leads so a reviewer scanning the tray sees what kind of thing they
  // argued with before reading which one.
  const describeTarget = (target) => {
    if (target.type === "document") return "Whole plan";
    const kind = target.kind ? readableKind(target.kind) : "Block";
    if (target.type === "lines") {
      const range =
        target.start === target.end
          ? "line " + target.start
          : "lines " + target.start + "-" + target.end;
      return kind + " · " + range;
    }
    if (target.type === "selection") return kind + " · selected text";
    return kind + " · " + (target.label || "");
  };

  const readableKind = (kind) =>
    kind
      .split("-")
      .filter(Boolean)
      .map((word, index) =>
        index === 0 ? word[0].toUpperCase() + word.slice(1) : word,
      )
      .join(" ");

  // ------------------------------------------------------------------- state

  // Drafts are the reviewer's, unsent. Sent comments are kept for the session
  // so "I know the agent has it" survives a scroll away from the tray.
  let drafts = [];
  let sent = [];
  let editingId = null;
  let composeTarget = null;
  let cursorBlock = null;
  let pendingSelection = null;
  let progressSeq = 0;
  let progressTimer = null;
  let runtimeConfirmed = false;

  const newId = () => {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };

  // ----------------------------------------------------------------- storage

  // Without a runtime the document still holds drafts, but only when the
  // renderer stamped a plan id. There is deliberately no title-keyed fallback:
  // two plans that share a title would share a namespace, and drafts quote
  // plan text, so a collision would leak one plan's content into another's.
  const storageKey = planId === "" ? null : "big-plan:review:drafts:" + planId;

  const readLocalDrafts = () => {
    if (storageKey === null) return [];
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw === null ? [] : JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isComment) : [];
    } catch {
      return [];
    }
  };

  const writeLocalDrafts = () => {
    if (storageKey === null) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(drafts));
    } catch {
      // A full or blocked store costs persistence, never the session.
    }
  };

  const clearLocalDrafts = () => {
    if (storageKey === null) return;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Nothing to recover from; the runtime already holds the drafts.
    }
  };

  const isComment = (value) =>
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    value.target !== null &&
    typeof value.target === "object";

  // ---------------------------------------------------------------- transport

  // Every call is a same-origin path on the runtime that served this page.
  // The token rides a header; `same-origin` mode makes a redirect to another
  // origin a network error rather than a quiet exfiltration.
  const call = async (path, options) => {
    const response = await fetch(path, {
      method: (options && options.method) || "GET",
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: Object.assign(
        { [TOKEN_HEADER]: sessionToken },
        options && options.body ? { "content-type": "application/json" } : {},
      ),
      ...(options && options.body
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    if (!response.ok) {
      throw new Error(
        "Review runtime refused the request (" + response.status + ")",
      );
    }
    return response.json();
  };

  // The runtime proves it is the process that minted this document's session
  // before the document hands it anything. A process that squatted the port
  // after render fails this check and collects nothing.
  const confirmRuntime = async () => {
    if (runtimeConfirmed) return true;
    const answer = await call("/api/session");
    if (answer.sessionId !== sessionId || answer.planId !== planId) {
      throw new Error("The review runtime on this port is not this session");
    }
    runtimeConfirmed = true;
    return true;
  };

  const persist = async () => {
    if (!hasRuntime) {
      writeLocalDrafts();
      return;
    }
    await confirmRuntime();
    await call("/api/drafts", { method: "PUT", body: { drafts } });
  };

  // ------------------------------------------------------------------ layout

  const rail = el("aside", {
    "data-review-rail": true,
    "aria-label": "Plan review",
    hidden: true,
  });

  const toggle = el("button", {
    type: "button",
    "data-review-toggle": true,
    "aria-expanded": "false",
    title: "Open the Feedback tray (Alt+C)",
  });
  const toggleCount = el("span", {
    "data-review-toggle-count": true,
    text: "0",
  });
  toggle.append(
    icon(ICON_COMMENT),
    el("span", { text: "Review" }),
    toggleCount,
  );

  const countLabel = el("span", {
    "data-review-count": true,
    text: "Nothing pending",
  });
  const hideButton = el("button", {
    type: "button",
    "data-review-hide": true,
    "aria-label": "Hide the tray",
  });
  hideButton.appendChild(icon(ICON_CLOSE));

  const draftList = el("ol", { "data-review-drafts": true });
  const emptyNote = el("p", {
    "data-review-empty": true,
    text: "Hover a block and press Comment, or highlight any text, to start.",
  });
  const sentList = el("ol", { "data-review-sent-list": true });
  const sentGroup = el("section", { "data-review-sent": true, hidden: true }, [
    el("h3", { text: "Sent" }),
    sentList,
  ]);

  const sendButton = el("button", {
    type: "button",
    "data-review-send": true,
    disabled: true,
    text: "Send feedback to agent",
  });
  const sendNote = el("p", { "data-review-send-note": true });

  const agentState = el("span", {
    "data-review-agent-state": true,
    "data-tone": "idle",
    text: "Waiting for you",
  });
  const agentInput = el("textarea", {
    "data-review-agent-input": true,
    id: "big-plan-review-agent-note",
    rows: "3",
    placeholder: "Type a note about the whole plan…",
    maxlength: String(BODY_LIMIT),
  });
  const attachInput = el("input", {
    type: "checkbox",
    "data-review-attach-input": true,
    id: "big-plan-review-attach",
  });
  const attachLabel = el(
    "label",
    { "data-review-attach": true, hidden: true },
    [
      attachInput,
      el("span", {
        "data-review-attach-text": true,
        text: "Attach to my selection",
      }),
    ],
  );
  const agentSave = el("button", {
    type: "button",
    "data-review-agent-save": true,
    text: "Save draft",
  });
  const progressList = el("ol", { "data-review-progress": true, hidden: true });

  const agentPanel = el("section", { "data-review-agent": true }, [
    el("div", { "data-review-agent-head": true }, [
      el("h3", { text: "Agent" }),
      agentState,
    ]),
    el("label", {
      for: "big-plan-review-agent-note",
      "data-review-field-label": true,
      text: "Note on the whole plan",
    }),
    agentInput,
    attachLabel,
    agentSave,
    progressList,
  ]);

  rail.append(
    el("div", { "data-review-rail-head": true }, [
      el("h2", { text: "Feedback tray" }),
      countLabel,
      hideButton,
    ]),
    el("div", { "data-review-scroll": true }, [
      draftList,
      emptyNote,
      sentGroup,
    ]),
    el("div", { "data-review-send-bar": true }, [sendButton, sendNote]),
    agentPanel,
  );

  const affordance = el("button", {
    type: "button",
    "data-review-affordance": true,
    hidden: true,
  });
  affordance.append(icon(ICON_COMMENT), el("span", { text: "Comment" }));

  const composeTargetLabel = el("p", { "data-review-compose-target": true });
  const composeQuote = el("blockquote", {
    "data-review-compose-quote": true,
    hidden: true,
  });
  const composeInput = el("textarea", {
    "data-review-compose-input": true,
    id: "big-plan-review-compose",
    rows: "4",
    placeholder: "What should the agent change here?",
    maxlength: String(BODY_LIMIT),
  });
  const composeCancel = el("button", {
    type: "button",
    "data-review-compose-cancel": true,
    text: "Cancel",
  });
  const composeSave = el("button", {
    type: "button",
    "data-review-compose-save": true,
    text: "Save draft",
  });
  const compose = el(
    "div",
    {
      "data-review-compose": true,
      role: "dialog",
      "aria-label": "Comment on this block",
      hidden: true,
    },
    [
      composeTargetLabel,
      composeQuote,
      el("label", {
        for: "big-plan-review-compose",
        "data-review-field-label": true,
        text: "Your note",
      }),
      composeInput,
      el("p", {
        "data-review-compose-hint": true,
        text: "Escape cancels · Cmd/Ctrl+Enter saves",
      }),
      el("div", { "data-review-compose-actions": true }, [
        composeCancel,
        composeSave,
      ]),
    ],
  );

  const live = el("p", { "data-review-live": true, "aria-live": "polite" });

  const surface = el("div", { "data-review-root": true }, [
    toggle,
    rail,
    affordance,
    compose,
    live,
  ]);
  document.body.appendChild(surface);

  const announce = (message) => {
    live.textContent = message;
  };

  // -------------------------------------------------------------- tray render

  const setRailOpen = (open) => {
    rail.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) root.setAttribute("data-review-open", "");
    else root.removeAttribute("data-review-open");
  };

  const railIsOpen = () => !rail.hidden;

  const chipCounts = () => {
    const counts = new Map();
    for (const draft of drafts) {
      const id = draft.target.blockId;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  };

  // Chips are drawn from an attribute by the stylesheet, so no markup is
  // injected into authored content and the count is always the live truth.
  const paintChips = () => {
    const counts = chipCounts();
    const sentBlocks = new Set(
      sent.map((comment) => comment.target.blockId).filter(Boolean),
    );
    for (const block of blocks) {
      const id = block.getAttribute("data-block-id");
      const pending = counts.get(id) || 0;
      if (pending > 0) {
        block.setAttribute("data-review-annotated", String(pending));
        block.setAttribute("data-review-chip-tone", "draft");
      } else if (sentBlocks.has(id)) {
        block.setAttribute("data-review-annotated", "✓");
        block.setAttribute("data-review-chip-tone", "sent");
      } else {
        block.removeAttribute("data-review-annotated");
        block.removeAttribute("data-review-chip-tone");
      }
    }
  };

  const focusTarget = (comment) => {
    const id = comment.target.blockId;
    const block = id
      ? document.querySelector('[data-block-id="' + cssEscape(id) + '"]')
      : null;
    const destination = block || document.body;
    destination.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!block) return;
    block.setAttribute("data-review-flash", "");
    setTimeout(() => block.removeAttribute("data-review-flash"), 1400);
  };

  // Block ids come from the renderer with a restricted character set, so this
  // only has to survive the selector parser, never sanitize authored input.
  const cssEscape = (value) =>
    window.CSS && CSS.escape
      ? CSS.escape(value)
      : value.replace(/["\\]/g, "\\$&");

  const draftRow = (comment) => {
    const isEditing = comment.id === editingId;
    const jump = el("button", {
      type: "button",
      "data-review-row-target": true,
      text: describeTarget(comment.target),
      title: "Jump to this target",
    });
    jump.addEventListener("click", () => focusTarget(comment));

    if (!isEditing) {
      const edit = el("button", {
        type: "button",
        "data-review-row-edit": true,
        text: "Edit",
      });
      edit.addEventListener("click", () => {
        editingId = comment.id;
        renderTray();
      });
      const remove = el("button", {
        type: "button",
        "data-review-row-delete": true,
        text: "Delete",
      });
      remove.addEventListener("click", async () => {
        drafts = drafts.filter((item) => item.id !== comment.id);
        announce("Draft deleted. " + drafts.length + " pending.");
        renderTray();
        await save();
      });
      return el("li", { "data-review-row": true }, [
        jump,
        el("p", { "data-review-row-body": true, text: comment.body }),
        el("div", { "data-review-row-actions": true }, [edit, remove]),
      ]);
    }

    const field = el("textarea", {
      "data-review-row-input": true,
      rows: "3",
      value: comment.body,
      maxlength: String(BODY_LIMIT),
      "aria-label": "Editing the note on " + describeTarget(comment.target),
    });
    const cancel = el("button", {
      type: "button",
      "data-review-row-cancel": true,
      text: "Cancel",
    });
    cancel.addEventListener("click", () => {
      editingId = null;
      renderTray();
    });
    const confirm = el("button", {
      type: "button",
      "data-review-row-save": true,
      text: "Save",
    });
    const commit = async () => {
      const body = field.value.trim();
      if (body === "") return;
      comment.body = body;
      editingId = null;
      announce("Draft updated.");
      renderTray();
      await save();
    };
    confirm.addEventListener("click", commit);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        editingId = null;
        renderTray();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
    });
    const row = el(
      "li",
      { "data-review-row": true, "data-review-editing": true },
      [
        jump,
        field,
        el("div", { "data-review-row-actions": true }, [cancel, confirm]),
      ],
    );
    setTimeout(() => field.focus(), 0);
    return row;
  };

  const renderTray = () => {
    draftList.replaceChildren(...drafts.map(draftRow));
    emptyNote.hidden = drafts.length > 0;
    const pending = drafts.length;
    countLabel.textContent =
      pending === 0
        ? "Nothing pending"
        : pending + (pending === 1 ? " pending" : " pending");
    toggleCount.textContent = String(pending);
    toggle.setAttribute(
      "data-review-has-pending",
      pending > 0 ? "true" : "false",
    );
    sendButton.disabled = pending === 0;
    sentGroup.hidden = sent.length === 0;
    sentList.replaceChildren(
      ...sent.map((comment) =>
        el("li", { "data-review-row": true, "data-review-sent-row": true }, [
          el("span", {
            "data-review-row-target": true,
            text: describeTarget(comment.target),
          }),
          el("p", { "data-review-row-body": true, text: comment.body }),
        ]),
      ),
    );
    paintChips();
  };

  const save = async () => {
    try {
      await persist();
      sendNote.textContent = "";
    } catch (error) {
      sendNote.textContent = describeError(error);
    }
  };

  const describeError = (error) =>
    error && error.message ? String(error.message) : "Something went wrong.";

  // ---------------------------------------------------------------- composing

  const addDraft = (target, body) => {
    drafts = drafts.concat([
      {
        id: newId(),
        body: body,
        createdAt: new Date().toISOString(),
        target: target,
      },
    ]);
  };

  const openCompose = (target) => {
    composeTarget = target;
    composeTargetLabel.textContent = describeTarget(target);
    composeTargetLabel.title = describeTarget(target);
    // The affordance did its job; leaving it up would float a second control
    // over the card the reviewer is now typing in.
    affordance.hidden = true;
    if (target.quote) {
      composeQuote.hidden = false;
      composeQuote.textContent = target.quote;
    } else {
      composeQuote.hidden = true;
      composeQuote.textContent = "";
    }
    composeInput.value = "";
    compose.hidden = false;
    positionCompose(target);
    // The tray opens with the first comment: the reviewer should see where a
    // draft is about to land before they have written it.
    if (!railIsOpen()) setRailOpen(true);
    setTimeout(() => composeInput.focus(), 0);
  };

  const closeCompose = () => {
    compose.hidden = true;
    composeTarget = null;
  };

  const positionCompose = (target) => {
    const block = target.blockId
      ? document.querySelector(
          '[data-block-id="' + cssEscape(target.blockId) + '"]',
        )
      : null;
    if (!block || window.innerWidth < 896) {
      compose.removeAttribute("style");
      compose.setAttribute("data-review-compose-centered", "");
      return;
    }
    compose.removeAttribute("data-review-compose-centered");
    const rect = block.getBoundingClientRect();
    const limit = rightLimit();
    const width = Math.min(26 * 16, limit - 32);
    const left = Math.max(16, Math.min(rect.left, limit - width - 16));
    compose.style.width = width + "px";
    compose.style.left = left + "px";
    const height = compose.offsetHeight || 260;
    const below = rect.bottom + 8;
    // Below the block when there is room, above it when there is not - and
    // always clamped inside the viewport, because a card the reviewer has to
    // scroll to reach is a card they cannot type in.
    const preferred =
      below + height > window.innerHeight - 16 ? rect.top - height - 8 : below;
    compose.style.top =
      Math.max(16, Math.min(preferred, window.innerHeight - height - 16)) +
      "px";
  };

  const saveCompose = async () => {
    const body = composeInput.value.trim();
    if (body === "" || composeTarget === null) return;
    addDraft(composeTarget, body);
    announce("Draft saved on " + describeTarget(composeTarget) + ".");
    closeCompose();
    renderTray();
    await save();
  };

  composeSave.addEventListener("click", saveCompose);
  composeCancel.addEventListener("click", closeCompose);
  composeInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeCompose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
      saveCompose();
  });

  // -------------------------------------------------------------- affordance

  const targetForBlock = (block) => ({
    type: "block",
    blockId: block.getAttribute("data-block-id"),
    kind: kindFor(block),
    label: labelFor(block),
  });

  // The right edge the floating chrome may reach: the window, or the tray's
  // own left edge while the tray is open, so a control never lands under it.
  const rightLimit = () =>
    railIsOpen() ? rail.getBoundingClientRect().left : window.innerWidth;

  const showAffordance = (block) => {
    if (!block || !compose.hidden) return;
    cursorBlock = block;
    const rect = block.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    affordance.hidden = false;
    affordance.setAttribute(
      "aria-label",
      "Comment on " + kindFor(block) + ": " + labelFor(block),
    );
    affordance.style.top = Math.max(8, rect.top) + "px";
    const width = affordance.offsetWidth || 108;
    affordance.style.left =
      Math.min(rect.right + 8, rightLimit() - width - 12) + "px";
  };

  const hideAffordance = () => {
    if (document.activeElement === affordance) return;
    affordance.hidden = true;
  };

  for (const block of blocks) {
    block.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      if (pendingSelection) return;
      showAffordance(block);
    });
  }
  document.addEventListener("pointerleave", hideAffordance);

  affordance.addEventListener("click", () => {
    if (pendingSelection) {
      openCompose(pendingSelection);
      pendingSelection = null;
      return;
    }
    if (cursorBlock) openCompose(targetForBlock(cursorBlock));
  });

  // --------------------------------------------------------------- selection

  // A selection anchor records the block it sits in, its character offsets
  // inside that block, and the text it quoted. The quote travels as evidence
  // of what the reviewer highlighted - never as an instruction, and never as
  // markup: it is read with toString() and written with textContent.
  const anchorFromSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    const range = selection.getRangeAt(0);
    const quote = selection.toString().trim();
    if (quote === "") return null;
    const block = blockOf(range.commonAncestorContainer);
    if (!block || surface.contains(block)) return null;

    const lineTarget = lineRangeFor(range, block);
    if (lineTarget) return lineTarget;

    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    return {
      type: "selection",
      blockId: block.getAttribute("data-block-id"),
      kind: kindFor(block),
      label: labelFor(block),
      start: start,
      end: start + quote.length,
      quote: quote.slice(0, QUOTE_LIMIT),
    };
  };

  // Inside a code figure the reviewer is pointing at lines, so the anchor
  // becomes the same line-range shape an authored Annotation uses.
  const lineRangeFor = (range, block) => {
    const rows = Array.from(block.querySelectorAll("[data-block-line]"));
    if (rows.length === 0) return null;
    const covered = rows.filter((row) => range.intersectsNode(row));
    if (covered.length === 0) return null;
    const numbers = covered
      .map((row) => Number(row.getAttribute("data-block-line")))
      .filter((value) => Number.isInteger(value));
    if (numbers.length === 0) return null;
    return {
      type: "lines",
      blockId: block.getAttribute("data-block-id"),
      kind: kindFor(block),
      label: labelFor(block),
      start: Math.min(...numbers),
      end: Math.max(...numbers),
      quote: covered
        .map((row) => row.textContent)
        .join("\n")
        .slice(0, QUOTE_LIMIT),
    };
  };

  const offerSelection = () => {
    const anchor = anchorFromSelection();
    if (!anchor) {
      if (pendingSelection) {
        pendingSelection = null;
        affordance.hidden = true;
      }
      attachLabel.hidden = true;
      return;
    }
    pendingSelection = anchor;
    attachLabel.hidden = false;
    attachInput.checked = false;
    if (!compose.hidden) return;
    const selection = window.getSelection();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    affordance.hidden = false;
    affordance.setAttribute("aria-label", "Comment on the selected text");
    affordance.style.top = Math.max(8, rect.top - 40) + "px";
    const width = affordance.offsetWidth || 108;
    affordance.style.left =
      Math.max(12, Math.min(rect.left, rightLimit() - width - 12)) + "px";
  };

  document.addEventListener("mouseup", () => setTimeout(offerSelection, 0));
  document.addEventListener("keyup", (event) => {
    if (event.shiftKey || event.key === "Shift") setTimeout(offerSelection, 0);
  });

  // ---------------------------------------------------------- whole-plan note

  const saveAgentNote = async () => {
    const body = agentInput.value.trim();
    if (body === "") return;
    const target =
      attachInput.checked && pendingSelection
        ? pendingSelection
        : { type: "document" };
    addDraft(target, body);
    agentInput.value = "";
    attachInput.checked = false;
    announce("Draft saved on " + describeTarget(target) + ".");
    renderTray();
    await save();
  };

  agentSave.addEventListener("click", saveAgentNote);
  agentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
      saveAgentNote();
  });

  // ------------------------------------------------------------------- submit

  // The tray's entry point carries the agent's state whenever nothing is
  // pending, so a reviewer who has already sent never has to open the tray to
  // learn whether anything is happening.
  const setAgentState = (text, tone) => {
    agentState.textContent = text;
    agentState.setAttribute("data-tone", tone);
    toggle.setAttribute("data-review-agent-tone", tone);
    toggle.title =
      tone === "idle" ? "Open the Feedback tray (Alt+C)" : "Agent: " + text;
    if (drafts.length === 0)
      toggleCount.textContent = tone === "idle" ? "0" : "·";
  };

  // One intentional send of everything pending, with no confirmation dialog:
  // the tray already shows the count and every body about to leave.
  const submit = async () => {
    if (drafts.length === 0) return;
    if (!hasRuntime) {
      sendNote.textContent =
        "Start the local review runtime with `big-plan review " +
        "<plan.mdx>` to send. Your drafts are saved here meanwhile.";
      return;
    }
    sendButton.disabled = true;
    sendButton.setAttribute("data-review-busy", "");
    sendNote.textContent = "";
    try {
      await confirmRuntime();
      const answer = await call("/api/feedback", {
        method: "POST",
        body: { comments: drafts },
      });
      sent = sent.concat(drafts);
      drafts = [];
      renderTray();
      await persist();
      setAgentState("Package received", "working");
      sendNote.textContent =
        "Sent " +
        answer.comments +
        " to the agent as " +
        answer.packageId +
        ".";
      announce("Feedback sent to the agent.");
      startProgress();
    } catch (error) {
      sendNote.textContent = describeError(error);
      sendButton.disabled = false;
    } finally {
      sendButton.removeAttribute("data-review-busy");
    }
  };

  sendButton.addEventListener("click", submit);

  // ----------------------------------------------------------------- progress

  const PROGRESS_TONE = {
    done: "done",
    live: "live",
    waiting: "waiting",
    failed: "failed",
  };

  // Progress is one-way and status-only. An event can set text and a state
  // token and nothing else: this never navigates, fetches, opens, or executes
  // on anything an event carried.
  // A step that was live and has since been followed by another step is not
  // live any more. Sequence numbers are monotonic by contract, so this reads
  // the ordering the channel already guarantees rather than inventing a state.
  const displayState = ({ event, index, total }) =>
    event.state === "live" && index < total - 1 ? "done" : event.state;

  const renderProgress = (events) => {
    if (events.length === 0) return;
    progressList.hidden = false;
    progressList.replaceChildren(
      ...events.map((event, index) => {
        const state = displayState({ event, index, total: events.length });
        return el("li", { "data-review-progress-step": true }, [
          el("span", {
            "data-review-progress-state": PROGRESS_TONE[state] || "waiting",
            text: state,
          }),
          el("span", { "data-review-progress-label": true, text: event.step }),
          event.detail
            ? el("span", {
                "data-review-progress-detail": true,
                text: event.detail,
              })
            : null,
        ]);
      }),
    );
    const last = events[events.length - 1];
    if (last.state === "done" && /re-?review/i.test(last.step)) {
      setAgentState("Ready to re-review", "ready");
    } else if (last.state === "failed") {
      setAgentState("Needs your attention", "failed");
    } else {
      setAgentState("Working", "working");
    }
  };

  const startProgress = () => {
    if (progressTimer !== null || !hasRuntime) return;
    const tick = async () => {
      try {
        const answer = await call("/api/progress");
        // The runtime already drops foreign and out-of-order events; the
        // document checks the same two facts again rather than trusting that
        // an event reached it only because it was allowed to.
        const timeline = (answer.events || []).filter(
          (event) =>
            event &&
            event.sessionId === sessionId &&
            Number.isInteger(event.seq) &&
            typeof event.step === "string" &&
            typeof event.state === "string",
        );
        const latest =
          timeline.length === 0 ? 0 : timeline[timeline.length - 1].seq;
        if (latest > progressSeq) {
          progressSeq = latest;
          renderProgress(timeline);
        }
      } catch {
        // A refused or unreachable runtime stops the loop rather than
        // retrying forever against a port that may no longer be ours.
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
    };
    progressTimer = window.setInterval(tick, PROGRESS_INTERVAL_MS);
    tick();
  };

  // ---------------------------------------------------------------- keyboard

  const moveCursor = (step) => {
    const index = cursorBlock ? blocks.indexOf(cursorBlock) : -1;
    const next = blocks[Math.min(Math.max(index + step, 0), blocks.length - 1)];
    if (!next) return;
    next.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => showAffordance(next), 220);
    announce(kindFor(next) + ": " + labelFor(next));
  };

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
    }
    if (event.altKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      if (pendingSelection) openCompose(pendingSelection);
      else if (cursorBlock) openCompose(targetForBlock(cursorBlock));
      else setRailOpen(!railIsOpen());
    }
    if (event.key === "Escape" && !compose.hidden) closeCompose();
  });

  toggle.addEventListener("click", () => setRailOpen(!railIsOpen()));
  hideButton.addEventListener("click", () => setRailOpen(false));
  window.addEventListener("resize", () => {
    if (!compose.hidden && composeTarget) positionCompose(composeTarget);
    affordance.hidden = true;
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      if (!affordance.hidden && cursorBlock && !pendingSelection) {
        showAffordance(cursorBlock);
      }
    },
    { passive: true },
  );

  // --------------------------------------------------------------------- boot

  const boot = async () => {
    if (!hasRuntime) {
      drafts = readLocalDrafts();
      sendNote.textContent =
        "Reading offline: drafts stay in this browser until you run " +
        "`big-plan review`.";
      renderTray();
      if (drafts.length > 0) setRailOpen(true);
      return;
    }
    try {
      await confirmRuntime();
      // On-disk custody becomes the single home: anything the browser held is
      // handed over once and then cleared, so drafts do not linger in an
      // origin every local file shares.
      const carried = readLocalDrafts();
      const answer = await call("/api/drafts");
      const known = new Set((answer.drafts || []).map((draft) => draft.id));
      drafts = (answer.drafts || []).concat(
        carried.filter((draft) => !known.has(draft.id)),
      );
      sent = answer.sent || [];
      if (carried.length > 0) {
        await call("/api/drafts", { method: "PUT", body: { drafts } });
        clearLocalDrafts();
      }
      renderTray();
      if (drafts.length > 0) setRailOpen(true);
      if (sent.length > 0) startProgress();
    } catch (error) {
      sendNote.textContent = describeError(error);
      drafts = readLocalDrafts();
      renderTray();
    }
  };

  renderTray();
  boot();
})();
