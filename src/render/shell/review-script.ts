// The commenting half of the viewer, packaged as the script tag a rendered
// plan ships. The behavior is authored in assets/review/review.js and bundled
// into the generated module beside this one; this file owns only how that
// bundle is wrapped for embedding, so the shell never handles raw script text.

import { REVIEW_SCRIPT_BODY } from "./review-script.generated.js";

export const REVIEW_SCRIPT = `<script>${REVIEW_SCRIPT_BODY}</script>`;
