// The diagram leg of the viewer script: the canvas a FlowDiagram becomes, the
// selection model a reviewer works through, and the proposal layer their edits
// paint.
//
// WHY IT LIVES BESIDE viewer-script.ts RATHER THAN INSIDE IT
// The shared maximize behavior is small enough to read in place; this leg is
// not, and it is the only part of the document's script that knows anything
// about one component. Keeping it in its own module lets the shell's script
// stay a list of legs.
//
// THREE IDEAS, IN ORDER
//  1. A CANVAS. Not a scrolling figure. No scrollbars in either axis: the
//     artboard is placed by one transform and the reader zooms and pans it,
//     with the trackpad gestures any canvas tool answers to - pinch to zoom,
//     two fingers to pan - plus drag and the toolbar for everyone else.
//  2. SELECTION. Not hover. Hovering says only "this is clickable". Clicking
//     selects, the selection persists, and its actions ride a bar that cannot
//     slip out from under the pointer the way a hover-revealed button did.
//  3. IN PLACE. A selected element is edited where it lives - type into it,
//     press Delete - and the proposal layer paints the result. Only a comment
//     needs a compose surface, because only a comment has nowhere to be typed.
//
// WHAT IT MAY AND MAY NOT ASSUME
// It reads two contracts it cannot import, because a string template has no
// imports: the maximize vocabulary owned by
// components/_model/figure-controls/figure-controls.ts, and the element-anchor
// attributes owned by components/flow-diagram/anchors.ts. A change to either
// spelling changes the strings here too.
//
// It never promotes or restores a figure itself. The shared leg owns that
// toggle; this one watches for the attribute and refits the canvas.
//
// THE TRANSPORT IS A STUB, ON PURPOSE
// Drafts live in memory and Send does nothing. Commenting Phase 1 owns the
// real draft store, tray, and package; this leg exists so the interaction
// design can be tried end to end before that lands, and the tray says so on
// its face rather than pretending to deliver.

import { MESSAGE_SQUARE_ICON } from "../../icons/lucide/message-square.js";
import { PENCIL_LINE_ICON } from "../../icons/lucide/pencil-line.js";
import { ROTATE_CCW_ICON } from "../../icons/lucide/rotate-ccw.js";
import { TRASH_2_ICON } from "../../icons/lucide/trash-2.js";
import { X_ICON } from "../../icons/lucide/x.js";
import { lucideIconToMarkup } from "./lucide-icon-markup.js";

const ICON_COMMENT = lucideIconToMarkup(MESSAGE_SQUARE_ICON);
const ICON_EDIT = lucideIconToMarkup(PENCIL_LINE_ICON);
const ICON_DELETE = lucideIconToMarkup(TRASH_2_ICON);
const ICON_REVERT = lucideIconToMarkup(ROTATE_CCW_ICON);
const ICON_CLOSE = lucideIconToMarkup(X_ICON);

