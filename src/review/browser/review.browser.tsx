// Boots the typed review interaction island. State, polling, and visual
// surfaces remain behind the review controller's single entry point.

import { createRoot } from "react-dom/client";
import { ReviewController } from "./review-controller.browser.js";
import { DiffTourProvider } from "./diff-tour.browser.js";

// A page the service serves - the welcome page, a stop confirmation, an
// explanation for a link whose review has ended - is not a plan. There is no
// document to comment on, no session to poll, and no revision to diff, so the
// island does not boot at all rather than mounting chrome that would act on
// nothing. The shell's own viewer script still runs, which is what keeps
// Settings and the copy controls working on those pages.
if (document.documentElement.hasAttribute("data-standalone")) {
  // Nothing to do on a page that carries no plan.
} else {
  bootReviewIsland();
}

function bootReviewIsland(): void {
  const mount = document.createElement("div");
  mount.id = "big-plan-review-root";
  document.body.append(mount);
  createRoot(mount).render(
    <DiffTourProvider>
      <ReviewController />
    </DiffTourProvider>,
  );
}
