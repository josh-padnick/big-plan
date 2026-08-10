// Boots the typed review interaction island. State, polling, and visual
// surfaces remain behind the review controller's single entry point.

import { createRoot } from "react-dom/client";
import { ReviewController } from "./review-controller.browser.js";

const mount = document.createElement("div");
mount.id = "big-plan-review-root";
document.body.append(mount);
createRoot(mount).render(<ReviewController />);
