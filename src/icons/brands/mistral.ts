// Mistral AI brand mark, redrawn from the vendor's published mark, which is a
// stepped grid of squares on a 12x12 lattice: five bands, each band losing a
// square from the left as it descends, with the top band's outer squares
// standing alone. The mark is geometric rather than drawn, so reproducing it
// from its own construction is faithful rather than approximate - unlike a
// vendor mark built from curves, which is why the other unsourced vendors here
// show their name alone instead.
//
// Drawn in one colour like every other mark in this catalog. The published mark
// is a warm gradient across its bands; a single-colour rendering keeps its shape
// and reads correctly on either appearance.
//
// "Mistral AI" is a trademark of Mistral AI; this mark identifies the vendor of
// a connected model and claims no other affiliation.

import type { BrandIcon } from "../brand-icon.js";

// Each entry is one filled square on the lattice: [column, row].
const CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [4, 0],
  [0, 1],
  [2, 1],
  [4, 1],
  [0, 2],
  [2, 2],
  [4, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [4, 3],
  [0, 4],
  [4, 4],
];

const UNIT = 4.8;

export const MISTRAL_ICON: BrandIcon = {
  name: "mistral",
  viewBox: "0 0 24 24",
  node: CELLS.map(([column, row]) => [
    "rect",
    {
      x: String(column * UNIT),
      y: String(row * UNIT),
      width: String(UNIT),
      height: String(UNIT),
    },
  ]),
};
