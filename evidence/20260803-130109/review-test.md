# Toggle rounds 5–6 review evidence

## Quick review test

### Child wallet task flows

Three picky-reviewer flags found and fixed:

1. The toolbar drew a stray horizontal rule unrelated to the iPad frame. `git blame` traced it to commit `4dc55978`, which changed the toolbar's former containing border into `border-bottom`; the rule was removed at that source.
2. The maximize alignment rule lived in the `components` layer and lost its 36px dimensions to the shared button's later Tailwind `h-6 w-6` utilities. The peer-control geometry now lives in `bp-state`, where it actually renders.
3. The many task-flow selectors had insufficient per-item definition. Every pill now carries one quiet 1px edge, with stronger hover and current states.

The quick-review questions now have clear answers: the wallet remains the focal screen, the selectors read as separate choices, the screen toolbar is subordinate chrome, and its two controls form one row without an unrelated divider.

### Harbor form factors

Three picky-reviewer flags found and fixed:

1. The same inherited toolbar rule crossed every Harbor screen; the component-owned source removal clears all form factors.
2. The same shared-control cascade mismatch made the icon target smaller than its neighboring comment button; the rendered buttons are now both 36px high.
3. Scrollable desktop panes could consume a wheel gesture before the reader chose to interact. A resting wireframe now forwards the wheel to the page until a primary click or maximize explicitly engages it.

The quick-review questions now have clear answers: app panes still scroll when intentionally engaged, the reading page remains the owner at rest, and viewer chrome stays visually quieter than the mockup.

## Chrome measurements

Measured on `wireframe.html` at a 1440 × 1000 browser viewport:

| Theme | Toolbar bottom border | Comment button | Maximize button | Raster glyph rows | Glyph-to-button midline delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light | 0px | 36px | 36px | 1–12 of 14 | 0px |
| Dark | 0px | 36px | 36px | 1–12 of 14 | 0px |

The visible maximize SVG was rasterized by Chrome to a 14 × 14 canvas and its non-transparent pixel bounds were measured, rather than treating the SVG viewport or the gap between arrows as the glyph.

## Real gestures

- Light and dark: moved from wallet content to the maximize icon, hovered it, clicked it, asserted the figure entered maximize, pressed Escape, and asserted it restored.
- Light and dark: hovered the scrollable Desktop Ticket conversation without clicking the viewer, scrolled down, and observed page scroll increase from 1388px to 1888px while the pane remained at 0px and the viewer remained unengaged.
- The focused Playwright journey additionally clicks the viewer, asserts `data-wireframe-engaged`, and confirms the conversation pane can then scroll.

## Screenshots

- `wallet-light.png`
- `wallet-dark.png`
- `form-factors-light.png`
- `form-factors-dark.png`
