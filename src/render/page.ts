// Owns the page envelope: the delivery mechanism that packages rendered
// content as a complete, self-contained HTML document (doctype, head, inlined
// styles and scripts). What the review surface looks like lives in shell.ts;
// this module only decides how a document is wrapped and shipped. Future
// delivery modes (served output with a live-reload client, the SPA viewer)
// swap this envelope while the shell stays the same.

import { FAVICON_16_SRC, FAVICON_32_SRC } from "./branding.generated.js";
import { escapeHtml } from "./escape-html.js";

/**
 * Wraps body markup in a self-contained HTML document. Styles and scripts are
 * inlined verbatim, so callers guarantee they reference no external resources.
 */
export const renderPage = ({
  title,
  styles,
  scripts,
  bodyClassName,
  bodyHtml,
}: {
  readonly title: string;
  readonly styles: string;
  readonly scripts: ReadonlyArray<string>;
  readonly bodyClassName: string;
  readonly bodyHtml: string;
}): string => {
  const scriptTags = scripts
    .map((script) => `<script>${script}</script>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/png" sizes="32x32" href="${FAVICON_32_SRC}">
<link rel="icon" type="image/png" sizes="16x16" href="${FAVICON_16_SRC}">
<style>${styles}</style>
</head>
<body class="${escapeHtml(bodyClassName)}">
${bodyHtml}
${scriptTags}
</body>
</html>
`;
};
