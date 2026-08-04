# Toggle round 8 review evidence

## Quick review test

### Child wallet task flows

Three picky-reviewer flags found and fixed:

1. The round-7 scroll gate changed internal overflow from `clip` to `auto` on engagement, so scrollbar gutters subtly narrowed the artboard and rewrapped child-facing text.
2. A selection border on the frame stage could contaminate the artboard's edge pixels even when its width was pre-reserved.
3. The engagement state had no calm, persistent visual confirmation once the click had been accepted.

A transparent interaction shield now keeps the resting page in the wheel event path and disappears on engagement without changing any artboard style. A 4px low-contrast outline decorates the current screen outside its box. The child's task, hierarchy, labels, and next actions remain unchanged.

### Harbor desktop

Three picky-reviewer flags found and fixed:

1. The selected desktop workspace lost 28px from each scrollable pane when the overflow state introduced scrollbars.
2. Reflow changed line breaks in the queue, conversation, and properties columns even though the user had only clicked to engage scrolling.
3. A subtle selected state still needed enough weight to read around a dense desktop workspace.

The interaction shield is a sibling of the desktop panes, so it controls hit testing without touching their geometry. Before and after engagement, the rendered frame remained `769 × 500.59375px`; the cropped artboard screenshot changed by zero pixels in light and dark themes.

### Harbor tablet

Three picky-reviewer flags found and fixed:

1. The prior overflow toggle could change the fitted iPad canvas even though the device frame itself retained its declared ratio.
2. An engagement indicator drawn inside the device would compete with the iPad frame.
3. Tablet scrolling still needed an explicit click boundary without blocking the document's resting wheel path.

The same external shield and screen outline apply to the tablet primitive. The iPad artboard and its internal master/detail layout keep identical dimensions and pixels through engagement, while the outline remains outside the device.

### Harbor phone

Three picky-reviewer flags found and fixed:

1. A phone's narrow measure makes even a small scrollbar-gutter change disproportionately visible.
2. The selected state could not borrow width from the already narrow app canvas.
3. The page needed to retain native scrolling across the tall phone figure until an explicit click.

The shield owns the resting hit-test surface without changing phone overflow, scale, or box size. The external outline communicates engagement without touching the tall phone canvas.

## Five-second review

- First notice: the selected viewer receives one calm gray perimeter; the wireframe's focal content remains visually dominant.
- Primary job: the reader explicitly enters a wireframe before its internal panes claim interaction.
- Next action: click inside to engage, then scroll or use the prototype normally; click outside to return to reading.
- Grouping: selection belongs to the whole current screen, so its outline surrounds the screen rather than an internal card or device.
- Unrelated connections: the indicator does not enter the artboard or imply that one product element is selected.
- Signal strength: the 4px outline is moderately thick but only 38% of the muted theme color.
- Concrete language: no labels changed; existing “Comment on this screen” and maximize controls remain explicit.
- Five-second understanding: the outline confirms entry while the unaltered device still reads as the primary object.
- Emotional goal: engagement feels stable and intentional, never like the mockup jumped under the pointer.
- Fidelity: the hand-drawn product surface stays intact; the viewer's interaction contract is precise.

## Chrome results

- Light theme: real click on the Desktop Ticket screen changed `data-wireframe-engaged` from absent to present; the current screen gained `4px solid color(srgb 0.435294 0.411765 0.360784 / 0.38)`.
- Dark theme: the same gesture gained `4px solid color(srgb 0.643137 0.611765 0.545098 / 0.38)`.
- Geometry in both themes: the frame remained at `x=483.5`, `y=273.96875`, `width=769`, `height=500.59375` before and after the click.
- Pixel diff in both themes: ImageMagick absolute-error count for the cropped artboard was `0`.
- The browser journey additionally checks byte-identical frame screenshots before and after engagement in both themes, then proves internal pane scrolling activates only after the click and releases after an outside click.

## Screenshots

- `wallet-light-full.png`
- `wallet-dark-full.png`
- `form-factors-light-full.png`
- `form-factors-dark-full.png`
- `form-factors-light-before.png`
- `form-factors-light-after.png`
- `form-factors-light-artboard-before.png`
- `form-factors-light-artboard-after.png`
- `form-factors-light-artboard-diff.png`
- `form-factors-dark-before.png`
- `form-factors-dark-after.png`
- `form-factors-dark-artboard-before.png`
- `form-factors-dark-artboard-after.png`
- `form-factors-dark-artboard-diff.png`
