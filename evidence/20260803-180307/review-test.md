# Toggle round 9 review evidence

## Quick review test

### Child wallet task flows

Three picky-reviewer flags found and fixed:

1. The round-8 outline selected the entire screen wrapper, so the caption and `Comment on this screen` toolbar appeared to be part of the iPad.
2. The wrapper used the review shell's generic radius rather than the iPad device's larger, uneven corner shape.
3. Reserving space inside the viewport for an external outline reduced every resting frame by about 8px and violated the captain's large-by-default width contract.

Engagement now changes only the device frame's pre-existing transparent outline color. Its inset placement uses the existing bezel rather than new layout space, so the iPad's inherited elliptical radius defines the selection shape while the caption, toolbar, fit, and content remain unchanged.

### Harbor desktop

Three picky-reviewer flags found and fixed:

1. The old perimeter connected the desktop browser mockup to its reviewer caption.
2. It also enclosed review controls that do not belong to the Harbor product.
3. A generic shell radius did not follow the desktop frame's hand-drawn asymmetric corners.

The selected outline now belongs to `.wireframe-frame`, the same element that owns the browser border and `var(--wf-sketch)` radius. The desktop frame again consumes all available width up to the 920px cap, and its frame, artboard, and canvas boxes remain unchanged through engagement.

### Harbor tablet

Three picky-reviewer flags found and fixed:

1. The selected object should be the native iPad, not the surrounding prototype slide.
2. The previous small generic radius fought the iPad's broad bezel radius.
3. Selection must not alter the fixed 1180 × 820 device contract.

The outline follows the tablet frame's inherited `24px 21.6px 24.8px 22.4px / 22.4px 24.8px 21.6px 24px` corner shape. Before and after engagement, the fitted frame remains `802.859375 × 562.578125px`.

### Harbor phone

Three picky-reviewer flags found and fixed:

1. A phone selection should hug the phone silhouette rather than span the full reading column.
2. Caption and toolbar chrome must not read as part of the mobile app.
3. Narrow phone content cannot surrender width to a state border.

The same frame-owned transparent outline applies to the phone's own radius, with no width, fit, or box-model mutation on engagement.

## Five-second review

- First notice: one quiet gray perimeter follows the selected device.
- Primary job: confirm that the wireframe device—not its review controls—is engaged.
- Next action: interact inside the device; click outside to return to reading.
- Grouping: product pixels stay inside the device; captions and review actions remain visibly separate.
- Unrelated connections: selection no longer connects the artboard to `Comment on this screen`.
- Signal strength: the authored 4px outline scales with the device and uses 38% of the muted theme color.
- Concrete language: no product labels changed.
- Five-second understanding: the selected object is unambiguous in both themes.
- Emotional goal: the device feels stable and deliberately selected.
- Fidelity: only viewer chrome changed; the hand-drawn product composition remains intact.

## Chrome results

- Light theme: a real click set `data-wireframe-engaged`; only `.wireframe-frame` received the gray outline. Both `.wireframe-screen` and `.wireframe-frame-stage` reported `outline-style: none`.
- Dark theme: the same real gesture and ownership assertions passed.
- Geometry in both themes: the iPad frame remained `x=466.578125`, `y=297.125`, `width=802.859375`, `height=562.578125`; artboard and canvas rectangles were also identical before and after.
- Pixel diff in both themes: ImageMagick absolute-error count for the artboard interior was `0`.
- The browser journey additionally proves identical interior screenshot bytes in both themes, unchanged caption and toolbar geometry, the restored desktop width contract, and a nonzero rounded device frame with the only active outline.

## Screenshots

- `wallet-light-full.png`
- `wallet-dark-full.png`
- `wallet-light-before.png`
- `wallet-light-after.png`
- `wallet-light-artboard-interior-before.png`
- `wallet-light-artboard-interior-after.png`
- `wallet-light-artboard-interior-diff.png`
- `wallet-dark-before.png`
- `wallet-dark-after.png`
- `wallet-dark-artboard-interior-before.png`
- `wallet-dark-artboard-interior-after.png`
- `wallet-dark-artboard-interior-diff.png`
- `form-factors-light-full.png`
- `form-factors-dark-full.png`
