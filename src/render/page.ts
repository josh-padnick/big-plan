// Owns the page envelope: the delivery mechanism that packages rendered
// content as a complete, self-contained HTML document (doctype, head, embedded
// favicons, styles, and scripts). What the review surface looks like lives in
// shell.ts; this module only decides how a document is wrapped and shipped.
// Future delivery modes (served output with a live-reload client, the SPA
// viewer) swap this envelope while the shell stays the same.

import { FAVICON_DARK_SRC, FAVICON_LIGHT_SRC } from "./branding.generated.js";
import { escapeHtml } from "./escape-html.js";

/**
 * Wraps body markup in a self-contained HTML document. Favicons, styles, and
 * scripts are embedded, so callers guarantee they reference no external
 * resources.
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
<link rel="icon" type="image/x-icon" href="${FAVICON_LIGHT_SRC}">
<link rel="icon" type="image/x-icon" media="(prefers-color-scheme: dark)" href="${FAVICON_DARK_SRC}">
<style>${styles}</style>
</head>
<body class="${escapeHtml(bodyClassName)}">
${bodyHtml}
${scriptTags}
</body>
</html>
`;
};
