# Toggle round 7 review evidence

## Quick review test

### Child wallet task flows

Three picky-reviewer flags found and fixed:

1. Restore removed the fixed maximize layout and waited for the next animation frame before restoring the page scroll, leaving one paint where the document was visibly displaced. Scroll restoration now runs synchronously after all restore-time layout work and before paint.
2. Returning focus to the inline maximize control could independently scroll it into view after restoration. Restore focus now uses `preventScroll`.
3. The old test checked only the eventual scroll position, so it could not detect the visible intermediate jump. The journey now enters maximize from a nonzero page position and samples four consecutive post-restore animation frames.

The focal screen, reading order, labels, and next actions remain unchanged. Viewer chrome restores without moving the document beneath the reader.

### Harbor desktop

Three picky-reviewer flags found and fixed:

1. The resting viewer proxied wheel input through `window.scrollBy`, which discarded the browser's native wheel velocity and made the desktop workspace feel sticky.
2. Independently scrolling ticket panes remained real wheel targets before engagement.
3. A click outside the workspace needed to release pane scrolling reliably.

Actual scroll owners are now marked once by the viewer. At rest they are clipped, allowing native wheel chaining to reach the page; a primary click restores pane scrolling, and an outside click disengages it.

### Harbor tablet

Three picky-reviewer flags found and fixed:

1. The native iPad app-content scroller could capture an ordinary reading gesture.
2. Preventing the event and replaying a synthetic page scroll made travel through the form-factor document slower.
3. Maximize still needs to count as explicit entry even without an inline click.

The resting tablet's internal scroll owner is clipped without disabling its controls. Clicking or maximizing engages it; restoring and then clicking outside returns wheel ownership to the document.

### Harbor phone

Three picky-reviewer flags found and fixed:

1. Tall phone content had the same nested-scroll path as tablet and desktop.
2. The scroll contract had been tested only against one desktop pane rather than every wireframe family.
3. The test did not prove that inactive roots retained zero internal scroll while the page moved past them.

The browser journey now checks all three Harbor wireframe roots in light and dark themes, records every scrollable descendant, and proves those offsets remain unchanged until explicit engagement.

## Chrome results

- Light and dark maximize/restore: entered at page scroll `612px`; the first four rendered frames after Escape were `612, 612, 612, 612`.
- Light and dark continuous document pass: page scroll moved from `1100px` to `3600px` across the desktop, tablet, and phone wireframes; all three roots remained unengaged and all summed inner scroll offsets stayed `0`.
- Light and dark engagement: clicking the Desktop Ticket conversation set `data-wireframe-engaged`; clicking the surrounding rationale cleared it.
- The real-wheel browser test additionally proves the desktop conversation pane scrolls after engagement, then the page owns the wheel again after an outside click.

## Verification

- `bun run build`
- `bun run test:e2e -- test/wireframe.spec.ts` — 11 passed
- Targeted Prettier and ESLint checks
- `git diff --check`

## Screenshots

- `wallet-light.png`
- `wallet-dark.png`
- `form-factors-light.png`
- `form-factors-dark.png`
