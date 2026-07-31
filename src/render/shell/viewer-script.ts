// The one script a rendered document ships, carrying the viewer enhancements:
// a scroll-spy that marks the section being read with aria-current on its TOC
// links (falling back to the overview links above the first section), hover
// popovers that float [data-info-popover] disclosures beside their triggers,
// positioned to stay inside the viewport, and the confirm step of a decision
// selector. Plan content never contributes script, and every affordance keeps
// a no-JS fallback.
export const VIEWER_SCRIPT = `<script>
(() => {
  const links = Array.from(document.querySelectorAll("[data-section-link]"));
  const overviewLinks = Array.from(
    document.querySelectorAll("[data-overview-link]"),
  );
  const targets = new Map();
  for (const link of links) {
    const id = decodeURIComponent((link.getAttribute("href") || "").slice(1));
    const heading = document.getElementById(id);
    if (heading === null) continue;
    targets.set(heading, (targets.get(heading) || []).concat(link));
  }
  const headings = Array.from(targets.keys());
  if (headings.length === 0) return;
  const apply = () => {
    const readingLine = window.innerHeight * 0.25;
    let current = null;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= readingLine) current = heading;
    }
    for (const [heading, sectionLinks] of targets) {
      for (const link of sectionLinks) {
        if (heading === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    }
    for (const link of overviewLinks) {
      if (current === null) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule, { passive: true });
  apply();
})();
(() => {
  const infos = document.querySelectorAll("details[data-info-popover]");
  for (const info of infos) {
    const summary = info.querySelector("summary");
    const body = info.querySelector("[data-info-popover-body]");
    if (summary === null || body === null) continue;
    info.setAttribute("data-info-popover-floating", "");
    const open = () => {
      info.open = true;
      const anchor = summary.getBoundingClientRect();
      body.style.left = "0px";
      body.style.top = "0px";
      const size = body.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(
          anchor.left + anchor.width / 2 - size.width / 2,
          innerWidth - size.width - 8,
        ),
      );
      const below = anchor.bottom + 6;
      const top =
        below + size.height > innerHeight - 8
          ? Math.max(8, anchor.top - size.height - 6)
          : below;
      body.style.left = left + "px";
      body.style.top = top + "px";
    };
    const close = () => {
      info.open = false;
    };
    info.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") open();
    });
    info.addEventListener("pointerleave", () => {
      if (!info.matches(":focus-within")) close();
    });
    summary.addEventListener("focus", () => {
      if (summary.matches(":focus-visible")) open();
    });
    info.addEventListener("focusout", (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !info.contains(event.relatedTarget)
      )
        close();
    });
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      if (info.open) close();
      else open();
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    document.addEventListener(
      "scroll",
      () => {
        if (info.open) open();
      },
      { capture: true, passive: true },
    );
  }
})();
(() => {
  // Decision selectors. Native radios already own picking an option, the
  // selected look, and arrow-key movement, so this leg adds only what markup
  // cannot express: gating the confirm action, following the reader into the
  // proposal textarea, and the answered state.
  for (const decision of document.querySelectorAll(
    "[data-decision-selector]",
  )) {
    const confirm = decision.querySelector("[data-decision-confirm]");
    const change = decision.querySelector("[data-decision-change]");
    const footer = decision.querySelector("[data-decision-footer]");
    const answer = decision.querySelector("[data-decision-answer]");
    const chooseLabel = decision.querySelector("[data-decision-choose-label]");
    const answerTitle = decision.querySelector("[data-decision-answer-title]");
    const answerLead = decision.querySelector("[data-decision-answer-lead]");
    const proposalText = decision.querySelector("[data-decision-proposal-text]");
    const question = decision.querySelector("[data-decision-question]");
    if (confirm === null || change === null || answer === null) continue;
    const cards = Array.from(decision.querySelectorAll("[data-decision-option]"));
    const choices = Array.from(
      decision.querySelectorAll("[data-decision-choice]"),
    );
    // Utilities out-rank a stylesheet display rule, so which regions are
    // showing is carried by the hidden attribute instead.
    const reveal = (node, shown) => {
      if (node !== null) node.hidden = !shown;
    };
    const compress = (answered) => {
      reveal(footer, !answered);
      reveal(chooseLabel, !answered);
      reveal(answer, answered);
      for (const card of cards) {
        const choice = card.querySelector("[data-decision-choice]");
        const kept = choice !== null && choice.checked;
        reveal(card, !answered || kept);
        // Marking the surviving card chosen moves it from the accent (picked)
        // onto the same settled treatment a decided plan renders server-side.
        if (answered && kept) card.setAttribute("data-option-chosen", "");
        else card.removeAttribute("data-option-chosen");
      }
    };
    const picked = () => choices.find((choice) => choice.checked) || null;
    const proposes = (choice) =>
      choice instanceof Element &&
      choice.hasAttribute("data-decision-proposal-choice");
    const proposal = () =>
      proposalText === null ? "" : proposalText.value.trim();
    const sync = () => {
      const choice = picked();
      const proposing = proposes(choice);
      confirm.textContent = proposing ? "Submit proposal" : "Confirm decision";
      confirm.disabled = choice === null || (proposing && proposal() === "");
    };
    decision.addEventListener("change", (event) => {
      sync();
      if (proposes(event.target) && proposalText !== null) proposalText.focus();
    });
    if (proposalText !== null) proposalText.addEventListener("input", sync);
    confirm.addEventListener("click", () => {
      const choice = picked();
      if (choice === null || confirm.disabled) return;
      const proposing = proposes(choice);
      if (answerLead !== null) {
        answerLead.textContent = proposing
          ? "Proposal recorded"
          : "Answer recorded";
      }
      if (answerTitle !== null) {
        answerTitle.textContent = ": " + (proposing ? proposal() : choice.value);
      }
      if (proposalText !== null) proposalText.readOnly = proposing;
      decision.setAttribute("data-decision-answered", "");
      compress(true);
      // The transport carrying an answer back to the agent belongs to the
      // review commenting runtime. Until it lands, the answer is announced on
      // the document and queued where that runtime can drain it.
      const answer = {
        decision: decision.id,
        question: question === null ? "" : question.textContent,
        option: choice.value,
        proposal: proposing ? proposal() : "",
      };
      window.bigPlanDecisionAnswers = window.bigPlanDecisionAnswers || [];
      window.bigPlanDecisionAnswers.push(answer);
      document.dispatchEvent(
        new CustomEvent("bigplan:decision-answered", { detail: answer }),
      );
      change.focus();
    });
    change.addEventListener("click", () => {
      decision.removeAttribute("data-decision-answered");
      compress(false);
      if (proposalText !== null) proposalText.readOnly = false;
      sync();
      const choice = picked();
      if (choice !== null) choice.focus();
    });
    sync();
  }
})();
</script>`;
