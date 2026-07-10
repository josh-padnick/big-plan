// Shared HTML escaping for text we interpolate into authored markup (titles,
// TOC labels). Body HTML from the markdown pipeline is already serialized
// safely by rehype-stringify and never passes through here.

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
