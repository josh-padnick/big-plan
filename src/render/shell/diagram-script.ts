// The diagram leg of the viewer script: the zoom surface a promoted
// FlowDiagram opts into, element targeting, and the proposal layer.
//
// WHY IT LIVES BESIDE viewer-script.ts RATHER THAN INSIDE IT
// The shared maximize behavior is small enough to read in place; this leg is
// not, and it is the only part of the document's script that knows anything
// about one component. Keeping it in its own module lets the shell's script
// stay a list of legs.
//
// WHAT IT MAY AND MAY NOT ASSUME
// It reads two contracts it cannot import, because a string template has no
// imports: the maximize vocabulary owned by
// components/_model/figure-controls/figure-controls.ts, and the element-anchor
// attributes owned by components/flow-diagram/anchors.ts. A change to either
// spelling changes the strings here too.
//
// It never promotes or restores a figure itself. The shared leg owns that
// toggle; this one watches for the attribute and lights the zoom surface when
// the frame declares data-figure-surface="zoom".
//
// THE TRANSPORT IS A STUB, ON PURPOSE
// Drafts live in memory and Send does nothing. Commenting Phase 1 owns the
// real draft store, tray, and package; this leg exists so the targeting and
// proposal design can be tried end to end before that lands, and the tray
// says so on its face rather than pretending to deliver.

import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { PENCIL_LINE_ICON } from "../../icons/lucide/pencil-line.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { lucideIconToMarkup } from "./lucide-icon-markup.js";

const ICON_COMMENT = lucideIconToMarkup(MESSAGE_SQUARE_ICON);
const ICON_EDIT = lucideIconToMarkup(PENCIL_LINE_ICON);
const ICON_REMOVE = lucideIconToMarkup(X_ICON);
const ICON_REVERT = lucideIconToMarkup(ROTATE_CCW_ICON);

