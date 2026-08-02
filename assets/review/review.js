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
  const LONG_COMMENT_LIMIT = 180;
  const PROGRESS_INTERVAL_MS = 1500;
  const MESSAGE_LIMIT = 200;

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

  // Comment chrome names the slide, not the renderer's full structural path.
  // The source highlight carries the exact paragraph, row, line, or passage.
  const slideTitleFor = (target) => {
    if (target.type === "document") return "Overview";
    return target.section || target.label || "Plan";
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
  let threadReplies = {};
  let planChatMessages = [];
  let progressSeq = 0;
  let progressTimer = null;
  let runtimeConfirmed = false;
  let deleteCandidateId = null;
  const expandedCommentIds = new Set();
  const expandedThreadIds = new Set();

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

  const emptyStoredState = () => ({
    drafts: [],
    sent: [],
    activeDraft: "",
    threadReplies: {},
    planChatMessages: [],
  });

  const isStoredState = (value) =>
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value.drafts) &&
    Array.isArray(value.sent) &&
    typeof value.activeDraft === "string";

  const isStoredMessage = (value) =>
    value !== null &&
    typeof value === "object" &&
    (value.role === "user" || value.role === "agent") &&
    typeof value.body === "string" &&
    value.body.trim() !== "" &&
    value.body.length <= BODY_LIMIT &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt));

  const checkedMessages = (value) =>
    (Array.isArray(value) ? value : [])
      .filter(isStoredMessage)
      .slice(0, MESSAGE_LIMIT)
      .map((message) => ({
        role: message.role,
        body: message.body,
        createdAt: new Date(message.createdAt).toISOString(),
      }));

  const checkedThreadReplies = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const checked = {};
    for (const [id, messages] of Object.entries(value)) {
      if (!/^[a-f0-9]{4,64}$/.test(id)) continue;
      checked[id] = checkedMessages(messages);
    }
    return checked;
  };

  const checkedStoredState = (value) => {
    if (!isStoredState(value)) return emptyStoredState();
    return {
      drafts: value.drafts.filter(isComment),
      sent: value.sent.filter(isComment),
      activeDraft: value.activeDraft.slice(0, BODY_LIMIT),
      threadReplies: checkedThreadReplies(value.threadReplies),
      planChatMessages: checkedMessages(value.planChatMessages),
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
        JSON.stringify({
          drafts,
          sent,
          activeDraft,
          threadReplies,
          planChatMessages,
        }),
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
  threadReplies = browserState.threadReplies;
  planChatMessages = browserState.planChatMessages;

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
    "aria-label": "Open comments sidebar",
    title: "Open comments sidebar (Alt+C)",
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
  const responseSummary = el("p", { "data-review-round-summary": true });
  const sentList = el("div", { "data-review-sent-list": true });
  const sentGroup = el("section", { "data-review-sent": true, hidden: true }, [
    responseSummary,
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
    placeholder: "Ask about the plan as a whole…",
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
    text: "Send",
  });
  const progressList = el("ol", { "data-review-progress": true, hidden: true });
  const planChatList = el("ol", {
    "data-review-plan-chat": true,
    "aria-label": "Plan-wide conversation",
  });

  const agentPanel = el("section", { "data-review-agent": true }, [
    el("div", { "data-review-agent-head": true }, [
      el("h3", { text: "Plan-wide chat" }),
      agentState,
    ]),
    el("p", {
      "data-review-chat-note": true,
      text: "Simulated agent turns · feedback package delivery remains real.",
    }),
    planChatList,
    el("label", {
      for: "big-plan-review-agent-note",
      "data-review-field-label": true,
      text: "Message",
    }),
    agentInput,
    attachLabel,
    agentSave,
    progressList,
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
    el("span", { "data-review-tab-preview": true, text: "Simulated" }),
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
      "aria-label": "Add a comment",
      hidden: true,
    },
    [
      el("label", {
        for: "big-plan-review-compose",
        "data-review-field-label": true,
        text: "Add a comment",
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

  const threadLayer = el("div", {
    "data-review-thread-layer": true,
    "aria-label": "Comments beside the plan",
  });
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
  const deleteTitle = el("h2", {
    id: "big-plan-review-delete-title",
    text: "Delete comment?",
  });
  const deleteDescription = el("p", {
    id: "big-plan-review-delete-description",
    text: "This permanently removes your staged comment.",
  });
  const deleteCancel = el("button", {
    type: "button",
    "data-review-delete-cancel": true,
    text: "Cancel",
  });
  const deleteConfirm = el("button", {
    type: "button",
    "data-review-delete-confirm": true,
    text: "Delete",
  });
  const deleteDialog = el(
    "dialog",
    {
      "data-review-delete-dialog": true,
      "aria-labelledby": "big-plan-review-delete-title",
      "aria-describedby": "big-plan-review-delete-description",
    },
    [
      el("div", { "data-review-delete-content": true }, [
        deleteTitle,
        deleteDescription,
        el("div", { "data-review-delete-actions": true }, [
          deleteCancel,
          deleteConfirm,
        ]),
      ]),
    ],
  );

  const surface = el("div", { "data-review-root": true }, [
    backdrop,
    toggle,
    rail,
    affordance,
    threadLayer,
    compose,
    markerLayer,
    deleteDialog,
    live,
  ]);
  document.body.appendChild(surface);
  // Tailwind's delivery optimizer does not yet parse the standardized
  // ::highlight() pseudo-element, so these two rules live with the browser
  // behavior that creates their named Highlight ranges.
  document.head.appendChild(
    el("style", {
      text:
        "::highlight(big-plan-review-comments){" +
        "background-color:var(--annotation-bg);" +
        "text-decoration:underline;" +
        "text-decoration-color:var(--annotation-c);" +
        "text-decoration-thickness:1px}" +
        "::highlight(big-plan-review-active){" +
        "background-color:var(--annotation-bg);" +
        "text-decoration:underline;" +
        "text-decoration-color:var(--accent-c);" +
        "text-decoration-thickness:2px}",
    }),
  );

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
    toggle.setAttribute(
      "aria-label",
      open ? "Close comments sidebar" : "Open comments sidebar",
    );
    if (open) {
      root.setAttribute("data-review-open", "");
    } else {
      root.removeAttribute("data-review-open");
    }
    syncFloatingMode();
    if (!compose.hidden && composeTarget) positionCompose(composeTarget);
    positionThreadCards();
    // The drawer never navigates the document. Re-applying the captured
    // position defeats scroll anchoring caused by the desktop width change
    // and makes the below-1280 overlay reversible by construction.
    requestAnimationFrame(() => {
      window.scrollTo(0, readingPosition);
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      positionThreadCards();
    });
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
        window.innerWidth < 1280 &&
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
      setActiveTab("comments");
      if (draft) {
        editingId = draft.id;
        setRailOpen(true);
        renderTray();
        focusTarget(comment);
      } else {
        if (window.innerWidth < 1280) setRailOpen(true);
        openThreadAt(comment);
      }
    });
    markerLayer.appendChild(marker);
    markerByBlock.set(block, marker);
    return marker;
  };

  // Attributes keep the rendered block's state machine-readable. On narrow
  // screens the marker remains a real button; the desktop floating card itself
  // is the direct entry point, avoiding duplicate chrome around the plan.
  const paintChips = () => {
    const counts = chipCounts();
    const sentBlocks = new Map();
    for (const comment of sent) {
      if (!comment.target.blockId) continue;
      sentBlocks.set(comment.target.blockId, outcomeFor(comment));
    }
    for (const block of blocks) {
      const id = block.getAttribute("data-block-id");
      const pending = counts.get(id) || 0;
      const outcome = sentBlocks.get(id);
      if (pending > 0) {
        block.setAttribute("data-review-annotated", String(pending));
        block.setAttribute("data-review-chip-tone", "draft");
      } else if (outcome) {
        block.setAttribute(
          "data-review-annotated",
          outcome.key === "question" ? "!" : "✓",
        );
        block.setAttribute("data-review-chip-tone", outcome.key);
      } else {
        block.removeAttribute("data-review-annotated");
        block.removeAttribute("data-review-chip-tone");
      }
      const marker = markerFor(block);
      const hasComment = pending > 0 || Boolean(outcome);
      marker.hidden = !hasComment;
      if (hasComment) marker.setAttribute("data-review-marker-active", "");
      else marker.removeAttribute("data-review-marker-active");
      marker.setAttribute(
        "data-review-marker-tone",
        pending > 0 ? "draft" : outcome?.key || "sent",
      );
      marker.setAttribute(
        "aria-label",
        pending > 0
          ? `Edit ${pending} comment${pending === 1 ? "" : "s"} on ${labelFor(block)}`
          : `Open the ${outcome?.label || "sent"} thread on ${labelFor(block)}`,
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
    const scroll = () => {
      destination.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!block) return;
      block.setAttribute("data-review-flash", "");
      setTimeout(() => block.removeAttribute("data-review-flash"), 1400);
    };
    if (window.innerWidth < 1280 && railIsOpen()) {
      setRailOpen(false);
      requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  };

  // Block ids come from the renderer with a restricted character set, so this
  // only has to survive the selector parser, never sanitize authored input.
  const cssEscape = (value) =>
    window.CSS && CSS.escape
      ? CSS.escape(value)
      : value.replace(/["\\]/g, "\\$&");

  const blockForTarget = (target) => {
    const id = target && target.blockId;
    return id
      ? document.querySelector('[data-block-id="' + cssEscape(id) + '"]')
      : null;
  };

  // Turns a renderer-relative character offset back into a DOM boundary. The
  // review chrome never enters a block, so these offsets remain stable while
  // comments and the sidebar are mounted around the document.
  const textBoundary = (block, offset) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let node = walker.nextNode();
    let last = null;
    while (node) {
      last = node;
      if (remaining <= node.data.length) {
        return { node, offset: remaining };
      }
      remaining -= node.data.length;
      node = walker.nextNode();
    }
    return last === null ? null : { node: last, offset: last.data.length };
  };

  const rangeForTarget = (target) => {
    const block = blockForTarget(target);
    if (!block) return null;
    if (target.type === "selection") {
      const start = textBoundary(block, target.start);
      const end = textBoundary(block, target.end);
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    }
    if (target.type === "lines") {
      const rows = Array.from(
        block.querySelectorAll("[data-block-line]"),
      ).filter((row) => {
        const line = Number(row.getAttribute("data-block-line"));
        return line >= target.start && line <= target.end;
      });
      if (rows.length === 0) return null;
      const range = document.createRange();
      range.setStartBefore(rows[0]);
      range.setEndAfter(rows[rows.length - 1]);
      return range;
    }
    return null;
  };

  const setNamedHighlight = (name, ranges) => {
    if (
      typeof CSS === "undefined" ||
      !CSS.highlights ||
      typeof Highlight === "undefined"
    ) {
      return false;
    }
    CSS.highlights.set(name, new Highlight(...ranges));
    return true;
  };

  // Selection comments use the browser's Highlight API so the authored DOM is
  // never wrapped or rewritten. Whole-block comments use attributes because
  // an element box, rather than a text run, is the thing the reviewer chose.
  const paintTargetHighlights = () => {
    for (const block of blocks) {
      block.removeAttribute("data-review-comment-highlight");
      block.removeAttribute("data-review-active-highlight");
    }
    const commentRanges = [];
    for (const comment of drafts.concat(sent)) {
      const range = rangeForTarget(comment.target);
      if (range) {
        commentRanges.push(range);
      } else {
        blockForTarget(comment.target)?.setAttribute(
          "data-review-comment-highlight",
          "",
        );
      }
    }
    const activeTarget = composeTarget || pendingSelection;
    const activeRange = activeTarget ? rangeForTarget(activeTarget) : null;
    if (activeTarget && !activeRange) {
      blockForTarget(activeTarget)?.setAttribute(
        "data-review-active-highlight",
        "",
      );
    }
    root.setAttribute(
      "data-review-selection-highlight-count",
      String(commentRanges.length),
    );
    root.setAttribute(
      "data-review-active-selection-highlight",
      activeRange === null ? "false" : "true",
    );
    setNamedHighlight("big-plan-review-comments", commentRanges);
    setNamedHighlight(
      "big-plan-review-active",
      activeRange === null ? [] : [activeRange],
    );
  };

  const relativeCommentTime = (createdAt) => {
    const time = Date.parse(createdAt);
    if (Number.isNaN(time)) return "Just now";
    const elapsed = Date.now() - time;
    if (elapsed < 60_000) return "Just now";
    if (elapsed < 3_600_000)
      return Math.max(1, Math.floor(elapsed / 60_000)) + "m";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(time));
  };

  const THREAD_OUTCOMES = [
    {
      key: "changed",
      label: "Changed",
      reply:
        "I revised this part of the plan to address your comment. The highlighted source is the change to review.",
    },
    {
      key: "question",
      label: "Needs your answer",
      reply:
        "I need one decision before I can revise this safely. Which direction should the plan take?",
    },
    {
      key: "declined",
      label: "Outside this plan",
      reply:
        "This asks for work beyond revising this plan, so I left the plan unchanged and kept the request in this thread.",
    },
  ];

  // Until the agent round-trip owns response payloads, sent comments receive
  // deterministic simulated outcomes in reading order. This makes every
  // adopted thread state genuinely operable without presenting demo prose as
  // an agent-authored result.
  const outcomeFor = (comment) => {
    const index = Math.max(
      0,
      sent.findIndex((item) => item.id === comment.id),
    );
    return THREAD_OUTCOMES[index % THREAD_OUTCOMES.length];
  };

  const outcomeCounts = () => {
    const counts = { changed: 0, question: 0, declined: 0 };
    for (const comment of sent) {
      counts[outcomeFor(comment).key] += 1;
    }
    return counts;
  };

  const needsAnswerCount = () => outcomeCounts().question;

  const shortEcho = (body, limit = 88) =>
    body.length <= limit ? body : body.slice(0, limit - 1).trimEnd() + "…";

  const openDeleteDialog = (comment) => {
    deleteCandidateId = comment.id;
    deleteDescription.textContent =
      "This permanently removes your staged comment. This action cannot be undone.";
    deleteDialog.showModal();
  };

  const commitDraftEdit = async (comment, field) => {
    const body = field.value.trim();
    if (body === "") return;
    comment.body = body;
    editingId = null;
    announce("Comment updated.");
    renderTray();
    await save();
  };

  const draftRow = (comment) => {
    const isEditing = comment.id === editingId;
    const jump = el("button", {
      type: "button",
      "data-review-row-target": true,
      text: slideTitleFor(comment.target),
      title: "Jump to this target",
    });
    jump.addEventListener("click", () => focusTarget(comment));
    const state = el("span", {
      "data-review-comment-state": "staged",
      text: "Staged",
    });

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
        text: "Remove",
      });
      remove.addEventListener("click", () => openDeleteDialog(comment));
      return el("li", { "data-review-row": true }, [
        el("div", { "data-review-row-head": true }, [jump, state]),
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
    const commit = () => commitDraftEdit(comment, field);
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
        el("div", { "data-review-row-head": true }, [jump, state]),
        field,
        el("div", { "data-review-row-actions": true }, [cancel, confirm]),
      ],
    );
    if (railIsOpen()) setTimeout(() => field.focus(), 0);
    return row;
  };

  const openThreadAt = (comment) => {
    expandedThreadIds.add(comment.id);
    editingId = null;
    setRailOpen(false);
    renderTray();
    requestAnimationFrame(() => {
      focusTarget(comment);
      positionThreadCards();
    });
  };

  const sendThreadReply = (comment, field) => {
    const body = field.value.trim();
    if (body === "") return;
    const createdAt = new Date().toISOString();
    const existing = threadReplies[comment.id] || [];
    threadReplies[comment.id] = existing.concat([
      { role: "user", body, createdAt },
      {
        role: "agent",
        body:
          "Thanks — this simulated turn shows how the anchored conversation grows. " +
          "A live agent reply is not connected yet.",
        createdAt: new Date(Date.now() + 1).toISOString(),
      },
    ]);
    expandedThreadIds.add(comment.id);
    writeLocalState();
    announce("Reply added to this comment thread.");
    renderTray();
  };

  const conversationNodes = (comment) => {
    const outcome = outcomeFor(comment);
    const nodes = [
      el("div", { "data-review-thread-turn": "user" }, [
        el("div", { "data-review-turn-meta": true }, [
          el("strong", { text: "You" }),
          el("time", {
            datetime: comment.createdAt,
            text: relativeCommentTime(comment.createdAt),
          }),
        ]),
        el("p", { text: comment.body }),
      ]),
      el("div", { "data-review-thread-turn": "agent" }, [
        el("div", { "data-review-turn-meta": true }, [
          el("strong", { text: "Agent" }),
          el("span", { "data-review-simulated": true, text: "Simulated" }),
        ]),
        el("p", { text: outcome.reply }),
      ]),
    ];

    if (outcome.key === "changed") {
      const seeChange = el("button", {
        type: "button",
        "data-review-see-change": true,
        text: "See the change",
      });
      seeChange.addEventListener("click", () => focusTarget(comment));
      nodes.push(seeChange);
    }

    for (const message of threadReplies[comment.id] || []) {
      nodes.push(
        el("div", { "data-review-thread-turn": message.role }, [
          el("div", { "data-review-turn-meta": true }, [
            el("strong", {
              text: message.role === "user" ? "You" : "Agent",
            }),
            message.role === "agent"
              ? el("span", {
                  "data-review-simulated": true,
                  text: "Simulated",
                })
              : el("time", {
                  datetime: message.createdAt,
                  text: relativeCommentTime(message.createdAt),
                }),
          ]),
          el("p", { text: message.body }),
        ]),
      );
    }

    const field = el("textarea", {
      "data-review-thread-reply": true,
      rows: "3",
      maxlength: String(BODY_LIMIT),
      placeholder:
        outcome.key === "question"
          ? "Answer the agent…"
          : "Reply to the agent…",
      "aria-label":
        outcome.key === "question"
          ? "Your answer on this comment"
          : "Reply on this comment",
    });
    const sendReply = el("button", {
      type: "button",
      "data-review-thread-reply-send": true,
      disabled: true,
      text: outcome.key === "question" ? "Send answer" : "Reply",
    });
    const syncReply = () => {
      sendReply.disabled = field.value.trim() === "";
    };
    field.addEventListener("input", syncReply);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        sendThreadReply(comment, field);
      }
    });
    sendReply.addEventListener("click", () => sendThreadReply(comment, field));
    nodes.push(
      el("div", { "data-review-thread-reply-box": true }, [
        el("label", {
          text: outcome.key === "question" ? "Your answer" : "Reply",
        }),
        field,
        sendReply,
      ]),
    );
    return nodes;
  };

  const sentRow = (comment) => {
    const outcome = outcomeFor(comment);
    const jump = el("button", {
      type: "button",
      "data-review-row-target": true,
      text: slideTitleFor(comment.target),
      title: "Jump to and expand this thread",
    });
    jump.addEventListener("click", () => openThreadAt(comment));
    const children = [
      el("div", { "data-review-row-head": true }, [
        jump,
        el("span", {
          "data-review-outcome-state": outcome.key,
          text: outcome.label,
        }),
      ]),
      el("p", {
        "data-review-row-body": true,
        text: shortEcho(comment.body),
      }),
    ];
    return el(
      "li",
      {
        "data-review-row": true,
        "data-review-sent-row": true,
        "data-review-outcome": outcome.key,
      },
      children,
    );
  };

  const threadCard = ({ comment, state }) => {
    const isEditing = state === "staged" && comment.id === editingId;
    const card = el("article", {
      "data-review-thread-card": true,
      "data-review-thread-state": state,
      "data-review-comment-id": comment.id,
    });
    const head = el("div", { "data-review-thread-head": true }, [
      el("span", { "data-review-thread-avatar": true, text: "Y" }),
      el("strong", { text: "You" }),
      el("time", {
        datetime: comment.createdAt,
        text: relativeCommentTime(comment.createdAt),
      }),
      el("span", {
        "data-review-comment-state": state,
        text: state === "staged" ? "Staged" : "Sent",
      }),
    ]);
    if (state === "sent") {
      const outcome = outcomeFor(comment);
      const expanded = expandedThreadIds.has(comment.id);
      const summary = el(
        "button",
        {
          type: "button",
          "data-review-thread-summary": true,
          "aria-expanded": expanded ? "true" : "false",
          "aria-label":
            (expanded ? "Collapse" : "Open") +
            " " +
            outcome.label +
            " thread: " +
            shortEcho(comment.body),
        },
        [
          el("span", {
            "data-review-outcome-state": outcome.key,
            text: outcome.label,
          }),
          el("span", {
            "data-review-thread-echo": true,
            text: shortEcho(comment.body),
          }),
          el("span", { "data-review-simulated": true, text: "Simulated" }),
        ],
      );
      summary.addEventListener("click", () => {
        if (expanded) expandedThreadIds.delete(comment.id);
        else expandedThreadIds.add(comment.id);
        renderTray();
        requestAnimationFrame(() => {
          threadLayer
            .querySelector(
              '[data-review-comment-id="' +
                comment.id +
                '"] [data-review-thread-summary]',
            )
            ?.focus();
        });
      });
      card.appendChild(summary);
      if (expanded) {
        card.setAttribute("data-review-thread-expanded", "");
        card.append(...conversationNodes(comment));
      }
      return card;
    }

    card.appendChild(head);

    if (isEditing) {
      const field = el("textarea", {
        "data-review-thread-input": true,
        rows: "4",
        value: comment.body,
        maxlength: String(BODY_LIMIT),
        "aria-label": "Edit your comment",
      });
      const cancel = el("button", {
        type: "button",
        "data-review-thread-cancel": true,
        text: "Cancel",
      });
      cancel.addEventListener("click", () => {
        editingId = null;
        renderTray();
      });
      const confirm = el("button", {
        type: "button",
        "data-review-thread-save": true,
        text: "Save",
      });
      confirm.addEventListener("click", () => commitDraftEdit(comment, field));
      field.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          editingId = null;
          renderTray();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commitDraftEdit(comment, field);
        }
      });
      card.append(
        field,
        el("div", { "data-review-thread-actions": true }, [cancel, confirm]),
      );
      setTimeout(() => field.focus(), 0);
      return card;
    }

    const isLong = comment.body.length > LONG_COMMENT_LIMIT;
    const expanded = expandedCommentIds.has(comment.id);
    const body = el("p", {
      "data-review-thread-body": true,
    });
    if (isLong && !expanded) {
      body.appendChild(
        document.createTextNode(
          comment.body.slice(0, LONG_COMMENT_LIMIT).trimEnd() + " ",
        ),
      );
      const more = el("button", {
        type: "button",
        "data-review-thread-more": true,
        text: "… more",
      });
      more.addEventListener("click", () => {
        expandedCommentIds.add(comment.id);
        renderTray();
      });
      body.appendChild(more);
    } else {
      body.textContent = comment.body;
    }
    card.appendChild(body);
    if (state === "staged") {
      const edit = el("button", {
        type: "button",
        "data-review-thread-edit": true,
        text: "Edit",
      });
      edit.addEventListener("click", () => {
        editingId = comment.id;
        renderTray();
      });
      const remove = el("button", {
        type: "button",
        "data-review-thread-delete": true,
        text: "Remove",
      });
      remove.addEventListener("click", () => openDeleteDialog(comment));
      card.appendChild(
        el("div", { "data-review-thread-actions": true }, [edit, remove]),
      );
    }
    return card;
  };

  const threadEntries = () =>
    drafts
      .map((comment) => ({ comment, state: "staged" }))
      .concat(sent.map((comment) => ({ comment, state: "sent" })));

  const syncFloatingMode = () => {
    const shouldFloat =
      window.innerWidth >= 1280 &&
      !railIsOpen() &&
      (!compose.hidden || drafts.length + sent.length > 0);
    root.toggleAttribute("data-review-floating", shouldFloat);
  };

  const positionThreadCards = () => {
    syncFloatingMode();
    const canFloat =
      window.innerWidth >= 1280 &&
      !railIsOpen() &&
      root.hasAttribute("data-review-floating");
    const cards = Array.from(
      threadLayer.querySelectorAll("[data-review-thread-card]"),
    );
    const composeBottom =
      canFloat &&
      !compose.hidden &&
      compose.hasAttribute("data-review-compose-floating")
        ? compose.getBoundingClientRect().bottom
        : 44;
    let previousBottom = Math.max(44, composeBottom);
    for (const card of cards) {
      const id = card.getAttribute("data-review-comment-id");
      const comment = drafts
        .concat(sent)
        .find((candidate) => candidate.id === id);
      const block = comment ? blockForTarget(comment.target) : null;
      const rect = block?.getBoundingClientRect();
      const visible =
        canFloat &&
        (rect === undefined ||
          rect === null ||
          (rect.bottom >= 44 && rect.top <= window.innerHeight));
      card.hidden = !visible;
      if (!visible) continue;
      const preferredTop = rect ? Math.max(52, rect.top) : 52;
      const top = Math.max(preferredTop, previousBottom + 8);
      card.style.top =
        Math.min(
          top,
          Math.max(52, window.innerHeight - card.offsetHeight - 12),
        ) + "px";
      previousBottom = Number.parseFloat(card.style.top) + card.offsetHeight;
    }
  };

  const renderThreads = () => {
    document
      .querySelectorAll("[data-review-thread-inline]")
      .forEach((card) => card.remove());
    const entries = threadEntries().sort((left, right) => {
      const leftTop =
        blockForTarget(left.comment.target)?.getBoundingClientRect().top ?? 0;
      const rightTop =
        blockForTarget(right.comment.target)?.getBoundingClientRect().top ?? 0;
      return leftTop - rightTop;
    });
    const cards = entries.map(threadCard);
    threadLayer.replaceChildren(...cards);
    if (window.innerWidth < 1280) {
      for (const card of cards) {
        const id = card.getAttribute("data-review-comment-id");
        if (!id || !expandedThreadIds.has(id)) continue;
        const comment = sent.find((candidate) => candidate.id === id);
        const block = comment ? blockForTarget(comment.target) : null;
        if (!block) continue;
        const anchor =
          block.tagName === "TR"
            ? block.closest("[data-table-scroll-container]") || block
            : block;
        card.setAttribute("data-review-thread-inline", "");
        card.hidden = false;
        card.removeAttribute("style");
        anchor.after(card);
      }
    }
    positionThreadCards();
  };

  const renderSentIndex = () => {
    const counts = outcomeCounts();
    responseSummary.textContent =
      "Latest round · " +
      counts.changed +
      " changed · " +
      counts.question +
      " needs your answer · " +
      counts.declined +
      " outside this plan";
    const groups = [
      { key: "question", label: "Needs your answer" },
      { key: "changed", label: "Changed" },
      { key: "declined", label: "Outside this plan" },
    ];
    sentList.replaceChildren(
      ...groups
        .map(({ key, label }) => {
          const comments = sent.filter(
            (comment) => outcomeFor(comment).key === key,
          );
          if (comments.length === 0) return null;
          return el("section", { "data-review-outcome-group": key }, [
            el("h3", { text: label }),
            el("ol", {}, comments.map(sentRow)),
          ]);
        })
        .filter(Boolean),
    );
  };

  const renderTray = () => {
    draftList.replaceChildren(...drafts.map(draftRow));
    emptyNote.hidden = drafts.length > 0;
    const pending = drafts.length;
    const needs = needsAnswerCount();
    countLabel.textContent =
      pending > 0
        ? pending + " pending"
        : needs > 0
          ? needs + " needs your answer"
          : "No action needed";
    toggleCount.textContent = needs > 0 ? String(needs) : "";
    toggle.setAttribute(
      "data-review-has-pending",
      needs > 0 ? "true" : "false",
    );
    toggle.setAttribute("data-review-needs-answer", String(needs));
    toggle.setAttribute(
      "aria-label",
      (railIsOpen() ? "Close" : "Open") +
        " comments sidebar" +
        (needs > 0 ? ", " + needs + " needs your answer" : ""),
    );
    sendButton.disabled = pending === 0;
    sentGroup.hidden = sent.length === 0;
    renderSentIndex();
    renderPlanChat();
    syncPlanChatValidity();
    paintChips();
    paintTargetHighlights();
    renderThreads();
  };

  document.addEventListener("pointerdown", (event) => {
    if (expandedThreadIds.size === 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      (target.closest("[data-review-thread-card]") ||
        target.closest("[data-review-row]") ||
        target.closest("[data-review-marker]"))
    ) {
      return;
    }
    expandedThreadIds.clear();
    renderTray();
  });

  deleteCancel.addEventListener("click", () => deleteDialog.close());
  deleteConfirm.addEventListener("click", async () => {
    if (deleteCandidateId === null) return;
    drafts = drafts.filter((comment) => comment.id !== deleteCandidateId);
    expandedCommentIds.delete(deleteCandidateId);
    deleteCandidateId = null;
    deleteDialog.close();
    announce("Comment removed. " + drafts.length + " staged.");
    renderTray();
    await save();
  });
  deleteDialog.addEventListener("close", () => {
    deleteCandidateId = null;
  });

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
    pendingSelection = null;
    attachLabel.hidden = true;
    // The affordance did its job; leaving it up would float a second control
    // over the card the reviewer is now typing in.
    affordance.hidden = true;
    composeInput.value = "";
    composeSave.disabled = true;
    compose.hidden = false;
    const before = window.scrollY;
    syncFloatingMode();
    paintTargetHighlights();
    positionCompose(target);
    positionThreadCards();
    requestAnimationFrame(() => {
      window.scrollTo(0, before);
      positionCompose(target);
      positionThreadCards();
      composeInput.focus();
    });
  };

  const closeCompose = () => {
    compose.hidden = true;
    composeTarget = null;
    compose.removeAttribute("data-review-compose-inline");
    compose.removeAttribute("data-review-compose-floating");
    compose.removeAttribute("data-review-compose-centered");
    compose.removeAttribute("style");
    if (compose.parentElement !== surface) surface.appendChild(compose);
    paintTargetHighlights();
    syncFloatingMode();
    positionThreadCards();
  };

  const positionCompose = (target) => {
    const block = blockForTarget(target);
    if (!block) {
      compose.removeAttribute("style");
      compose.setAttribute("data-review-compose-centered", "");
      return;
    }
    if (window.innerWidth >= 1280 && !railIsOpen()) {
      if (compose.parentElement !== surface) surface.appendChild(compose);
      compose.removeAttribute("data-review-compose-inline");
      compose.removeAttribute("data-review-compose-centered");
      compose.setAttribute("data-review-compose-floating", "");
      const rect = block.getBoundingClientRect();
      compose.style.top =
        Math.max(
          52,
          Math.min(rect.top, window.innerHeight - compose.offsetHeight - 12),
        ) + "px";
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
    compose.removeAttribute("data-review-compose-floating");
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

  let affordanceDismissTimer = null;

  const cancelAffordanceDismiss = () => {
    if (affordanceDismissTimer === null) return;
    window.clearTimeout(affordanceDismissTimer);
    affordanceDismissTimer = null;
  };

  const hideAffordance = () => {
    cancelAffordanceDismiss();
    if (document.activeElement === affordance) return;
    affordance.hidden = true;
    if (!pendingSelection) cursorBlock = null;
  };

  const scheduleAffordanceDismiss = () => {
    cancelAffordanceDismiss();
    affordanceDismissTimer = window.setTimeout(() => {
      affordanceDismissTimer = null;
      if (!affordance.matches(":hover")) hideAffordance();
    }, 100);
  };

  for (const block of blocks) {
    block.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      if (pendingSelection) return;
      cancelAffordanceDismiss();
      showAffordance(block);
    });
    block.addEventListener("pointerleave", () => {
      if (!pendingSelection) scheduleAffordanceDismiss();
    });
  }
  affordance.addEventListener("pointerenter", cancelAffordanceDismiss);
  affordance.addEventListener("pointerleave", scheduleAffordanceDismiss);
  document.addEventListener("pointerleave", hideAffordance);

  affordance.addEventListener("click", () => {
    if (pendingSelection) {
      openCompose(pendingSelection);
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
    const selectedText = selection.toString();
    const quote = selectedText.trim();
    if (quote === "") return null;
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    const block =
      startBlock ||
      endBlock ||
      blocks.find((candidate) => {
        try {
          return range.intersectsNode(candidate);
        } catch {
          return false;
        }
      });
    if (!block || surface.contains(block)) return null;

    const lineTarget = lineRangeFor(range, block);
    if (lineTarget) return lineTarget;

    const blockLength = block.textContent?.length || 0;
    let start = 0;
    if (block.contains(range.startContainer)) {
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(range.startContainer, range.startOffset);
      start = prefix.toString().length;
    }
    let end = blockLength;
    if (block.contains(range.endContainer)) {
      const throughEnd = document.createRange();
      throughEnd.selectNodeContents(block);
      throughEnd.setEnd(range.endContainer, range.endOffset);
      end = throughEnd.toString().length;
    }
    return {
      type: "selection",
      blockId: block.getAttribute("data-block-id"),
      kind: kindFor(block),
      label: labelFor(block),
      section: block.getAttribute("data-block-section") || "",
      start: start,
      end: Math.max(start, end),
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
        paintTargetHighlights();
      }
      attachLabel.hidden = true;
      return;
    }
    pendingSelection = anchor;
    attachLabel.hidden = false;
    attachInput.checked = false;
    paintTargetHighlights();
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
  let selectionOfferTimer = null;
  document.addEventListener("selectionchange", () => {
    if (selectionOfferTimer !== null) {
      window.clearTimeout(selectionOfferTimer);
    }
    selectionOfferTimer = window.setTimeout(() => {
      selectionOfferTimer = null;
      if (!compose.hidden || document.activeElement === affordance) return;
      offerSelection();
    }, 0);
  });

  // --------------------------------------------------------- plan-wide chat

  const renderPlanChat = () => {
    if (planChatMessages.length === 0) {
      planChatList.replaceChildren(
        el("li", {
          "data-review-chat-empty": true,
          text: "Ask about the plan as a whole. Anchored comment threads stay beside their source.",
        }),
      );
      return;
    }
    planChatList.replaceChildren(
      ...planChatMessages.map((message) =>
        el("li", { "data-review-chat-message": message.role }, [
          el("div", { "data-review-turn-meta": true }, [
            el("strong", {
              text: message.role === "user" ? "You" : "Agent",
            }),
            message.role === "agent"
              ? el("span", {
                  "data-review-simulated": true,
                  text: "Simulated",
                })
              : el("time", {
                  datetime: message.createdAt,
                  text: relativeCommentTime(message.createdAt),
                }),
          ]),
          el("p", { text: message.body }),
        ]),
      ),
    );
  };

  const syncPlanChatValidity = () => {
    agentSave.disabled = agentInput.value.trim() === "";
  };

  const sendPlanChat = async () => {
    const body = agentInput.value.trim();
    if (body === "") return;
    if (attachInput.checked && pendingSelection) {
      addDraft(pendingSelection, body);
      announce("Draft saved on " + describeTarget(pendingSelection) + ".");
      attachInput.checked = false;
      agentInput.value = "";
      activeDraft = "";
      syncPlanChatValidity();
      renderTray();
      await save();
      return;
    }

    const createdAt = new Date().toISOString();
    planChatMessages = planChatMessages.concat([
      { role: "user", body, createdAt },
      {
        role: "agent",
        body:
          "This simulated whole-plan reply shows the separate chat scope. " +
          "A live plan-wide agent round-trip is not connected yet.",
        createdAt: new Date(Date.now() + 1).toISOString(),
      },
    ]);
    agentInput.value = "";
    activeDraft = "";
    attachInput.checked = false;
    syncPlanChatValidity();
    writeLocalState();
    renderPlanChat();
    announce("Plan-wide chat message sent.");
    await save();
  };

  agentSave.addEventListener("click", sendPlanChat);
  let activeDraftTimer = null;
  agentInput.addEventListener("input", () => {
    activeDraft = agentInput.value;
    syncPlanChatValidity();
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
      sendPlanChat();
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
    toggle.title = "Open comments sidebar (Alt+C)";
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
      setActiveTab("comments");
      setRailOpen(false);
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
    syncFloatingMode();
    renderThreads();
    positionMarkers();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (!compose.hidden && composeTarget) positionCompose(composeTarget);
      if (!affordance.hidden && cursorBlock && !pendingSelection) {
        showAffordance(cursorBlock);
      }
      positionThreadCards();
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
      threadReplies = carried.threadReplies;
      planChatMessages = carried.planChatMessages;
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
      threadReplies = carried.threadReplies;
      planChatMessages = carried.planChatMessages;
      activeDraft = carried.activeDraft;
      agentInput.value = activeDraft;
      renderTray();
    }
  };

  renderTray();
  boot();
})();
