// Owns the page envelope: the delivery mechanism that packages rendered
// content as a complete, self-contained HTML document (doctype, head, embedded
// favicons, and styles). What the review surface looks like lives in
// shell.ts; this module only decides how a document is wrapped and shipped.
// Future delivery modes (served output with a live-reload client, the SPA
// viewer) swap this envelope while the shell stays the same.

import { FAVICON_DARK_SRC, FAVICON_LIGHT_SRC } from "./branding.generated.js";
import { escapeHtml } from "./escape-html.js";
import {
  PREFERENCES_RECORD_VERSION,
  PREFERENCES_STORAGE_KEY,
  STORED_APPEARANCE_MODES,
} from "./preferences.js";

// Reads only the validated render-mode field before styles are parsed, so a
// stored choice never flashes the other palette on the first frame.
const PREFERENCES_HEAD_SCRIPT = `(() => {
  try {
    const raw = localStorage.getItem(${JSON.stringify(PREFERENCES_STORAGE_KEY)});
    if (raw === null) return;
    const record = JSON.parse(raw);
    if (record?.version !== ${PREFERENCES_RECORD_VERSION}) return;
    if (${JSON.stringify(STORED_APPEARANCE_MODES)}.indexOf(record.mode) !== -1) {
      document.documentElement.setAttribute("data-theme", record.mode);
    }
  } catch (_) {}
})();`;

/**
 * Wraps body markup in a self-contained HTML document. Favicons and styles
 * are embedded, so callers guarantee they reference no external resources
 * and contribute no plan-authored executable code.
 */
export const renderPage = ({
  title,
  styles,
  bodyClassName,
  bodyHtml,
  rootAttributes = {},
}: {
  readonly title: string;
  readonly styles: string;
  readonly bodyClassName: string;
  readonly bodyHtml: string;
  readonly rootAttributes?: Readonly<Record<string, string>>;
}): string => {
  const root = Object.entries(rootAttributes)
    .filter(([name]) => /^data-[a-z-]+$/.test(name))
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  return `<!doctype html>
<html lang="en"${root}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/x-icon" href="${FAVICON_LIGHT_SRC}">
<link rel="icon" type="image/x-icon" media="(prefers-color-scheme: dark)" href="${FAVICON_DARK_SRC}">
<script>${PREFERENCES_HEAD_SCRIPT}</script>
<style>${styles}</style>
</head>
<body class="${escapeHtml(bodyClassName)}">
${bodyHtml}
</body>
</html>
`;
};