export const DIAGRAM_SCRIPT = `
(() => {
  const diagrams = Array.from(document.querySelectorAll("[data-flow-diagram]"));
  if (diagrams.length === 0) return;

  const ICON = {
    comment: '${ICON_COMMENT}',
    edit: '${ICON_EDIT}',
    remove: '${ICON_REMOVE}',
    revert: '${ICON_REVERT}',
  };
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const FIELD_LABELS = {
    label: "Label",
    code: "Identifier line",
    badge: "Badge",
    body: "Body line",
    title: "Title",
    footer: "Footer paragraph",
  };

  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const quote = (value) => String.fromCharCode(8220) + value + String.fromCharCode(8221);

  // --- Announcements ----------------------------------------------------
  const live = el("div", "flow-diagram-live");
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  let announceTimer = null;
  const announce = (message) => {
    live.textContent = "";
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { live.textContent = message; }, 40);
  };

  // --- Reading the diagram out of the DOM -------------------------------
  const kindOf = (node) => node.getAttribute("data-flow-element");
  const nameOf = (node) => node.getAttribute("data-flow-name") || "element";
  const anchorOf = (node) => node.getAttribute("data-flow-anchor") || "";
  const targetsIn = (diagram) =>
    [diagram].concat(Array.from(diagram.querySelectorAll("[data-flow-element]")));
  const fieldsIn = (node) => {
    const own = [];
    for (const field of node.querySelectorAll("[data-flow-field]")) {
      if (field.closest("[data-flow-element]") === node) own.push(field);
    }
    return own;
  };
  const nodesIn = (diagram) =>
    Array.from(diagram.querySelectorAll('[data-flow-element="node"]'));
  const edgesIn = (diagram) =>
    Array.from(diagram.querySelectorAll('[data-flow-element="edge"]'));

  // Originals live here rather than in attributes: a proposal repaints the
  // document and must be able to put back exactly what the agent wrote.
  const originalHtml = new WeakMap();
  const originalText = new WeakMap();
  for (const diagram of diagrams) {
    for (const field of diagram.querySelectorAll("[data-flow-field]")) {
      originalHtml.set(field, field.innerHTML);
      originalText.set(field, (field.textContent || "").trim());
    }
  }
  const labelOfNode = (node) => {
    const field = node.querySelector('[data-flow-field="label"]');
    return field ? originalText.get(field) : node.getAttribute("data-flow-node");
  };

  // A node label alone rarely says where you were, so a tray line carries the
  // element's neighborhood too.
  const whereOf = (node) => {
    const kind = kindOf(node);
    const diagram = node.closest("[data-flow-diagram]");
    if (kind === "node") {
      const id = node.getAttribute("data-flow-node");
      const before = [];
      const after = [];
      for (const edge of edgesIn(diagram)) {
        const from = edge.getAttribute("data-flow-edge-from");
        const to = edge.getAttribute("data-flow-edge-to");
        const find = (wanted) =>
          nodesIn(diagram).find((n) => n.getAttribute("data-flow-node") === wanted);
        if (to === id && find(from)) before.push(labelOfNode(find(from)));
        if (from === id && find(to)) after.push(labelOfNode(find(to)));
      }
      const parts = [];
      if (before.length) parts.push("after " + before.map(quote).join(", "));
      if (after.length) parts.push("before " + after.map(quote).join(", "));
      return parts.join(", ");
    }
    if (kind === "edge") {
      const field = node.querySelector('[data-flow-field="label"]');
      const text = field ? originalText.get(field) : "";
      return text ? "labelled " + quote(text) : "";
    }
    if (kind === "stage") {
      return node.getAttribute("aria-label") || "";
    }
    return "";
  };

  // --- The draft store (in memory; nothing is persisted or sent) ---------
  let drafts = [];
  let nextId = 1;
  const draftsFor = (node) => drafts.filter((d) => d.element === node);

  // --- The proposal layer ------------------------------------------------
  // Every change repaints from the draft list rather than patching in place,
  // so a revert can never leave a half-applied proposal behind.
  const clearLayer = () => {
    for (const diagram of diagrams) {
      diagram.removeAttribute("data-flow-proposed");
      for (const node of diagram.querySelectorAll("[data-flow-proposed]")) {
        node.removeAttribute("data-flow-proposed");
      }
      for (const mark of diagram.querySelectorAll(".flow-diagram-marks")) mark.remove();
      for (const old of diagram.querySelectorAll(".flow-diagram-original, .flow-diagram-original-block")) old.remove();
      for (const field of diagram.querySelectorAll("[data-flow-edited]")) {
        field.innerHTML = originalHtml.get(field);
        field.removeAttribute("data-flow-edited");
      }
    }
  };

  const addProposedState = (node, state) => {
    const current = (node.getAttribute("data-flow-proposed") || "").split(" ").filter(Boolean);
    if (current.indexOf(state) === -1) current.push(state);
    node.setAttribute("data-flow-proposed", current.join(" "));
  };

  const marksOf = (node) => {
    let marks = node.querySelector(":scope > .flow-diagram-marks");
    if (!marks) {
      marks = el("span", "flow-diagram-marks");
      marks.setAttribute("aria-hidden", "true");
      node.appendChild(marks);
    }
    return marks;
  };
  const addMark = (node, kind, text) => {
    const mark = el("span", "flow-diagram-mark", text);
    mark.setAttribute("data-kind", kind);
    marksOf(node).appendChild(mark);
  };

  // An element's accessible name states its proposed state, so a reviewer who
  // cannot see the ghosting still knows what the artboard now claims.
  const baseName = new WeakMap();
  const restateName = (node, suffix) => {
    if (!baseName.has(node)) baseName.set(node, node.getAttribute("aria-label") || "");
    node.setAttribute("aria-label", (node.getAttribute("aria-label") || "") + suffix);
  };
  const resetNames = () => {
    for (const diagram of diagrams) {
      for (const node of targetsIn(diagram)) {
        if (baseName.has(node)) node.setAttribute("aria-label", baseName.get(node));
      }
    }
  };

  const incidentEdges = (diagram, nodeIds) =>
    edgesIn(diagram).filter(
      (edge) =>
        nodeIds.indexOf(edge.getAttribute("data-flow-edge-from")) !== -1 ||
        nodeIds.indexOf(edge.getAttribute("data-flow-edge-to")) !== -1,
    );
  const removedNodeIdsFor = (node) => {
    const kind = kindOf(node);
    if (kind === "node") return [node.getAttribute("data-flow-node")];
    if (kind === "stage") {
      const stage = node.getAttribute("data-flow-stage");
      return nodesIn(node.closest("[data-flow-diagram]"))
        .filter((n) => n.getAttribute("data-flow-in-stage") === stage)
        .map((n) => n.getAttribute("data-flow-node"));
    }
    return [];
  };

  // The compiler requires every node after the first stage to have exactly one
  // incoming edge, so a removal can leave the flow unbuildable. The reviewer
  // is told in words, at proposal time, from the compiled shape in the DOM.
  const consequenceOf = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    const gone = removedNodeIdsFor(node);
    const goneEdges = kindOf(node) === "edge" ? [node] : incidentEdges(diagram, gone);
    const sentences = [];
    if (kindOf(node) === "stage" && gone.length > 0) {
      sentences.push(
        gone.length + (gone.length === 1 ? " node loses" : " nodes lose") + " its stage",
      );
    }
    const orphans = [];
    for (const candidate of nodesIn(diagram)) {
      const id = candidate.getAttribute("data-flow-node");
      if (gone.indexOf(id) !== -1) continue;
      const incoming = edgesIn(diagram).filter((e) => e.getAttribute("data-flow-edge-to") === id);
      if (incoming.length === 0) continue;
      const surviving = incoming.filter((e) => goneEdges.indexOf(e) === -1);
      if (surviving.length === 0) orphans.push(labelOfNode(candidate));
    }
    if (orphans.length > 0) {
      const named = orphans.map(quote);
      const list =
        named.length === 1
          ? named[0]
          : named.slice(0, -1).join(", ") + " and " + named[named.length - 1];
      sentences.push(
        "removing this leaves " +
          list +
          (orphans.length === 1 ? " with no incoming edge" : " with no incoming edges") +
          "; the agent will re-wire",
      );
    }
    return sentences.join("; ");
  };

  const paint = () => {
    clearLayer();
    resetNames();
    // Removals first, so an edit withdrawn by a removal never paints.
    for (const draft of drafts) {
      if (draft.kind !== "remove-element") continue;
      const node = draft.element;
      addProposedState(node, "removed");
      addMark(node, "removed", "Removed");
      restateName(node, ", proposed for removal");
      const diagram = node.closest("[data-flow-diagram]");
      const gone = removedNodeIdsFor(node);
      if (kindOf(node) !== "edge") {
        for (const edge of incidentEdges(diagram, gone)) {
          addProposedState(edge, "removed-incident");
          restateName(edge, ", touches an element proposed for removal");
        }
        for (const stub of diagram.querySelectorAll("[data-flow-stub-from]")) {
          if (gone.indexOf(stub.getAttribute("data-flow-stub-from")) !== -1) {
            addProposedState(stub, "removed-incident");
          }
        }
      }
      if (kindOf(node) === "stage") {
        for (const card of nodesIn(diagram)) {
          if (gone.indexOf(card.getAttribute("data-flow-node")) !== -1) {
            addProposedState(card, "removed-incident");
          }
        }
      }
    }
    for (const draft of drafts) {
      if (draft.kind !== "edit-text") continue;
      const field = draft.field;
      if (!field) continue;
      field.textContent = draft.after;
      field.setAttribute("data-flow-edited", "");
      addMark(draft.element, "edited", "Edited");
      restateName(draft.element, ", edited from " + quote(draft.before));
      // A short field carries its original struck beside it; a paragraph's
      // waits behind the marker and the figure's Show original toggle.
      if (draft.fieldName === "body" || draft.fieldName === "footer") {
        const block = el("span", "flow-diagram-original-block", draft.before);
        draft.element.appendChild(block);
      } else {
        const struck = el("s", "flow-diagram-original", draft.before);
        if (field.parentNode) field.parentNode.insertBefore(struck, field.nextSibling);
      }
    }
    const counts = new Map();
    for (const draft of drafts) {
      if (draft.kind !== "comment") continue;
      counts.set(draft.element, (counts.get(draft.element) || 0) + 1);
    }
    for (const entry of counts) {
      addMark(entry[0], "comment", String(entry[1]));
      restateName(entry[0], entry[1] === 1 ? ", 1 comment" : ", " + entry[1] + " comments");
    }
    for (const diagram of diagrams) {
      const mine = drafts.filter((d) => d.diagram === diagram);
      const proposals = mine.filter((d) => d.kind !== "comment");
      diagram.toggleAttribute("data-flow-has-feedback", mine.length > 0);
      const total = diagram.querySelector("[data-flow-total]");
      if (total) {
        total.hidden = mine.length === 0;
        total.textContent = mine.length === 1 ? "1 note" : mine.length + " notes";
      }
      const showOriginal = diagram.querySelector("[data-flow-show-original]");
      if (showOriginal) showOriginal.hidden = proposals.length === 0;
      const revertAll = diagram.querySelector("[data-flow-revert-all]");
      if (revertAll) revertAll.hidden = proposals.length < 2;
      if (proposals.length === 0) {
        diagram.removeAttribute("data-flow-show-original");
        if (showOriginal) showOriginal.setAttribute("aria-pressed", "false");
      }
    }
    renderTray();
    positionChip();
  };

  // --- The feedback tray (a stand-in for commenting Phase 1) -------------
  const tray = el("aside", "flow-tray");
  tray.hidden = true;
  tray.setAttribute("aria-label", "Feedback tray");
  const trayHeader = el("div", "flow-tray-header");
  trayHeader.appendChild(el("span", "", "Feedback tray"));
  const trayCount = el("span", "flow-tray-count", "0");
  trayHeader.appendChild(trayCount);
  const trayClose = el("button", "flow-tray-close");
  trayClose.type = "button";
  trayClose.setAttribute("aria-label", "Hide the feedback tray");
  trayClose.innerHTML = ICON.remove;
  trayHeader.appendChild(trayClose);
  const trayList = el("ul", "flow-tray-list");
  const trayFoot = el("div", "flow-tray-foot");
  // Disabled and plain on purpose: a bright primary button that does nothing
  // would be the one dishonest pixel in the whole preview.
  const traySend = el("button", "flow-diagram-button", "Send feedback to agent");
  traySend.type = "button";
  traySend.disabled = true;
  const trayStub = el(
    "p",
    "flow-tray-stub",
    "Preview only: nothing is sent and nothing is written to the plan source. The real package ships with commenting Phase 1.",
  );
  trayFoot.appendChild(traySend);
  trayFoot.appendChild(trayStub);
  tray.appendChild(trayHeader);
  tray.appendChild(trayList);
  tray.appendChild(trayFoot);
  document.body.appendChild(tray);

  const launcher = el("button", "flow-tray-launcher");
  launcher.type = "button";
  launcher.hidden = true;
  launcher.innerHTML = ICON.comment + "<span>Feedback tray</span>";
  document.body.appendChild(launcher);
  let trayOpen = true;
  trayClose.addEventListener("click", () => { trayOpen = false; renderTray(); });
  launcher.addEventListener("click", () => { trayOpen = true; renderTray(); });

  const KIND_LABEL = {
    comment: "Comment",
    "edit-text": "Edit",
    "remove-element": "Remove",
  };

  const renderTray = () => {
    trayList.textContent = "";
    for (const draft of drafts) {
      const item = el("li", "flow-tray-item");
      const head = el("div", "flow-tray-item-head");
      const target = el("button", "flow-tray-target", "Flow: " + nameOf(draft.element));
      target.type = "button";
      target.addEventListener("click", () => revealTarget(draft.element));
      head.appendChild(target);
      const kind = el(
        "span",
        "flow-tray-kind",
        draft.kind === "edit-text"
          ? KIND_LABEL[draft.kind] + " " + (FIELD_LABELS[draft.fieldName] || draft.fieldName).toLowerCase()
          : KIND_LABEL[draft.kind],
      );
      kind.setAttribute("data-kind", draft.kind);
      head.appendChild(kind);
      item.appendChild(head);
      const where = whereOf(draft.element);
      if (where) item.appendChild(el("div", "flow-tray-where", where));
      if (draft.kind === "edit-text") {
        const value = el("div", "flow-tray-value");
        const struck = el("s", "", draft.before);
        value.appendChild(struck);
        value.appendChild(document.createTextNode(" " + String.fromCharCode(8594) + " " + draft.after));
        item.appendChild(value);
      }
      if (draft.body) item.appendChild(el("div", "flow-tray-value", draft.body));
      if (draft.reason) item.appendChild(el("div", "flow-tray-value", "Reason: " + draft.reason));
      if (draft.consequence) item.appendChild(el("div", "flow-tray-value", "Consequence: " + draft.consequence));
      if (draft.note) item.appendChild(el("div", "flow-tray-note", draft.note));
      const revert = el("button", "flow-tray-revert", "Revert");
      revert.type = "button";
      revert.addEventListener("click", () => {
        drafts = drafts.filter((d) => d !== draft);
        announce("Reverted " + KIND_LABEL[draft.kind].toLowerCase() + " on " + nameOf(draft.element));
        paint();
      });
      item.appendChild(revert);
      trayList.appendChild(item);
    }
    trayCount.textContent = String(drafts.length);
    tray.hidden = drafts.length === 0 || !trayOpen;
    launcher.hidden = drafts.length === 0 || trayOpen;
    // A promoted figure keeps its artboard clear of the open tray. The tray
    // deliberately sits above the overlay, so without this the widest part of
    // the diagram would be the part nobody can see.
    document.documentElement.toggleAttribute("data-flow-tray-open", !tray.hidden);
    for (const diagram of diagrams) {
      if (isMaximized(diagram)) fit(diagram);
    }
  };

  const revealTarget = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    const viewport = diagram.querySelector("[data-flow-viewport]");
    node.scrollIntoView({ block: "center", inline: "center" });
    if (viewport) {
      const box = node.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      if (box.left < frame.left || box.right > frame.right) {
        viewport.scrollLeft += box.left - frame.left - frame.width / 2 + box.width / 2;
      }
    }
    setTarget(node);
    node.focus({ preventScroll: true });
  };

  // --- Targeting: one ring, one chip -------------------------------------
  const chip = el("button", "flow-diagram-chip");
  chip.type = "button";
  chip.hidden = true;
  chip.innerHTML = ICON.comment + "<span>Comment</span>";
  document.body.appendChild(chip);

  let targeted = null;
  let clearTimer = null;

  const setTarget = (node) => {
    if (targeted === node) return;
    if (targeted) targeted.removeAttribute("data-flow-targeted");
    targeted = node;
    if (targeted) {
      targeted.setAttribute("data-flow-targeted", "");
      chip.setAttribute("aria-label", "Feedback on " + nameOf(targeted));
    }
    positionChip();
  };

  const positionChip = () => {
    if (!targeted) { chip.hidden = true; return; }
    const box = targeted.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) { chip.hidden = true; return; }
    const diagram = targeted.closest("[data-flow-diagram]") || targeted;
    const viewport = diagram.querySelector("[data-flow-viewport]");
    if (viewport && kindOf(targeted) !== "figure" && kindOf(targeted) !== "footer") {
      const frame = viewport.getBoundingClientRect();
      if (box.right < frame.left || box.left > frame.right || box.bottom < frame.top || box.top > frame.bottom) {
        chip.hidden = true;
        return;
      }
    }
    chip.hidden = false;
    const size = chip.getBoundingClientRect();
    // The figure's own chip goes left, because its top-right corner already
    // holds the figure's control bar.
    const left = kindOf(targeted) === "figure" ? box.left + 4 : box.right - size.width;
    chip.style.left = clamp(left, 8, innerWidth - size.width - 8) + "px";
    chip.style.top = clamp(box.top - size.height - 4, 8, innerHeight - size.height - 8) + "px";
  };

  // --- Actions and compose ----------------------------------------------
  const actions = el("div", "flow-diagram-actions");
  actions.hidden = true;
  actions.setAttribute("role", "menu");
  document.body.appendChild(actions);
  const compose = el("div", "flow-diagram-compose");
  compose.hidden = true;
  compose.setAttribute("role", "dialog");
  document.body.appendChild(compose);

  const closeCompose = () => { compose.hidden = true; compose.textContent = ""; };
  const closeActions = () => { actions.hidden = true; actions.textContent = ""; };
  const anythingOpen = () => !actions.hidden || !compose.hidden;

  const placeNear = (panel, box) => {
    panel.style.left = "0px";
    panel.style.top = "0px";
    const size = panel.getBoundingClientRect();
    panel.style.left = clamp(box.left, 8, innerWidth - size.width - 8) + "px";
    const below = box.bottom + 6;
    panel.style.top =
      (below + size.height > innerHeight - 8
        ? clamp(box.top - size.height - 6, 8, innerHeight - size.height - 8)
        : below) + "px";
  };

  const editableFields = (node) =>
    fieldsIn(node).map((field) => ({
      field,
      name: field.getAttribute("data-flow-field"),
    }));

  const openActions = (node) => {
    closeCompose();
    actions.textContent = "";
    actions.appendChild(el("div", "flow-diagram-actions-target", nameOf(node)));
    const add = (action, icon, text) => {
      const button = el("button", "flow-diagram-action");
      button.type = "button";
      button.setAttribute("data-flow-action", action);
      button.innerHTML = icon + "<span>" + text + "</span>";
      button.addEventListener("click", () => { closeActions(); openCompose(node, action); });
      actions.appendChild(button);
    };
    add("comment", ICON.comment, "Comment");
    if (editableFields(node).length > 0) add("edit", ICON.edit, "Suggest edit");
    if (kindOf(node) !== "figure") add("remove", ICON.remove, "Propose removal");
    actions.hidden = false;
    placeNear(actions, node.getBoundingClientRect());
    const first = actions.querySelector("button");
    if (first) first.focus();
  };

  const openCompose = (node, action) => {
    closeActions();
    compose.textContent = "";
    const titles = { comment: "Comment", edit: "Suggest an edit", remove: "Propose removal" };
    compose.appendChild(el("p", "flow-diagram-compose-title", titles[action]));
    compose.appendChild(el("p", "flow-diagram-compose-target", "Flow: " + nameOf(node)));
    let select = null;
    let textarea = null;
    let before = null;
    const fields = editableFields(node);
    if (action === "edit") {
      if (fields.length > 1) {
        const wrap = el("label", "", "Field");
        select = document.createElement("select");
        for (const entry of fields) {
          const option = document.createElement("option");
          option.value = entry.name;
          option.textContent = FIELD_LABELS[entry.name] || entry.name;
          select.appendChild(option);
        }
        wrap.appendChild(select);
        compose.appendChild(wrap);
      }
      before = el("p", "flow-diagram-compose-before");
      compose.appendChild(before);
    }
    if (action === "remove") {
      // The implication comes before the reason box: a reviewer should read
      // what the removal breaks before deciding how to justify it.
      const consequence = consequenceOf(node);
      compose.appendChild(
        el(
          "p",
          "flow-diagram-compose-consequence",
          consequence
            ? "Consequence: " + consequence + "."
            : "Nothing downstream loses its only incoming edge.",
        ),
      );
    }
    const label = el(
      "label",
      "",
      action === "comment" ? "Your note" : action === "edit" ? "Replacement text" : "Reason (optional)",
    );
    textarea = document.createElement("textarea");
    label.appendChild(textarea);
    compose.appendChild(label);
    const syncField = () => {
      const name = select ? select.value : fields[0] ? fields[0].name : null;
      const entry = fields.find((f) => f.name === name);
      const text = entry ? originalText.get(entry.field) : "";
      textarea.value = text;
      before.textContent = "";
      before.appendChild(document.createTextNode("Currently: "));
      before.appendChild(el("s", "", text));
    };
    if (action === "edit") {
      syncField();
      if (select) select.addEventListener("change", syncField);
    }
    const row = el("div", "flow-diagram-compose-row");
    const cancel = el("button", "flow-diagram-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => { closeCompose(); if (targeted) targeted.focus(); });
    const save = el(
      "button",
      "flow-diagram-button",
      action === "comment" ? "Save comment" : action === "edit" ? "Propose edit" : "Propose removal",
    );
    save.type = "button";
    save.setAttribute("data-variant", action === "remove" ? "danger" : "primary");
    save.addEventListener("click", () => commit(node, action, select, textarea, fields));
    row.appendChild(cancel);
    row.appendChild(save);
    compose.appendChild(row);
    compose.hidden = false;
    placeNear(compose, node.getBoundingClientRect());
    textarea.focus();
  };

  const commit = (node, action, select, textarea, fields) => {
    const diagram = node.closest("[data-flow-diagram]") || node;
    const value = textarea.value.trim();
    if (action === "comment") {
      if (!value) { textarea.focus(); return; }
      drafts.push({
        id: nextId++, kind: "comment", diagram, element: node,
        anchor: anchorOf(node), body: value,
      });
      announce("Comment saved on " + nameOf(node));
    } else if (action === "edit") {
      const name = select ? select.value : fields[0] ? fields[0].name : null;
      const entry = fields.find((f) => f.name === name);
      if (!entry || !value) { textarea.focus(); return; }
      // At most one edit per field; a second proposal replaces the first.
      drafts = drafts.filter(
        (d) => !(d.kind === "edit-text" && d.element === node && d.fieldName === name),
      );
      drafts.push({
        id: nextId++, kind: "edit-text", diagram, element: node,
        anchor: anchorOf(node), field: entry.field, fieldName: name,
        before: originalText.get(entry.field), after: value,
      });
      announce("Edit proposed on " + nameOf(node));
    } else {
      // A removal supersedes text edits on the same element: two contradictory
      // instructions on one element make the agent guess.
      const withdrawn = drafts.filter((d) => d.kind === "edit-text" && d.element === node);
      drafts = drafts.filter((d) => !(d.kind === "edit-text" && d.element === node));
      drafts = drafts.filter((d) => !(d.kind === "remove-element" && d.element === node));
      const note = withdrawn.length
        ? "Withdrew " + withdrawn.length + " pending edit" + (withdrawn.length === 1 ? "" : "s") +
          " on this element (" +
          withdrawn.map((d) => (FIELD_LABELS[d.fieldName] || d.fieldName).toLowerCase()).join(", ") + ")."
        : "";
      drafts.push({
        id: nextId++, kind: "remove-element", diagram, element: node,
        anchor: anchorOf(node), reason: value, consequence: consequenceOf(node), note,
      });
      announce("Removal proposed on " + nameOf(node));
    }
    closeCompose();
    trayOpen = true;
    paint();
    if (node.isConnected) node.focus({ preventScroll: true });
  };

  chip.addEventListener("pointerenter", () => clearTimeout(clearTimer));
  chip.addEventListener("click", () => { if (targeted) openActions(targeted); });

  // --- Zoom and pan -------------------------------------------------------
  const surfaces = new Map();
  for (const diagram of diagrams) {
    const viewport = diagram.querySelector("[data-flow-viewport]");
    const artboard = diagram.querySelector("[data-flow-artboard]");
    const sizer = diagram.querySelector("[data-flow-sizer]");
    if (!viewport || !artboard || !sizer) continue;
    surfaces.set(diagram, { viewport, artboard, sizer, zoom: 1 });
  }

  const applyZoom = (diagram, next, anchorPoint) => {
    const surface = surfaces.get(diagram);
    if (!surface) return;
    const previous = surface.zoom;
    const zoom = clamp(next, ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    const point = anchorPoint || {
      x: surface.viewport.scrollLeft + surface.viewport.clientWidth / 2,
      y: surface.viewport.scrollTop + surface.viewport.clientHeight / 2,
    };
    surface.zoom = zoom;
    surface.artboard.style.setProperty("--flow-zoom", String(zoom));
    const width = surface.artboard.offsetWidth;
    const height = surface.artboard.offsetHeight;
    surface.sizer.style.width = width * zoom + "px";
    surface.sizer.style.height = height * zoom + "px";
    surface.viewport.scrollLeft = (point.x / previous) * zoom - surface.viewport.clientWidth / 2;
    surface.viewport.scrollTop = (point.y / previous) * zoom - surface.viewport.clientHeight / 2;
    const readout = diagram.querySelector("[data-flow-zoom-readout]");
    if (readout) readout.textContent = Math.round(zoom * 100) + "%";
    positionChip();
  };
  // Fit is measured when the overlay opens, never at page load: a figure
  // inside a collapsed slide is display:none and measures zero.
  const fit = (diagram) => {
    const surface = surfaces.get(diagram);
    if (!surface) return;
    const style = getComputedStyle(surface.viewport);
    const available =
      surface.viewport.clientWidth -
      parseFloat(style.paddingLeft || "0") -
      parseFloat(style.paddingRight || "0");
    const natural = surface.artboard.offsetWidth;
    if (natural === 0 || available <= 0) return;
    // Capped at 100 percent, so a small diagram is never blown into a poster.
    applyZoom(diagram, Math.min(1, available / natural));
  };
  const stepZoom = (diagram, direction) => {
    const surface = surfaces.get(diagram);
    if (!surface) return;
    const current = surface.zoom;
    let next;
    if (direction > 0) {
      next = ZOOM_STEPS.find((step) => step > current + 0.001);
      if (next === undefined) next = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    } else {
      const lower = ZOOM_STEPS.filter((step) => step < current - 0.001);
      next = lower.length ? lower[lower.length - 1] : ZOOM_STEPS[0];
    }
    applyZoom(diagram, next);
  };
  const resetZoom = (diagram) => {
    const surface = surfaces.get(diagram);
    if (!surface) return;
    surface.artboard.style.removeProperty("--flow-zoom");
    surface.sizer.style.removeProperty("width");
    surface.sizer.style.removeProperty("height");
    surface.zoom = 1;
    const readout = diagram.querySelector("[data-flow-zoom-readout]");
    if (readout) readout.textContent = "100%";
  };

  const isMaximized = (diagram) => diagram.hasAttribute("data-figure-maximized");

  for (const diagram of diagrams) {
    for (const button of diagram.querySelectorAll("[data-flow-zoom]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.getAttribute("data-flow-zoom");
        if (action === "fit") fit(diagram);
        else stepZoom(diagram, action === "in" ? 1 : -1);
      });
    }
    // The shared leg owns promoting the frame; this one only reacts to it, so
    // the two families can never disagree about who is maximized.
    new MutationObserver(() => {
      const controls = diagram.querySelector("[data-flow-zoom-controls]");
      if (isMaximized(diagram)) {
        if (controls) controls.hidden = false;
        requestAnimationFrame(() => fit(diagram));
      } else {
        if (controls) controls.hidden = true;
        resetZoom(diagram);
      }
      positionChip();
    }).observe(diagram, { attributes: true, attributeFilter: ["data-figure-maximized"] });

    const surface = surfaces.get(diagram);
    if (surface) {
      let panning = null;
      surface.viewport.addEventListener("pointerdown", (event) => {
        if (!isMaximized(diagram) || event.button !== 0) return;
        if (event.target.closest("button, a, select, textarea, input")) return;
        panning = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: surface.viewport.scrollLeft,
          top: surface.viewport.scrollTop,
          moved: false,
        };
      });
      surface.viewport.addEventListener("pointermove", (event) => {
        if (!panning || event.pointerId !== panning.id) return;
        const dx = event.clientX - panning.x;
        const dy = event.clientY - panning.y;
        if (!panning.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!panning.moved) {
          panning.moved = true;
          surface.viewport.setAttribute("data-flow-panning", "");
          surface.viewport.setPointerCapture(panning.id);
        }
        surface.viewport.scrollLeft = panning.left - dx;
        surface.viewport.scrollTop = panning.top - dy;
      });
      const endPan = () => {
        if (!panning) return;
        if (panning.moved) surface.viewport.releasePointerCapture(panning.id);
        surface.viewport.removeAttribute("data-flow-panning");
        panning = null;
      };
      surface.viewport.addEventListener("pointerup", endPan);
      surface.viewport.addEventListener("pointercancel", endPan);
      surface.viewport.addEventListener("scroll", positionChip, { passive: true });
    }
  }

  // --- Figure-level proposal chrome --------------------------------------
  for (const diagram of diagrams) {
    const showOriginal = diagram.querySelector("[data-flow-show-original]");
    if (showOriginal) {
      showOriginal.addEventListener("click", (event) => {
        event.stopPropagation();
        const on = !diagram.hasAttribute("data-flow-show-original");
        diagram.toggleAttribute("data-flow-show-original", on);
        showOriginal.setAttribute("aria-pressed", on ? "true" : "false");
        announce(on ? "Showing the original diagram" : "Showing proposals");
      });
    }
    const revertAll = diagram.querySelector("[data-flow-revert-all]");
    if (revertAll) {
      revertAll.addEventListener("click", (event) => {
        event.stopPropagation();
        const removed = drafts.filter((d) => d.diagram === diagram && d.kind !== "comment").length;
        drafts = drafts.filter((d) => !(d.diagram === diagram && d.kind !== "comment"));
        announce("Reverted " + removed + " proposals in this diagram");
        paint();
      });
    }
  }

  // --- Pointer and keyboard reach ----------------------------------------
  for (const diagram of diagrams) {
    diagram.addEventListener("pointerover", (event) => {
      if (anythingOpen()) return;
      if (event.target.closest(".flow-diagram-controls")) return;
      const node = event.target.closest("[data-flow-element]");
      if (!node) return;
      clearTimeout(clearTimer);
      setTarget(node);
    });
    diagram.addEventListener("pointerleave", () => {
      if (anythingOpen()) return;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setTarget(null), 160);
    });
    diagram.addEventListener("focusin", (event) => {
      const node = event.target.closest("[data-flow-element]");
      if (node && diagram.contains(node)) setTarget(node);
    });
    diagram.addEventListener("keydown", (event) => {
      const node = event.target.closest("[data-flow-element]");
      if (!node) return;
      const order = targetsIn(diagram);
      const index = order.indexOf(node);
      const surface = surfaces.get(diagram);
      const panning = isMaximized(diagram) && kindOf(node) === "figure" && surface;
      const step = event.shiftKey ? 160 : 40;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openActions(node);
        return;
      }
      if (panning && event.key.indexOf("Arrow") === 0) {
        event.preventDefault();
        if (event.key === "ArrowLeft") surface.viewport.scrollLeft -= step;
        if (event.key === "ArrowRight") surface.viewport.scrollLeft += step;
        if (event.key === "ArrowUp") surface.viewport.scrollTop -= step;
        if (event.key === "ArrowDown") surface.viewport.scrollTop += step;
        return;
      }
      let next = -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = order.length - 1;
      if (next >= 0 && next < order.length) {
        event.preventDefault();
        order[next].focus({ preventScroll: false });
        setTarget(order[next]);
        return;
      }
      if (!isMaximized(diagram)) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); stepZoom(diagram, 1); }
      if (event.key === "-") { event.preventDefault(); stepZoom(diagram, -1); }
      if (event.key === "0") { event.preventDefault(); fit(diagram); }
      if (event.key === "1") { event.preventDefault(); applyZoom(diagram, 1); }
    });
  }

  // Escape unwinds one level at a time: a compose card or an actions popover
  // first, then the overlay the shared leg owns. Capture, so this leg is
  // asked before the maximize leg closes the panel underneath an open card.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (!compose.hidden) {
        event.stopPropagation();
        closeCompose();
        if (targeted) targeted.focus({ preventScroll: true });
        return;
      }
      if (!actions.hidden) {
        event.stopPropagation();
        closeActions();
        if (targeted) targeted.focus({ preventScroll: true });
      }
    },
    true,
  );

  document.addEventListener("pointerdown", (event) => {
    if (actions.contains(event.target) || compose.contains(event.target) || chip.contains(event.target)) return;
    closeActions();
    closeCompose();
  });
  addEventListener("scroll", positionChip, { passive: true, capture: true });
  addEventListener("resize", () => { positionChip(); }, { passive: true });
})();
`;