export const DIAGRAM_SCRIPT = `
(() => {
  const diagrams = Array.from(document.querySelectorAll("[data-flow-diagram]"));
  if (diagrams.length === 0) return;

  const ICON = {
    comment: '${ICON_COMMENT}',
    edit: '${ICON_EDIT}',
    del: '${ICON_DELETE}',
    revert: '${ICON_REVERT}',
    close: '${ICON_CLOSE}',
  };
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const FIELD_LABELS = {
    label: "Label",
    code: "Identifier line",
    badge: "Badge",
    body: "Body line",
    title: "Title",
    footer: "Footer paragraph",
  };
  // How far the artboard may be pushed past the canvas edge before it stops,
  // so a diagram can never be flung out of sight.
  const PAN_MARGIN = 56;

  // Set by a pan that actually moved, read by the click that follows it.
  let suppressClick = false;

  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const quote = (v) => String.fromCharCode(8220) + v + String.fromCharCode(8221);

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
  const kindOf = (n) => n.getAttribute("data-flow-element");
  const nameOf = (n) => n.getAttribute("data-flow-name") || "element";
  const anchorOf = (n) => n.getAttribute("data-flow-anchor") || "";
  const elementsIn = (diagram) =>
    Array.from(diagram.querySelectorAll("[data-flow-element]"));
  const targetsIn = (diagram) => [diagram].concat(elementsIn(diagram));
  const fieldsIn = (node) => {
    const own = [];
    for (const field of node.querySelectorAll("[data-flow-field]")) {
      if (field.closest("[data-flow-element]") === node) own.push(field);
    }
    return own;
  };
  const nodesIn = (d) => Array.from(d.querySelectorAll('[data-flow-element="node"]'));
  const edgesIn = (d) => Array.from(d.querySelectorAll('[data-flow-element="edge"]'));

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
      const before = [], after = [];
      const find = (wanted) =>
        nodesIn(diagram).find((n) => n.getAttribute("data-flow-node") === wanted);
      for (const edge of edgesIn(diagram)) {
        const from = edge.getAttribute("data-flow-edge-from");
        const to = edge.getAttribute("data-flow-edge-to");
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
    return node.getAttribute("data-flow-where") || "";
  };

  // --- The draft store (in memory; nothing is persisted or sent) ---------
  let drafts = [];
  let nextId = 1;
  const removalOn = (node) =>
    drafts.find((d) => d.kind === "remove-element" && d.element === node);

  // Undo is a stack of draft-list snapshots. The list is small and every
  // entry is a plain object, so a shallow copy is a complete restore point -
  // no command objects, no inverse operations to keep correct.
  const history = [];
  const pushHistory = () => {
    history.push(drafts.slice());
    if (history.length > 50) history.shift();
  };
  const undo = () => {
    if (history.length === 0) return false;
    drafts = history.pop();
    announce("Undone");
    paint();
    return true;
  };

  // --- The canvas ---------------------------------------------------------
  // One transform per diagram. Nothing scrolls; x, y and zoom are the whole
  // state, and every affordance is re-anchored from them.
  const canvas = new Map();
  for (const diagram of diagrams) {
    const viewport = diagram.querySelector("[data-flow-viewport]");
    const sizer = diagram.querySelector("[data-flow-sizer]");
    const artboard = diagram.querySelector("[data-flow-artboard]");
    if (!viewport || !sizer || !artboard) continue;
    canvas.set(diagram, { viewport, sizer, artboard, x: 0, y: 0, zoom: 1 });
    diagram.setAttribute("data-flow-canvas", "");
  }

  const applyTransform = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    c.sizer.style.transform =
      "translate(" + c.x + "px," + c.y + "px) scale(" + c.zoom + ")";
    const readout = diagram.querySelector("[data-flow-zoom-readout]");
    if (readout) readout.textContent = Math.round(c.zoom * 100) + "%";
    reanchor();
  };

  const clampPan = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    const vw = c.viewport.clientWidth, vh = c.viewport.clientHeight;
    const aw = c.artboard.offsetWidth * c.zoom;
    const ah = c.artboard.offsetHeight * c.zoom;
    c.x = aw <= vw
      ? clamp(c.x, -PAN_MARGIN, vw - aw + PAN_MARGIN)
      : clamp(c.x, vw - aw - PAN_MARGIN, PAN_MARGIN);
    c.y = ah <= vh
      ? clamp(c.y, -PAN_MARGIN, vh - ah + PAN_MARGIN)
      : clamp(c.y, vh - ah - PAN_MARGIN, PAN_MARGIN);
  };

  // Zoom about a point, so the artboard pixel under the pointer stays put -
  // the thing that makes pinch feel like pinch rather than like a slider.
  const zoomAbout = (diagram, nextZoom, px, py) => {
    const c = canvas.get(diagram);
    if (!c) return;
    c.userZoomed = true;
    const z1 = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    if (z1 === c.zoom) return;
    const ratio = z1 / c.zoom;
    c.x = px - (px - c.x) * ratio;
    c.y = py - (py - c.y) * ratio;
    c.zoom = z1;
    clampPan(diagram);
    applyTransform(diagram);
    diagram.toggleAttribute("data-flow-zoomed", true);
  };

  const zoomCentered = (diagram, nextZoom) => {
    const c = canvas.get(diagram);
    if (!c) return;
    zoomAbout(diagram, nextZoom, c.viewport.clientWidth / 2, c.viewport.clientHeight / 2);
  };

  // Fit is measured when it is asked for, never at load: a figure inside a
  // collapsed slide is display:none and measures zero.
  const fit = (diagram) => {
    const c = canvas.get(diagram);
    if (!c) return;
    const vw = c.viewport.clientWidth, vh = c.viewport.clientHeight;
    const aw = c.artboard.offsetWidth, ah = c.artboard.offsetHeight;
    if (!aw || !ah || !vw || !vh) return;
    // Capped at 100 percent, so a small diagram is never blown into a poster.
    const pad = 24;
    c.zoom = clamp(Math.min((vw - pad) / aw, (vh - pad) / ah, 1), ZOOM_MIN, ZOOM_MAX);
    c.x = (vw - aw * c.zoom) / 2;
    c.y = (vh - ah * c.zoom) / 2;
    c.userZoomed = false;
    diagram.removeAttribute("data-flow-zoomed");
    applyTransform(diagram);
  };

  // An edit changes how wide a node is, which changes how much room the
  // diagram needs. A canvas the reader has not taken control of follows the
  // content; one they have zoomed themselves is left exactly where they put
  // it, because moving it under them would be worse than a little clipping.
  const refitIfUntouched = (diagram) => {
    const c = canvas.get(diagram);
    if (!c || c.userZoomed) return;
    sizeRestingCanvas(diagram);
    fit(diagram);
  };

  const stepZoom = (diagram, direction) => {
    const c = canvas.get(diagram);
    if (!c) return;
    let next;
    if (direction > 0) {
      next = ZOOM_STEPS.find((s) => s > c.zoom + 0.001);
      if (next === undefined) next = ZOOM_MAX;
    } else {
      const lower = ZOOM_STEPS.filter((s) => s < c.zoom - 0.001);
      next = lower.length ? lower[lower.length - 1] : ZOOM_MIN;
    }
    zoomCentered(diagram, next);
  };

  // At rest the canvas has no height of its own, so it takes the one the
  // fitted artboard wants - capped, because a tall diagram should not push the
  // rest of the plan off the screen.
  const sizeRestingCanvas = (diagram) => {
    const c = canvas.get(diagram);
    if (!c || diagram.hasAttribute("data-figure-maximized")) return;
    const available = c.viewport.clientWidth;
    const aw = c.artboard.offsetWidth, ah = c.artboard.offsetHeight;
    if (!aw || !ah || !available) return;
    const scale = Math.min(available / aw, 1);
    const height = Math.min(ah * scale + 24, Math.round(innerHeight * 0.7));
    c.viewport.style.height = Math.max(height, 140) + "px";
  };

  for (const diagram of diagrams) {
    const c = canvas.get(diagram);
    if (!c) continue;

    // Trackpad first: a pinch arrives as a wheel event with ctrlKey set, and
    // two-finger panning as a plain wheel with both deltas. Both are ours, so
    // both are prevented - otherwise the page scrolls out from under the
    // gesture and the browser runs its own zoom on top of it.
    c.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = c.viewport.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        zoomAbout(diagram, c.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
        return;
      }
      c.x -= event.deltaX;
      c.y -= event.deltaY;
      clampPan(diagram);
      applyTransform(diagram);
    }, { passive: false });

    // Drag to pan, for a mouse. A drag that never really moved is a click, so
    // the threshold decides between panning and selecting.
    let pan = null;
    c.viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("[data-flow-editing], button, a, select, textarea, input")) return;
      pan = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: c.x, oy: c.y, moved: false };
    });
    c.viewport.addEventListener("pointermove", (event) => {
      if (!pan || event.pointerId !== pan.id) return;
      const dx = event.clientX - pan.sx, dy = event.clientY - pan.sy;
      if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!pan.moved) {
        pan.moved = true;
        c.viewport.setAttribute("data-flow-panning", "");
        c.viewport.setPointerCapture(pan.id);
      }
      c.x = pan.ox + dx;
      c.y = pan.oy + dy;
      clampPan(diagram);
      applyTransform(diagram);
    });
    const endPan = () => {
      if (!pan) return;
      c.viewport.removeAttribute("data-flow-panning");
      if (c.viewport.hasPointerCapture(pan.id)) c.viewport.releasePointerCapture(pan.id);
      // A pan that moved swallows the click, so dragging never also selects.
      suppressClick = pan.moved;
      pan = null;
    };
    c.viewport.addEventListener("pointerup", endPan);
    c.viewport.addEventListener("pointercancel", endPan);

    // An overflow:hidden box still scrolls when the browser pulls focus into
    // something outside it - which happens the moment a field near an edge
    // becomes editable. That silent scroll would desync every fixed
    // affordance from the artboard, so it is undone and turned into a pan.
    c.viewport.addEventListener("scroll", () => {
      if (!c.viewport.scrollLeft && !c.viewport.scrollTop) return;
      c.x -= c.viewport.scrollLeft;
      c.y -= c.viewport.scrollTop;
      c.viewport.scrollLeft = 0;
      c.viewport.scrollTop = 0;
      clampPan(diagram);
      applyTransform(diagram);
    });

    for (const button of diagram.querySelectorAll("[data-flow-zoom]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = button.getAttribute("data-flow-zoom");
        if (action === "fit") fit(diagram);
        else stepZoom(diagram, action === "in" ? 1 : -1);
      });
    }
    const zoomControls = diagram.querySelector("[data-flow-zoom-controls]");
    if (zoomControls) zoomControls.hidden = false;
    const zoomSep = diagram.querySelector("[data-flow-zoom-sep]");
    if (zoomSep) zoomSep.hidden = true;

    // The shared leg owns promoting the frame; this one only reacts, so the
    // two can never disagree about who is maximized.
    new MutationObserver(() => {
      if (diagram.hasAttribute("data-figure-maximized")) {
        c.viewport.style.height = "";
      } else {
        sizeRestingCanvas(diagram);
      }
      requestAnimationFrame(() => fit(diagram));
    }).observe(diagram, { attributes: true, attributeFilter: ["data-figure-maximized"] });

  }

  // --- Selection ----------------------------------------------------------
  let selected = null;
  let editing = null;

  const select = (node) => {
    if (selected === node) { reanchor(); return; }
    if (selected) selected.removeAttribute("data-flow-selected");
    selected = node;
    if (selected) {
      selected.setAttribute("data-flow-selected", "");
      announce("Selected " + nameOf(selected));
    }
    buildActionBar();
  };
  const deselect = () => {
    stopEditing(true);
    if (selected) selected.removeAttribute("data-flow-selected");
    selected = null;
    buildActionBar();
  };

  for (const diagram of diagrams) {
    const c = canvas.get(diagram);
    if (!c) continue;
    c.viewport.addEventListener("click", (event) => {
      if (suppressClick) { suppressClick = false; return; }
      if (event.target.closest("[data-flow-editing]")) return;
      const node = event.target.closest("[data-flow-element]");
      if (node && node !== diagram) select(node);
      else deselect();
    });
    // Double-click goes straight into the words: the shortest path from
    // "that is wrong" to typing the right thing.
    c.viewport.addEventListener("dblclick", (event) => {
      const field = event.target.closest("[data-flow-field]");
      if (!field) return;
      const node = field.closest("[data-flow-element]");
      if (!node) return;
      event.preventDefault();
      select(node);
      startEditing(field);
    });
    // Tab reaches the figure itself, which is how the whole diagram becomes
    // commentable without every background click selecting it.
    diagram.addEventListener("focusin", (event) => {
      if (event.target === diagram) select(diagram);
    });
  }

  // --- Editing in place ---------------------------------------------------
  const startEditing = (field) => {
    if (!field) return;
    stopEditing(true);
    const node = field.closest("[data-flow-element]");
    if (removalOn(node)) return;
    editing = { field, node, before: field.textContent };
    field.setAttribute("data-flow-editing", "");
    field.setAttribute("contenteditable", "plaintext-only");
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // The bar changes what it says while a field is open, because what the
    // keyboard does has changed.
    buildActionBar();
  };

  const stopEditing = (cancel) => {
    if (!editing) return;
    const { field, node, before } = editing;
    editing = null;
    field.removeAttribute("contenteditable");
    field.removeAttribute("data-flow-editing");
    setTimeout(buildActionBar, 0);
    const next = (field.textContent || "").trim();
    const original = originalText.get(field);
    const name = field.getAttribute("data-flow-field");
    if (cancel) {
      field.textContent = before;
      paint();
      return;
    }
    // One edit per field: typing it back to what the agent wrote is not a
    // proposal, it is a change of mind, so the draft goes away entirely.
    if (next !== before.trim()) pushHistory();
    drafts = drafts.filter(
      (d) => !(d.kind === "edit-text" && d.element === node && d.fieldName === name),
    );
    if (next && next !== original) {
      drafts.push({
        id: nextId++, kind: "edit-text", diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), field, fieldName: name,
        before: original, after: next,
      });
      announce("Edited " + (FIELD_LABELS[name] || name).toLowerCase() + " of " + nameOf(node));
    }
    trayOpen = true;
    paint();
  };

  document.addEventListener("keydown", (event) => {
    // Undo first: it must work whether or not something is selected, and
    // whether or not the pointer is anywhere near the diagram.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
      if (editing) return;
      if (undo()) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (editing) {
      if (event.key === "Escape") { event.stopPropagation(); stopEditing(true); }
      else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); stopEditing(false); }
      return;
    }
    if (!compose.hidden) return;
    if (!selected) return;
    const active = document.activeElement;
    if (active && active.closest && active.closest(".flow-diagram-compose, .flow-tray")) return;
    if (event.key === "Escape") { event.stopPropagation(); deselect(); return; }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (kindOf(selected) === "figure") return;
      event.preventDefault();
      toggleRemoval(selected);
      return;
    }
    if (event.key === "Enter") {
      const first = fieldsIn(selected)[0];
      if (first) { event.preventDefault(); startEditing(first); }
      return;
    }
    // Type to overwrite. A printable key on a selected element starts editing
    // its first field with that character already typed - the behaviour every
    // canvas and spreadsheet has, and the reason there is no Edit button.
    if (
      event.key.length === 1 &&
      !event.metaKey && !event.ctrlKey && !event.altKey &&
      !removalOn(selected)
    ) {
      const first = fieldsIn(selected)[0];
      if (first) {
        event.preventDefault();
        startEditing(first);
        document.execCommand("insertText", false, event.key);
      }
    }
    if (event.key.indexOf("Arrow") === 0) {
      const diagram = selected.closest("[data-flow-diagram]") || selected;
      const order = targetsIn(diagram);
      const index = order.indexOf(selected);
      const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next >= 0 && next < order.length) {
        event.preventDefault();
        select(order[next]);
        bringIntoView(order[next]);
      }
    }
  }, true);

  // Blur commits, so clicking away from a field is the same as pressing Enter.
  document.addEventListener("focusout", (event) => {
    if (editing && event.target === editing.field) {
      setTimeout(() => { if (editing && editing.field === event.target) stopEditing(false); }, 0);
    }
  });

  const toggleRemoval = (node) => {
    pushHistory();
    const existing = removalOn(node);
    if (existing) {
      drafts = drafts.filter((d) => d !== existing);
      announce("Restored " + nameOf(node));
    } else {
      // A removal supersedes text edits on the same element: two contradictory
      // instructions on one element make the agent guess.
      const withdrawn = drafts.filter((d) => d.kind === "edit-text" && d.element === node);
      drafts = drafts.filter((d) => !(d.kind === "edit-text" && d.element === node));
      const note = withdrawn.length
        ? "Withdrew " + withdrawn.length + " pending edit" + (withdrawn.length === 1 ? "" : "s") +
          " on this element (" +
          withdrawn.map((d) => (FIELD_LABELS[d.fieldName] || d.fieldName).toLowerCase()).join(", ") + ")."
        : "";
      drafts.push({
        id: nextId++, kind: "remove-element",
        diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), reason: "",
        consequence: consequenceOf(node), note,
      });
      announce("Deleted " + nameOf(node));
    }
    trayOpen = true;
    paint();
  };

  // --- Consequences -------------------------------------------------------
  const incidentEdges = (diagram, ids) =>
    edgesIn(diagram).filter(
      (e) => ids.indexOf(e.getAttribute("data-flow-edge-from")) !== -1 ||
             ids.indexOf(e.getAttribute("data-flow-edge-to")) !== -1,
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
  // is told in words, from the compiled shape in the DOM.
  const consequenceOf = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    if (!diagram) return "";
    const gone = removedNodeIdsFor(node);
    const goneEdges = kindOf(node) === "edge" ? [node] : incidentEdges(diagram, gone);
    const sentences = [];
    if (kindOf(node) === "stage" && gone.length > 0) {
      sentences.push(gone.length + (gone.length === 1 ? " node loses its stage" : " nodes lose their stage"));
    }
    const orphans = [];
    for (const candidate of nodesIn(diagram)) {
      const id = candidate.getAttribute("data-flow-node");
      if (gone.indexOf(id) !== -1) continue;
      const incoming = edgesIn(diagram).filter((e) => e.getAttribute("data-flow-edge-to") === id);
      if (incoming.length === 0) continue;
      if (incoming.filter((e) => goneEdges.indexOf(e) === -1).length === 0) orphans.push(labelOfNode(candidate));
    }
    if (orphans.length > 0) {
      const named = orphans.map(quote);
      const list = named.length === 1
        ? named[0]
        : named.slice(0, -1).join(", ") + " and " + named[named.length - 1];
      sentences.push(
        "removing this leaves " + list +
        (orphans.length === 1 ? " with no incoming edge" : " with no incoming edges") +
        "; the agent will re-wire",
      );
    }
    return sentences.join("; ");
  };

  // --- The proposal layer -------------------------------------------------
  const showingOriginal = (diagram) => diagram.hasAttribute("data-flow-original");

  const clearLayer = () => {
    for (const diagram of diagrams) {
      diagram.removeAttribute("data-flow-proposed");
      for (const n of diagram.querySelectorAll("[data-flow-proposed]")) {
        n.removeAttribute("data-flow-proposed");
      }
      for (const old of diagram.querySelectorAll("[data-flow-original]")) old.remove();
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

  // Every label a proposal needs, described here and placed by the collision
  // engine below rather than parented to the artwork it names.
  let labelSpecs = [];

  const paint = () => {
    clearLayer();
    resetNames();
    labelSpecs = [];
    for (const draft of drafts) {
      if (draft.kind !== "remove-element") continue;
      if (showingOriginal(draft.diagram)) continue;
      const node = draft.element;
      addProposedState(node, "removed");
      restateName(node, ", proposed for removal");
      labelSpecs.push({ subject: node, kind: "removed", text: "Removed" });
      const diagram = node.closest("[data-flow-diagram]");
      const gone = removedNodeIdsFor(node);
      if (kindOf(node) !== "edge" && diagram) {
        for (const edge of incidentEdges(diagram, gone)) {
          addProposedState(edge, "removed-incident");
          restateName(edge, ", touches an element proposed for removal");
        }
        for (const stub of diagram.querySelectorAll("[data-flow-stub-from]")) {
          if (gone.indexOf(stub.getAttribute("data-flow-stub-from")) !== -1) {
            addProposedState(stub, "removed-incident");
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
    }
    for (const draft of drafts) {
      if (draft.kind !== "edit-text") continue;
      if (showingOriginal(draft.diagram)) continue;
      const field = draft.field;
      if (!field) continue;
      field.textContent = draft.after;
      field.setAttribute("data-flow-edited", "");
      restateName(draft.element, ", edited from " + quote(draft.before));
      labelSpecs.push({ subject: draft.element, kind: "edited", text: "Edited" });
      // The original is a clone of the field's own tag and classes, so it
      // renders in the same face and size as the text it sits beside - a
      // monospace identifier's original stays monospace. It is always shown,
      // never revealed on hover: hover may highlight an element, it may never
      // change what the element says or how tall it is.
      const struck = document.createElement(field.tagName);
      struck.className = field.className + " flow-diagram-original";
      struck.setAttribute("data-flow-original", "");
      struck.textContent = draft.before;
      if (field.parentNode) field.parentNode.insertBefore(struck, field.nextSibling);
    }
    const counts = new Map();
    for (const draft of drafts) {
      if (draft.kind !== "comment") continue;
      counts.set(draft.element, (counts.get(draft.element) || 0) + 1);
    }
    for (const entry of counts) {
      restateName(entry[0], entry[1] === 1 ? ", 1 comment" : ", " + entry[1] + " comments");
      if (kindOf(entry[0]) !== "figure") {
        labelSpecs.push({ subject: entry[0], kind: "comment", text: String(entry[1]) });
      }
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
      const group = diagram.querySelector("[data-flow-proposal-group]");
      if (group) group.hidden = proposals.length === 0;
      const zoomSep = diagram.querySelector("[data-flow-zoom-sep]");
      if (zoomSep) zoomSep.hidden = mine.length === 0;
      const revertAll = diagram.querySelector("[data-flow-revert-all]");
      if (revertAll) revertAll.hidden = proposals.length < 2;
      if (proposals.length === 0) {
        diagram.removeAttribute("data-flow-original");
        const showOriginal = diagram.querySelector("[data-flow-show-original]");
        if (showOriginal) showOriginal.setAttribute("aria-pressed", "false");
      }
    }
    renderTray();
    for (const diagram of diagrams) refitIfUntouched(diagram);
    buildActionBar();
    reanchor();
  };

  // --- Collision-aware placement -----------------------------------------
  // The problem this solves, in the captain's words: a proposal label hides
  // behind other nodes, and it obscures the very thing that was deleted. So
  // the subject's own rectangle is an obstacle too, not just its neighbours,
  // and a label that cannot find clear air keeps a leader line back to what it
  // names rather than sitting on top of it.
  const overlapArea = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  const placeLabel = ({
    label, subject, obstacles, bounds, textRects, allowBadge, anchorAbove,
  }) => {
    const size = label.getBoundingClientRect();
    const w = size.width, h = size.height;
    const gap = 5;
    const cx = subject.left + subject.width / 2;
    const cy = subject.top + subject.height / 2;
    const fits = (x, y) => ({
      left: x, top: y, right: x + w, bottom: y + h, width: w, height: h,
    });
    // Covering the subject is the failure the captain named first, so it is
    // the most expensive thing a placement can do; covering a neighbour is the
    // second. Distance from the subject is a tie-break, never a trade the
    // engine makes against legibility.
    const costOf = (rect) => {
      let cost = overlapArea(rect, subject) * 6;
      for (const obstacle of obstacles) cost += overlapArea(rect, obstacle) * 2;
      return cost;
    };
    const clampedAt = (x, y) =>
      fits(
        clamp(x, bounds.left + 2, Math.max(bounds.left + 2, bounds.right - w - 2)),
        clamp(y, bounds.top + 2, Math.max(bounds.top + 2, bounds.bottom - h - 2)),
      );

    // First choice for a subject big enough to carry it: a badge inside its own
    // corner, the way any design tool badges an object. Inside is what makes it
    // reliable - it belongs to its subject unmistakably and it cannot collide
    // with a neighbour however tightly the diagram is packed.
    //
    // Which corner is decided by the subject's own words, not by a guess: the
    // badge goes wherever it covers least of the text being proposed against,
    // which is the second half of what the captain asked for.
    if (allowBadge && subject.width > w + 10 && subject.height > h + 8) {
      const inset = 3;
      const corners = [
        [subject.right - w - inset, subject.bottom - h - inset],
        [subject.right - w - inset, subject.top + inset],
      ];
      let bestBadge = null;
      for (const [x, y] of corners) {
        const rect = fits(x, y);
        let covered = 0;
        for (const text of textRects) covered += overlapArea(rect, text);
        for (const obstacle of obstacles) covered += overlapArea(rect, obstacle) * 4;
        if (bestBadge === null || covered < bestBadge.covered) bestBadge = { rect, covered };
      }
      // A badge that would sit squarely on the words helps nobody; that case
      // falls through to the placements outside.
      if (bestBadge && bestBadge.covered < w * h * 0.35) {
        return { x: bestBadge.rect.left, y: bestBadge.rect.top, rect: bestBadge.rect, badge: true };
      }
    }

    // Preferred placements, closest and least intrusive first. The action bar
    // asks to sit just above and centred on its selection - that is where the
    // captain expects it - and only travels when that would bury something.
    const candidates = anchorAbove ? [
      [cx - w / 2, subject.top - h - gap * 2],
      [subject.left, subject.top - h - gap * 2],
      [subject.right - w, subject.top - h - gap * 2],
      [cx - w / 2, subject.bottom + gap * 2],
      [subject.left, subject.bottom + gap * 2],
      [subject.right + gap, cy - h / 2],
      [subject.left - w - gap, cy - h / 2],
    ] : [
      [subject.right - w, subject.top - h - gap],
      [cx - w / 2, subject.top - h - gap],
      [subject.left, subject.top - h - gap],
      [subject.right + gap, cy - h / 2],
      [subject.left - w - gap, cy - h / 2],
      [cx - w / 2, subject.bottom + gap],
      [subject.right - w, subject.bottom + gap],
      [subject.right + gap, subject.top - h - gap],
      [subject.left - w - gap, subject.top - h - gap],
      [subject.right + gap, subject.bottom + gap],
      [subject.left - w - gap, subject.bottom + gap],
    ];
    let best = null;
    candidates.forEach(([x, y], order) => {
      const rect = clampedAt(x, y);
      const cost = costOf(rect) + order * 30;
      if (best === null || cost < best.cost) best = { rect, cost };
    });
    if (best && best.cost === 0) return { x: best.rect.left, y: best.rect.top, rect: best.rect };

    // Nothing adjacent is clear, so look further out: a ring search for the
    // nearest spot that collides with nothing at all. A label that has to
    // travel keeps a leader line home, which is still far better than one
    // sitting on the node it describes.
    for (let radius = 24; radius <= 220; radius += 16) {
      let ringBest = null;
      for (let angle = 0; angle < 360; angle += 15) {
        const rad = (angle * Math.PI) / 180;
        const rect = clampedAt(
          cx - w / 2 + Math.cos(rad) * radius,
          cy - h / 2 + Math.sin(rad) * radius,
        );
        const cost = costOf(rect);
        if (cost === 0) {
          // Prefer staying level with the subject: a label directly above or
          // below reads as belonging to it more than one off a diagonal.
          const bias = Math.abs(Math.sin(rad)) * 4;
          if (ringBest === null || bias < ringBest.bias) ringBest = { rect, bias };
        }
      }
      if (ringBest) return { x: ringBest.rect.left, y: ringBest.rect.top, rect: ringBest.rect };
    }
    return best ? { x: best.rect.left, y: best.rect.top, rect: best.rect } : null;
  };

  // One pool of label elements, reused across repaints so a repaint does not
  // churn the DOM on every keystroke.
  const labelPool = [];
  const leaderPool = [];
  const takeFrom = (pool, className) => {
    for (const item of pool) if (item.hidden) return item;
    const made = el("div", className);
    made.hidden = true;
    document.body.appendChild(made);
    pool.push(made);
    return made;
  };

  // What an element actually occupies on screen. An edge's own rectangle is
  // mostly the invisible padding that makes a two-pixel connector clickable,
  // and treating that as a solid obstacle pushed the action bar and every
  // label away from space they could perfectly well have used. Only its verb
  // chip is really in the way.
  const obstacleRectOf = (node) => {
    if (kindOf(node) !== "edge") return node.getBoundingClientRect();
    const label = node.querySelector("[data-flow-field]");
    return label ? label.getBoundingClientRect() : null;
  };

  const chromeRects = (diagram) => {
    const rects = [];
    if (!actionBar.hidden) rects.push(actionBar.getBoundingClientRect());
    if (!compose.hidden) rects.push(compose.getBoundingClientRect());
    if (!tray.hidden) rects.push(tray.getBoundingClientRect());
    const toolbar = diagram.querySelector("[data-flow-controls]");
    if (toolbar) rects.push(toolbar.getBoundingClientRect());
    return rects;
  };

  const reanchorLabels = () => {
    for (const item of labelPool) item.hidden = true;
    for (const item of leaderPool) item.hidden = true;
    const placed = [];
    for (const spec of labelSpecs) {
      const diagram = spec.subject.closest("[data-flow-diagram]");
      const c = diagram ? canvas.get(diagram) : null;
      if (!c) continue;
      const subject = spec.subject.getBoundingClientRect();
      const bounds = c.viewport.getBoundingClientRect();
      // A subject scrolled out of the canvas gets no label; there is nothing
      // for it to point at.
      if (subject.right < bounds.left || subject.left > bounds.right ||
          subject.bottom < bounds.top || subject.top > bounds.bottom) continue;
      const label = takeFrom(labelPool, "flow-diagram-plabel");
      label.setAttribute("data-kind", spec.kind);
      label.textContent = spec.text;
      label.hidden = false;
      // Other elements, everything already placed this pass, and the viewer's
      // own chrome. A label that ducks behind the action bar is just as hidden
      // as one that ducks behind a node.
      const obstacles = elementsIn(diagram)
        .filter((n) => n !== spec.subject && kindOf(n) !== "figure")
        .map(obstacleRectOf)
        .filter((r) => r !== null && overlapArea(r, bounds) > 0)
        .concat(chromeRects(diagram))
        .concat(placed);
      // Every word the subject shows, so a badge can be put where they are
      // not - including the struck original a proposal just added, which is
      // not a field and would otherwise be invisible to the placement.
      const textRects = fieldsIn(spec.subject)
        .concat(Array.from(spec.subject.querySelectorAll("[data-flow-original]")))
        .map((f) => f.getBoundingClientRect());
      // Only a node draws a card, so only a node has a corner to badge. An
      // edge's rectangle is mostly the invisible padding that makes a
      // two-pixel connector clickable, and a badge dropped inside it reads as
      // sitting on whatever is next door.
      const allowBadge = kindOf(spec.subject) === "node";
      const best = placeLabel({ label, subject, obstacles, bounds, textRects, allowBadge });
      if (!best) { label.hidden = true; continue; }
      label.style.left = best.x + "px";
      label.style.top = best.y + "px";
      placed.push(best.rect);
      // Draw a leader only when the placement had to travel: an adjacent label
      // needs no line, and a distant one is unreadable without it.
      const dx = Math.max(subject.left - best.rect.right, best.rect.left - subject.right, 0);
      const dy = Math.max(subject.top - best.rect.bottom, best.rect.top - subject.bottom, 0);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!best.badge && distance > 12) {
        const leader = takeFrom(leaderPool, "flow-diagram-leader");
        const fromX = best.rect.left + best.rect.width / 2;
        const fromY = best.rect.top + best.rect.height / 2;
        const toX = clamp(fromX, subject.left, subject.right);
        const toY = clamp(fromY, subject.top, subject.bottom);
        const length = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
        leader.hidden = false;
        leader.style.left = fromX + "px";
        leader.style.top = fromY + "px";
        leader.style.width = length + "px";
        leader.style.transform = "rotate(" + Math.atan2(toY - fromY, toX - fromX) + "rad)";
      }
    }
  };

  // --- The action bar a selection offers ----------------------------------
  const actionBar = el("div", "flow-diagram-actionbar");
  actionBar.hidden = true;
  document.body.appendChild(actionBar);

  const addAction = (action, icon, text, onClick, title) => {
    const button = el("button", "flow-diagram-actionbar-button");
    button.type = "button";
    button.setAttribute("data-flow-action", action);
    button.title = title || text;
    button.innerHTML = icon + "<span>" + text + "</span>";
    button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
    actionBar.appendChild(button);
  };

  const buildActionBar = () => {
    actionBar.textContent = "";
    if (!selected) { actionBar.hidden = true; return; }
    // Selection IS the edit mode. There is no Edit button and no Delete
    // button, because clicking one made this feel like a mode you enter
    // rather than a thing you have selected: with an element selected you
    // type to overwrite it and press Delete to remove it. What stays is
    // Comment, which is not direct manipulation and has nowhere else to live,
    // and Revert, which only exists once there is something to revert.
    addAction("comment", ICON.comment, "Comment", () => openCompose(selected));
    const mine = drafts.filter((d) => d.element === selected);
    if (mine.length > 0) {
      addAction("revert", ICON.revert, "Revert", () => revertElement(selected),
        "Revert every change on this element");
    }
    if (editing) {
      actionBar.appendChild(el("span", "flow-diagram-actionbar-hint",
        "Enter to save \u00b7 Esc to cancel"));
    } else if (kindOf(selected) !== "figure") {
      const canType = fieldsIn(selected).length > 0 && !removalOn(selected);
      actionBar.appendChild(el("span", "flow-diagram-actionbar-hint",
        canType ? "Type to edit \u00b7 Delete to remove" : "Delete to restore"));
    }
    actionBar.hidden = false;
    reanchor();
  };

  const revertElement = (node) => {
    if (!drafts.some((d) => d.element === node)) return;
    pushHistory();
    drafts = drafts.filter((d) => d.element !== node);
    announce("Reverted every change on " + nameOf(node));
    paint();
  };

  const positionActionBar = () => {
    if (!selected || actionBar.hidden) return;
    const diagram = selected.closest("[data-flow-diagram]") || selected;
    const c = canvas.get(diagram);
    const subject = selected.getBoundingClientRect();
    const size = actionBar.getBoundingClientRect();
    const bounds = c ? c.viewport.getBoundingClientRect()
                     : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    if (c && (subject.bottom < bounds.top || subject.top > bounds.bottom)) {
      actionBar.style.visibility = "hidden";
      return;
    }
    actionBar.style.visibility = "visible";
    // The bar goes through the same placement engine as a proposal label, for
    // the same reason: it must not cover the element it acts on, and it must
    // not bury a neighbour either - which is exactly what it did when it was
    // simply pinned above the selection.
    // The bar dodges the cards and the verb chips, not the small-caps stage
    // headers. It is transient chrome the reviewer summoned deliberately, and
    // treating an 11-pixel heading as something worth being pushed below the
    // selection for is how it ended up below when the captain asked for
    // above.
    const obstacles = (c ? elementsIn(diagram) : [])
      .filter((n) => n !== selected && (kindOf(n) === "node" || kindOf(n) === "edge"))
      .map(obstacleRectOf)
      .filter((r) => r !== null);
    const room = {
      left: Math.max(bounds.left - 8, 8),
      top: Math.max(bounds.top - 44, 8),
      right: Math.min(bounds.right + 8, innerWidth - 8),
      bottom: Math.min(bounds.bottom + 44, innerHeight - 8),
    };
    const best = placeLabel({
      label: actionBar, subject, obstacles, bounds: room,
      textRects: [], allowBadge: false, anchorAbove: true,
    });
    actionBar.style.left = (best ? best.x : subject.left) + "px";
    actionBar.style.top = (best ? best.y : subject.top - size.height - 6) + "px";
  };

  // A diagram inside a collapsed slide is display:none. Its overlays are
  // children of the body, so nothing takes them away with it - which is how a
  // comment card ended up floating over the collapsed sections after the
  // diagram it belonged to was gone. Visibility is checked on every reanchor,
  // and a host that has left the screen takes its chrome with it.
  const onScreen = (node) =>
    node.isConnected && node.getClientRects().length > 0;

  const dismissOrphanedChrome = () => {
    if (selected && !onScreen(selected)) {
      if (editing) stopEditing(true);
      selected.removeAttribute("data-flow-selected");
      selected = null;
      actionBar.hidden = true;
      actionBar.textContent = "";
    }
    if (composeSubject && !onScreen(composeSubject)) closeCompose();
    for (const diagram of diagrams) {
      if (onScreen(diagram)) continue;
      // Its labels have nothing left to point at.
      labelSpecs = labelSpecs.filter((spec) => spec.subject.closest("[data-flow-diagram]") !== diagram);
    }
  };

  // Everything anchored to the artboard is re-placed together, because every
  // one of them moves when the canvas does.
  let reanchorScheduled = false;
  const reanchor = () => {
    if (reanchorScheduled) return;
    reanchorScheduled = true;
    requestAnimationFrame(() => {
      reanchorScheduled = false;
      dismissOrphanedChrome();
      positionActionBar();
      reanchorLabels();
      positionCompose();
    });
  };

  const bringIntoView = (node) => {
    const diagram = node.closest("[data-flow-diagram]");
    const c = diagram ? canvas.get(diagram) : null;
    if (!c) return;
    const subject = node.getBoundingClientRect();
    const bounds = c.viewport.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (subject.left < bounds.left + 16) dx = bounds.left + 16 - subject.left;
    if (subject.right > bounds.right - 16) dx = bounds.right - 16 - subject.right;
    if (subject.top < bounds.top + 16) dy = bounds.top + 16 - subject.top;
    if (subject.bottom > bounds.bottom - 16) dy = bounds.bottom - 16 - subject.bottom;
    if (dx || dy) {
      c.x += dx; c.y += dy;
      clampPan(diagram);
      applyTransform(diagram);
    }
  };

  // --- Comment compose ----------------------------------------------------
  // The one surface that survives the redesign: a comment has nowhere in the
  // diagram to be typed, so it gets a card. Edits and deletions do not.
  const compose = el("div", "flow-diagram-compose");
  compose.hidden = true;
  compose.setAttribute("role", "dialog");
  document.body.appendChild(compose);
  let composeSubject = null;

  const closeCompose = () => {
    compose.hidden = true;
    compose.textContent = "";
    composeSubject = null;
  };

  const positionCompose = () => {
    if (compose.hidden || !composeSubject) return;
    const subject = composeSubject.getBoundingClientRect();
    const size = compose.getBoundingClientRect();
    compose.style.left = clamp(subject.left, 8, innerWidth - size.width - 8) + "px";
    const below = subject.bottom + 8;
    compose.style.top =
      (below + size.height > innerHeight - 8
        ? clamp(subject.top - size.height - 8, 8, innerHeight - size.height - 8)
        : below) + "px";
  };

  const openCompose = (node) => {
    compose.textContent = "";
    composeSubject = node;
    compose.appendChild(el("p", "flow-diagram-compose-target", "Comment on " + nameOf(node)));
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Write a comment...";
    compose.appendChild(textarea);
    const row = el("div", "flow-diagram-compose-row");
    row.appendChild(el("span", "flow-diagram-compose-hint", "Esc to close"));
    const cancel = el("button", "flow-diagram-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", closeCompose);
    const save = el("button", "flow-diagram-button", "Comment");
    save.type = "button";
    save.setAttribute("data-variant", "primary");
    save.addEventListener("click", () => {
      const value = textarea.value.trim();
      if (!value) { textarea.focus(); return; }
      pushHistory();
      drafts.push({
        id: nextId++, kind: "comment",
        diagram: node.closest("[data-flow-diagram]") || node,
        element: node, anchor: anchorOf(node), body: value,
      });
      announce("Comment saved on " + nameOf(node));
      closeCompose();
      trayOpen = true;
      paint();
    });
    row.appendChild(cancel);
    row.appendChild(save);
    compose.appendChild(row);
    compose.hidden = false;
    positionCompose();
    textarea.focus();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || compose.hidden) return;
    event.stopPropagation();
    closeCompose();
    if (selected) selected.focus({ preventScroll: true });
  }, true);

  // --- The feedback tray (a stand-in for commenting Phase 1) --------------
  const tray = el("aside", "flow-tray");
  tray.hidden = true;
  tray.setAttribute("aria-label", "Diagram feedback");
  const trayHeader = el("div", "flow-tray-header");
  const trayTitle = el("div", "");
  trayTitle.appendChild(el("span", "", "Diagram feedback"));
  const trayScope = el("span", "flow-tray-scope", "");
  trayTitle.appendChild(trayScope);
  trayHeader.appendChild(trayTitle);
  const trayCount = el("span", "flow-tray-count", "0");
  trayHeader.appendChild(trayCount);
  const trayClose = el("button", "flow-tray-close");
  trayClose.type = "button";
  trayClose.setAttribute("aria-label", "Hide the feedback tray");
  trayClose.innerHTML = ICON.close;
  trayHeader.appendChild(trayClose);
  const trayList = el("ul", "flow-tray-list");
  const trayOther = el("p", "flow-tray-other");
  trayOther.hidden = true;
  const trayFoot = el("div", "flow-tray-foot");
  trayFoot.appendChild(trayOther);
  // Disabled and plain on purpose: a bright primary button that does nothing
  // would be the one dishonest pixel in the whole preview.
  const traySend = el("button", "flow-diagram-button", "Add to document feedback");
  traySend.type = "button";
  traySend.disabled = true;
  const trayHandoff = el("p", "flow-tray-handoff",
    "This collector holds one diagram's feedback and hands the batch to the document's feedback collector.");
  const trayStub = el("p", "flow-tray-stub",
    "Preview only: the document-wide collector ships with commenting Phase 1, so nothing leaves this page and nothing is written to the plan source.");
  trayFoot.appendChild(traySend);
  trayFoot.appendChild(trayHandoff);
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

  const KIND_LABEL = { comment: "Comment", "edit-text": "Edit", "remove-element": "Delete" };

  // Which diagram this collector is currently showing: the one the reviewer
  // last touched. One collector per diagram is the model; showing every
  // diagram's drafts in one list was what made it read as document-wide.
  const activeDiagram = () => {
    if (selected) return selected.closest("[data-flow-diagram]") || selected;
    const last = drafts[drafts.length - 1];
    return last ? last.diagram : null;
  };

  const renderTray = () => {
    trayList.textContent = "";
    const scope = activeDiagram();
    const mine = drafts.filter((d) => d.diagram === scope);
    if (scope) {
      trayScope.textContent =
        scope.getAttribute("data-flow-scope") || "This diagram";
    }
    for (const draft of mine) {
      const item = el("li", "flow-tray-item");
      const head = el("div", "flow-tray-item-head");
      const target = el("button", "flow-tray-target", "Flow: " + nameOf(draft.element));
      target.type = "button";
      target.addEventListener("click", () => { select(draft.element); bringIntoView(draft.element); });
      head.appendChild(target);
      const kind = el("span", "flow-tray-kind",
        draft.kind === "edit-text"
          ? KIND_LABEL[draft.kind] + " " + (FIELD_LABELS[draft.fieldName] || draft.fieldName).toLowerCase()
          : KIND_LABEL[draft.kind]);
      kind.setAttribute("data-kind", draft.kind);
      head.appendChild(kind);
      item.appendChild(head);
      const where = whereOf(draft.element);
      if (where) item.appendChild(el("div", "flow-tray-where", where));
      if (draft.kind === "edit-text") {
        const value = el("div", "flow-tray-value");
        value.appendChild(el("s", "", draft.before));
        value.appendChild(document.createTextNode(" " + String.fromCharCode(8594) + " " + draft.after));
        item.appendChild(value);
      }
      if (draft.body) item.appendChild(el("div", "flow-tray-value", draft.body));
      if (draft.consequence) item.appendChild(el("div", "flow-tray-value", "Consequence: " + draft.consequence));
      if (draft.note) item.appendChild(el("div", "flow-tray-note", draft.note));
      const revert = el("button", "flow-tray-revert", "Revert");
      revert.type = "button";
      revert.addEventListener("click", () => {
        pushHistory();
        drafts = drafts.filter((d) => d !== draft);
        announce("Reverted " + KIND_LABEL[draft.kind].toLowerCase() + " on " + nameOf(draft.element));
        paint();
      });
      item.appendChild(revert);
      trayList.appendChild(item);
    }
    // One collector per diagram means another diagram's notes are not in this
    // list. Saying so is the difference between scoping and losing them.
    const elsewhere = drafts.length - mine.length;
    trayOther.hidden = elsewhere === 0;
    trayOther.textContent = elsewhere === 1
      ? "1 more note on another diagram"
      : elsewhere + " more notes on other diagrams";
    trayCount.textContent = String(mine.length);
    traySend.textContent =
      mine.length === 1 ? "Add 1 note to document feedback"
                        : "Add " + mine.length + " notes to document feedback";
    tray.hidden = mine.length === 0 || !trayOpen;
    launcher.hidden = mine.length === 0 || trayOpen;
  };

  // --- Figure-level proposal chrome --------------------------------------
  for (const diagram of diagrams) {
    const showOriginal = diagram.querySelector("[data-flow-show-original]");
    if (showOriginal) {
      showOriginal.addEventListener("click", (event) => {
        event.stopPropagation();
        const on = !showingOriginal(diagram);
        diagram.toggleAttribute("data-flow-original", on);
        showOriginal.setAttribute("aria-pressed", on ? "true" : "false");
        paint();
        announce(on ? "Showing the original diagram" : "Showing proposals");
      });
    }
    const revertAll = diagram.querySelector("[data-flow-revert-all]");
    if (revertAll) {
      revertAll.addEventListener("click", (event) => {
        event.stopPropagation();
        const count = drafts.filter((d) => d.diagram === diagram && d.kind !== "comment").length;
        pushHistory();
        drafts = drafts.filter((d) => !(d.diagram === diagram && d.kind !== "comment"));
        announce("Reverted " + count + " proposals in this diagram");
        paint();
      });
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (compose.contains(event.target) || actionBar.contains(event.target) || tray.contains(event.target)) return;
    if (event.target.closest("[data-flow-diagram]")) return;
    closeCompose();
    deselect();
  });
  // First layout runs last: fitting the canvas re-anchors the action bar and
  // the label layer, so both have to exist before anything is fitted.
  for (const diagram of diagrams) {
    sizeRestingCanvas(diagram);
    fit(diagram);
  }

  // Collapsing a slide changes no attribute on the diagram itself, so the
  // teardown is driven by what actually changed: the size of its host.
  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(() => reanchor());
    for (const diagram of diagrams) sizes.observe(diagram);
  }

  addEventListener("scroll", reanchor, { passive: true, capture: true });
  addEventListener("resize", () => {
    for (const diagram of diagrams) sizeRestingCanvas(diagram);
    reanchor();
  }, { passive: true });
})();
`;
