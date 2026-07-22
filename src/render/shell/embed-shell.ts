// Owns the embed surface: the chromeless alternative to the review shell for
// documents delivered inside a host page (for example the docs site's live
// component frames). No branding bar, no navigation, no theme control, tight
// margins - the host page owns identity and chrome, this surface owns only
// the rendered content and its interactive component controls. The
// theme-toggle script is deliberately absent so a forced color scheme from
// the page envelope can never be re-stamped by a viewer preference stored in
// local storage.

import { GLOBAL_CSS } from "../global.generated.js";
import { COPY_CODE_JS } from "../markdown/code-block/copy-code.generated.js";
import { CODE_DIFF_JS } from "../markdown/components/code-diff/code-diff.generated.js";
import { CODE_SNIPPET_JS } from "../markdown/components/code-snippet/code-snippet.generated.js";
import { FILE_TREE_JS } from "../markdown/components/file-tree/file-tree.generated.js";
import { BODY_CLASSES, type ShellResult } from "./shell.js";

/**
 * Wraps rendered content in the embed surface: an <article> (which prose
 * styles and the full-screen dialogs scope to) inside a padded main region.
 * The data-embed marker scopes embed-only stylesheet rules and makes the
 * components' full-screen dialog announce itself to the host page, which a
 * cooperating host answers by expanding the iframe (full-screen.browser.ts
 * owns that handshake).
 */
export const renderEmbedShell = ({
  contentHtml,
}: {
  readonly contentHtml: string;
}): ShellResult => ({
  html: `<main class="min-w-0 p-3" data-embed>
<article>
${contentHtml}
</article>
</main>`,
  styles: GLOBAL_CSS,
  scripts: [COPY_CODE_JS, CODE_DIFF_JS, CODE_SNIPPET_JS, FILE_TREE_JS],
  bodyClassName: BODY_CLASSES,
});
