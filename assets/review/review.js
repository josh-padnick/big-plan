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

  // How a target reads in the tray. The authored label stays in the middle,
  // where adjacent same-kind targets differ, while section and kind keep the
  // relationship to the plan explicit.
  const describeTarget = (target) => {
    if (target.type === "document") return "Whole plan";
    const kind = target.kind ? readableKind(target.kind) : "Block";
    const location = [target.section, target.label]
      .filter((part) => typeof part === "string" && part !== "")
      .join(" / ");
    if (target.type === "lines") {
      const range =
        target.start === target.end
          ? "line " + target.start
          : "lines " + target.start + "-" + target.end;
      return location + " · " + kind + " · " + range;
    }
    if (target.type === "selection")
      return location + " · " + kind + " · selected text";
    return location + " · " + kind;
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
  let activeDraft = "";
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

  const emptyStoredState = () => ({ drafts: [], sent: [], activeDraft: "" });

  const isStoredState = (value) =>
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value.drafts) &&
    Array.isArray(value.sent) &&
    typeof value.activeDraft === "string";

  const checkedStoredState = (value) => {
    if (!isStoredState(value)) return emptyStoredState();
    return {
      drafts: value.drafts.filter(isComment),
      sent: value.sent.filter(isComment),
      activeDraft: value.activeDraft.slice(0, BODY_LIMIT),
    };
  };

  const readLocalState = () => {
    if (storageKey === null) return emptyStoredState();
    try {
      const raw = localStorage.getItem(storageKey);
      return checkedStoredState(raw === null ? null : JSON.parse(raw));
    } catch {
      return emptyStoredState();
    }
  };

  const writeLocalState = () => {
    if (storageKey === null) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ drafts, sent, activeDraft }),
      );
    } catch {
      // A full or blocked store costs persistence, never the session.
    }
  };

  const isComment = (value) =>
    value !== null &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    value.target !== null &&
    typeof value.target === "object";

  const readBootstrapState = () => {
    const raw = root.getAttribute("data-review-bootstrap");
    if (raw === null) return emptyStoredState();
    try {
      return checkedStoredState(JSON.parse(raw));
    } catch {
      return emptyStoredState();
    }
  };

  // The runtime injects validated state into the document itself, so this
  // assignment runs before any review chrome is constructed. Browser storage
  // is a synchronous recovery mirror for a reload that races the last disk
  // write; the server remains the durable owner across runtime restarts.
  const diskState = hasRuntime ? readBootstrapState() : emptyStoredState();
  const browserState = readLocalState();
  const initialIds = new Set(diskState.drafts.map((draft) => draft.id));
  drafts = diskState.drafts.concat(
    browserState.drafts.filter((draft) => !initialIds.has(draft.id)),
  );
  sent = diskState.sent;
  activeDraft =
    browserState.activeDraft !== ""
      ? browserState.activeDraft
      : diskState.activeDraft;

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
    writeLocalState();
    if (!hasRuntime) {
      return;
    }
    await confirmRuntime();
    await call("/api/drafts", {
      method: "PUT",
      body: { drafts, activeDraft },
    });
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
    "aria-label": "Show comments",
    title: "Show comments (Alt+C)",
  });
  const toggleCount = el("span", {
    "data-review-toggle-count": true,
    text: "0",
  });
  toggle.append(
    icon(ICON_COMMENT),
    el("span", { text: "Comments" }),
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
    value: activeDraft,
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
    text: "Add to feedback",
  });
  const progressList = el("ol", { "data-review-progress": true, hidden: true });

  const outcomePreview = el(
    "section",
    {
      "data-review-outcome-preview": true,
      "aria-label": "Simulated agent response states",
    },
    [
      el("div", { "data-review-preview-head": true }, [
        el("h3", { text: "Response preview" }),
        el("span", { "data-review-preview-chip": true, text: "Simulated" }),
      ]),
      el("p", {
        "data-review-preview-note": true,
        text:
          "Package delivery is real. Agent replies are not connected yet; " +
          "these are the outcome states the tray will use.",
      }),
      el("ol", { "data-review-outcome-list": true }, [
        el("li", { "data-review-outcome": "changed" }, [
          el("span", {
            "data-review-outcome-state": true,
            text: "Changed",
          }),
          el("span", { text: "The plan was revised." }),
        ]),
        el("li", { "data-review-outcome": "question" }, [
          el("span", {
            "data-review-outcome-state": true,
            text: "Needs your answer",
          }),
          el("span", { text: "The agent needs a decision." }),
        ]),
        el("li", { "data-review-outcome": "declined" }, [
          el("span", {
            "data-review-outcome-state": true,
            text: "Outside this plan",
          }),
          el("span", { text: "The request is beyond plan revision." }),
        ]),
      ]),
    ],
  );

  const agentPanel = el("section", { "data-review-agent": true }, [
    el("div", { "data-review-agent-head": true }, [
      el("h3", { text: "Runtime status" }),
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
    outcomePreview,
  ]);

  const commentsTab = el("button", {
    type: "button",
    role: "tab",
    "data-review-tab": "comments",
    "aria-selected": "true",
    "aria-controls": "big-plan-review-comments",
  });
  commentsTab.append(
    icon(ICON_COMMENT),
    el("span", { text: "Comments" }),
    countLabel,
  );
  const chatTab = el("button", {
    type: "button",
    role: "tab",
    "data-review-tab": "chat",
    "aria-selected": "false",
    "aria-controls": "big-plan-review-chat",
  });
  chatTab.append(
    el("span", { text: "Chat" }),
    el("span", { "data-review-tab-preview": true, text: "Preview" }),
  );
  const tabList = el("div", { "data-review-tabs": true, role: "tablist" }, [
    commentsTab,
    chatTab,
    hideButton,
  ]);
  const commentsPanel = el(
    "section",
    {
      id: "big-plan-review-comments",
      "data-review-panel": "comments",
      role: "tabpanel",
    },
    [
      el("div", { "data-review-scroll": true }, [
        draftList,
        emptyNote,
        sentGroup,
      ]),
      el("div", { "data-review-send-bar": true }, [sendButton, sendNote]),
    ],
  );
  const chatPanel = el(
    "section",
    {
      id: "big-plan-review-chat",
      "data-review-panel": "chat",
      role: "tabpanel",
      hidden: true,
    },
    [agentPanel],
  );
  rail.append(tabList, commentsPanel, chatPanel);

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
    disabled: true,
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

  const markerLayer = el("div", {
    "data-review-marker-layer": true,
    "aria-label": "Existing comments",
  });
  const live = el("p", { "data-review-live": true, "aria-live": "polite" });
  const backdrop = el("button", {
    type: "button",
    "data-review-backdrop": true,
    "aria-label": "Close comments and return to the plan",
    hidden: true,
  });

  const surface = el("div", { "data-review-root": true }, [
    backdrop,
    toggle,
    rail,
    affordance,
    compose,
    markerLayer,
    live,
  ]);
  document.body.appendChild(surface);

  const announce = (message) => {
    live.textContent = message;
  };

  // -------------------------------------------------------------- tray render

  let readingPosition = window.scrollY;

  const setRailOpen = (open) => {
    if (open === !rail.hidden) {
      return;
    }
    if (open && rail.hidden) {
      readingPosition = window.scrollY;
    }
    rail.hidden = !open;
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Hide comments" : "Show comments");
    if (open) {
      root.setAttribute("data-review-open", "");
    } else {
      root.removeAttribute("data-review-open");
    }
    // The drawer never navigates the document. Re-applying the captured
    // position defeats scroll anchoring caused by the desktop width change
    // and makes the below-1280 overlay reversible by construction.
    requestAnimationFrame(() => window.scrollTo(0, readingPosition));
  };

  const railIsOpen = () => !rail.hidden;

  const setActiveTab = (tab) => {
    const commentsActive = tab === "comments";
    commentsTab.setAttribute(
      "aria-selected",
      commentsActive ? "true" : "false",
    );
    chatTab.setAttribute("aria-selected", commentsActive ? "false" : "true");
    commentsPanel.hidden = !commentsActive;
    chatPanel.hidden = commentsActive;
  };

  commentsTab.addEventListener("click", () => setActiveTab("comments"));
  chatTab.addEventListener("click", () => setActiveTab("chat"));
  backdrop.addEventListener("click", () => setRailOpen(false));

  const chipCounts = () => {
    const counts = new Map();
    for (const draft of drafts) {
      const id = draft.target.blockId;
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  };

  const markerByBlock = new Map();

  const positionMarkers = () => {
    for (const [block, marker] of markerByBlock) {
      const rect = block.getBoundingClientRect();
      const visible =
        marker.hasAttribute("data-review-marker-active") &&
        rect.bottom >= 0 &&
        rect.top <= window.innerHeight;
      marker.hidden = !visible;
      if (!visible) continue;
      marker.style.top = Math.max(8, rect.top) + "px";
      marker.style.left = Math.max(4, rect.left - 30) + "px";
    }
  };

  const markerFor = (block) => {
    const existing = markerByBlock.get(block);
    if (existing) return existing;
    const marker = el("button", {
      type: "button",
      "data-review-marker": true,
    });
    marker.appendChild(icon(ICON_COMMENT));
    marker.addEventListener("click", () => {
      const blockId = block.getAttribute("data-block-id");
      const draft = drafts.find((item) => item.target.blockId === blockId);
      const comment =
        draft || sent.find((item) => item.target.blockId === blockId);
      if (!comment) return;
      editingId = draft ? draft.id : null;
      setActiveTab("comments");
      setRailOpen(true);
      renderTray();
      focusTarget(comment);
    });
    markerLayer.appendChild(marker);
    markerByBlock.set(block, marker);
    return marker;
  };

  // Attributes keep the rendered block's state machine-readable; the visible
  // marker is a real button, so an existing comment is directly editable
  // rather than a decorative pseudo-element.
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
      const marker = markerFor(block);
      const hasComment = pending > 0 || sentBlocks.has(id);
      marker.hidden = !hasComment;
      if (hasComment) marker.setAttribute("data-review-marker-active", "");
      else marker.removeAttribute("data-review-marker-active");
      marker.setAttribute(
        "data-review-marker-tone",
        pending > 0 ? "draft" : "sent",
      );
      marker.setAttribute(
        "aria-label",
        pending > 0
          ? `Edit ${pending} comment${pending === 1 ? "" : "s"} on ${labelFor(block)}`
          : `Open the sent comment on ${labelFor(block)}`,
      );
      marker.setAttribute("data-review-marker-count", String(pending));
    }
    positionMarkers();
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
      pending === 0 ? "0" : pending + (pending === 1 ? " pending" : " pending");
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
    composeSave.disabled = true;
    compose.hidden = false;
    positionCompose(target);
    // The tray opens with the first comment: the reviewer should see where a
    // draft is about to land before they have written it.
    if (!railIsOpen() && window.innerWidth >= 1280) setRailOpen(true);
    setTimeout(() => composeInput.focus(), 0);
  };

  const closeCompose = () => {
    compose.hidden = true;
    composeTarget = null;
    compose.removeAttribute("data-review-compose-inline");
    if (compose.parentElement !== surface) surface.appendChild(compose);
  };

  const positionCompose = (target) => {
    const block = target.blockId
      ? document.querySelector(
          '[data-block-id="' + cssEscape(target.blockId) + '"]',
        )
      : null;
    // A wireframe target lives inside a scaled product canvas. Inserting the
    // page compose card beside that element would mutate the drawing's layout,
    // so the shared editor uses its established centered presentation while
    // keeping the same block id, draft store, tray, and feedback package.
    if (!block || block.closest("[data-wireframe]")) {
      compose.removeAttribute("style");
      compose.removeAttribute("data-review-compose-inline");
      compose.setAttribute("data-review-compose-centered", "");
      return;
    }
    // A table row cannot legally own a div sibling inside tbody, so its
    // scroll container is the insertion anchor. Every other authored block
    // can place the editor immediately after itself. Either way the editor is
    // in flow and pushes following content instead of painting over it.
    const anchor =
      block.tagName === "TR"
        ? block.closest("[data-table-scroll-container]") || block
        : block;
    compose.removeAttribute("style");
    compose.removeAttribute("data-review-compose-centered");
    compose.setAttribute("data-review-compose-inline", "");
    anchor.after(compose);
  };

  const normalizedComposeBody = () => composeInput.value.trim();

  const syncComposeValidity = () => {
    composeSave.disabled =
      composeTarget === null || normalizedComposeBody() === "";
  };

  const saveCompose = async () => {
    const body = normalizedComposeBody();
    // The handler is the authority. Both pointer and Ctrl/Cmd+Enter arrive
    // here, so the shortcut cannot bypass the button's disabled state.
    if (body === "" || composeTarget === null) return;
    addDraft(composeTarget, body);
    announce("Draft saved on " + describeTarget(composeTarget) + ".");
    closeCompose();
    renderTray();
    await save();
  };

  composeSave.addEventListener("click", saveCompose);
  composeCancel.addEventListener("click", closeCompose);
  composeInput.addEventListener("input", syncComposeValidity);
  composeInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeCompose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveCompose();
    }
  });

  // -------------------------------------------------------------- affordance

  const targetForBlock = (block) => ({
    type: "block",
    blockId: block.getAttribute("data-block-id"),
    kind: kindFor(block),
    label: labelFor(block),
    section: block.getAttribute("data-block-section") || "",
  });

  // The right edge the floating chrome may reach: the window, or the tray's
  // own left edge while the tray is open, so a control never lands under it.
  const rightLimit = () =>
    railIsOpen() ? rail.getBoundingClientRect().left : window.innerWidth;

  const showAffordance = (block) => {
    if (!block || !compose.hidden) return;
    if (railIsOpen() && window.innerWidth < 1280) {
      affordance.hidden = true;
      return;
    }
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
      section: block.getAttribute("data-block-section") || "",
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
      section: block.getAttribute("data-block-section") || "",
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
    activeDraft = "";
    attachInput.checked = false;
    announce("Draft saved on " + describeTarget(target) + ".");
    renderTray();
    await save();
  };

  agentSave.addEventListener("click", saveAgentNote);
  let activeDraftTimer = null;
  agentInput.addEventListener("input", () => {
    activeDraft = agentInput.value;
    writeLocalState();
    if (activeDraftTimer !== null) window.clearTimeout(activeDraftTimer);
    activeDraftTimer = window.setTimeout(() => {
      activeDraftTimer = null;
      void save();
    }, 120);
  });
  agentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveAgentNote();
    }
  });

  // ------------------------------------------------------------------- submit

  // The tray's entry point carries the agent's state whenever nothing is
  // pending, so a reviewer who has already sent never has to open the tray to
  // learn whether anything is happening.
  const setAgentState = (text, tone) => {
    agentState.textContent = text;
    agentState.setAttribute("data-tone", tone);
    toggle.setAttribute("data-review-agent-tone", tone);
    toggle.title = tone === "idle" ? "Show comments (Alt+C)" : "Agent: " + text;
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
      activeDraft = agentInput.value;
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
      setActiveTab("chat");
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
    positionMarkers();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      if (!affordance.hidden && cursorBlock && !pendingSelection) {
        showAffordance(cursorBlock);
      }
      positionMarkers();
    },
    { passive: true },
  );

  // --------------------------------------------------------------------- boot

  const boot = async () => {
    if (!hasRuntime) {
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
      const answer = await call("/api/drafts");
      const known = new Set((answer.drafts || []).map((draft) => draft.id));
      const carried = readLocalState();
      drafts = (answer.drafts || []).concat(
        carried.drafts.filter((draft) => !known.has(draft.id)),
      );
      sent = answer.sent || [];
      activeDraft =
        carried.activeDraft !== ""
          ? carried.activeDraft
          : answer.activeDraft || activeDraft;
      agentInput.value = activeDraft;
      await call("/api/drafts", {
        method: "PUT",
        body: { drafts, activeDraft },
      });
      writeLocalState();
      renderTray();
      if (drafts.length > 0) setRailOpen(true);
      if (sent.length > 0) startProgress();
    } catch (error) {
      sendNote.textContent = describeError(error);
      const carried = readLocalState();
      drafts = carried.drafts;
      sent = carried.sent;
      activeDraft = carried.activeDraft;
      agentInput.value = activeDraft;
      renderTray();
    }
  };

  renderTray();
  boot();
})();
