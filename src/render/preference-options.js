// The colour themes a reviewer can choose, in the order the settings dialog
// offers them. "default" is the product's own warm paper palette and is the
// value absence means, so it is never written to storage; the rest name a
// :root[data-palette] block in src/render/global.css.
export const PALETTES = /** @type {const} */ ([
  "default",
  "rose-pine",
  "nord",
  "catppuccin",
  "brutalist",
]);

// The subset a record may carry. Keeping the default out of storage is the
// same rule the System appearance mode already follows: absence is the value.
// A theme that has been withdrawn simply leaves this list, which makes an old
// record naming it indistinguishable from a corrupt one and sends the reviewer
// back to the product palette rather than to a theme that no longer exists.
export const STORED_PALETTES = /** @type {const} */ ([
  "rose-pine",
  "nord",
  "catppuccin",
  "brutalist",
]);
