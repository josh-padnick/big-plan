// Scales one wireframe screen's device frame to fit the space its screen box
// offers - width alone at rest, both width and height once the screen sits
// inside a maximized figure, whose fixed viewport otherwise clips the frame
// or scrolls it out of view - and pins the card and its caption to the width
// the frame actually paints at.
//
// Shared by the shell viewer script, which embeds this source as text
// through its own build step (see viewer-script.ts), and the review diff
// lens, which imports it directly - so a maximized wireframe fits the same
// whether shown in place or inside a Was/Now comparison.
//
// SELF-CONTAINED. The viewer script embeds this through `.toString()`, which
// carries the function body and nothing else. A module-level constant,
// helper, or import referenced from inside it is therefore undefined in the
// browser, and it fails the way a silent bug fails: the frame keeps whatever
// zoom it had, no wireframe reports anything, and only an uncaught
// ReferenceError in the console says why. Everything the fit needs lives
// inside the function. `wireframe-fit.test.ts` re-evaluates the stringified
// source and runs it, so a free reference fails a test rather than a review
// document.
export const fitWireframeScreen = (screen: HTMLElement): void => {
  // The fit is a fixed point: the caption's width follows the frame's painted
  // width, its height follows its width, and the height budget the frame is
  // fitted into is what the caption leaves behind. Each pass moves the scale
  // strictly toward that point and it settles within two or three; the cap
  // only bounds a caption whose wrapping oscillates by a fraction of a pixel.
  const maximumFitPasses = 8;
  // A ten-thousandth of a scale factor is well below one painted pixel on
  // any device this draws, so a pass that moves less has settled.
  const fitSettled = 0.0001;
  // A screen box smaller than the caption plus the card's own inset leaves a
  // negative height budget, and `zoom: -0.31` or `width: -372px` is not an
  // invalid-but-visible value - the CSSOM drops it, the frame silently keeps
  // the previous pass's zoom, and the fit never settles. Every scale is
  // therefore held to a positive floor: a drawing scaled to a twentieth is
  // unreadable, but it is a real answer the loop can converge on.
  const minimumFitScale = 0.05;
  const clampScale = (value: number): number =>
    Math.min(1, Math.max(minimumFitScale, value));
  const card = screen.querySelector<HTMLElement>(
    ":scope > .wireframe-frame-card",
  );
  const frame =
    card === null
      ? null
      : card.querySelector<HTMLElement>(":scope > .wireframe-frame");
  if (card === null || frame === null || screen.clientWidth === 0) return;
  const caption = screen.querySelector<HTMLElement>(
    ":scope > .wireframe-screen-caption",
  );
  // Measure against the element's own layout, not against the pins the last
  // fit left on it, so a resize that gives the screen more room can grow the
  // frame back rather than only ever shrinking it.
  frame.style.zoom = "1";
  card.style.width = "";
  if (caption !== null) caption.style.width = "";
  // The screen itself is padding-free at rest, but the Was/Now diff lens
  // adds a highlight border and padding of its own to the screen it is
  // showing; clientWidth/clientHeight already include that padding, so it is
  // read back out here rather than assumed away, and reserving it keeps this
  // one function correct for both the plain and the highlighted screen.
  const screenStyle = getComputedStyle(screen);
  const screenHorizontalPadding =
    Number.parseFloat(screenStyle.paddingLeft) +
    Number.parseFloat(screenStyle.paddingRight);
  // The card's padding and border sit outside the frame, so the space
  // available to the frame is the screen's width minus that inset - read
  // from computed style rather than a duplicated constant, so the two never
  // drift out of sync.
  const cardStyle = getComputedStyle(card);
  const horizontalInset =
    Number.parseFloat(cardStyle.paddingLeft) +
    Number.parseFloat(cardStyle.paddingRight) +
    Number.parseFloat(cardStyle.borderLeftWidth) +
    Number.parseFloat(cardStyle.borderRightWidth);
  // offsetWidth and offsetHeight stay in the frame's unscaled coordinate
  // space, so they are read once here at zoom 1 and the painted size is
  // derived from them. Writing a numeric zoom avoids relying on unsupported
  // length division in CSS.
  const frameWidth = frame.offsetWidth;
  const frameHeight = frame.offsetHeight;
  const widthScale =
    (screen.clientWidth - screenHorizontalPadding - horizontalInset) /
    frameWidth;
  // The card wraps the painted frame and the caption sits under it, so both
  // are held to exactly the width the frame paints at. Without that the card
  // would keep its true-size footprint and the caption would run the full
  // width of the screen box, leaving a long name overhanging the drawing it
  // names.
  const paint = (scale: number): void => {
    frame.style.zoom = String(scale);
    const paintedWidth = `${String(frameWidth * scale + horizontalInset)}px`;
    card.style.width = paintedWidth;
    if (caption !== null) caption.style.width = paintedWidth;
  };
  // Height only constrains a maximized figure. At rest the document owns
  // vertical scrolling and the screen box grows with the drawing, so its
  // height carries no budget to fit into; fitting to it there would shrink
  // every phone and tablet away from the true size they are drawn at.
  //
  // A maximized panel is the opposite: its height is fixed, and fitting only
  // the width means a short wide window scrolls the device out of view - the
  // reader opened the figure to see all of it at once, and instead gets a
  // scrollbar and a cut-off frame. Both axes have to fit, and the caption is
  // part of what has to stay visible.
  let scale = clampScale(widthScale);
  if (screen.closest("[data-figure-maximized]") === null) {
    paint(scale);
    return;
  }
  const verticalInset =
    Number.parseFloat(cardStyle.paddingTop) +
    Number.parseFloat(cardStyle.paddingBottom) +
    Number.parseFloat(cardStyle.borderTopWidth) +
    Number.parseFloat(cardStyle.borderBottomWidth);
  const screenVerticalPadding =
    Number.parseFloat(screenStyle.paddingTop) +
    Number.parseFloat(screenStyle.paddingBottom);
  for (let pass = 0; pass < maximumFitPasses; pass += 1) {
    paint(scale);
    let captionHeight = 0;
    if (caption !== null) {
      const captionStyle = getComputedStyle(caption);
      captionHeight =
        caption.getBoundingClientRect().height +
        Number.parseFloat(captionStyle.marginTop) +
        Number.parseFloat(captionStyle.marginBottom);
    }
    const heightScale =
      (screen.clientHeight -
        screenVerticalPadding -
        captionHeight -
        verticalInset) /
      frameHeight;
    const next = clampScale(Math.min(widthScale, heightScale));
    const settled = Math.abs(next - scale) < fitSettled;
    scale = next;
    if (settled) break;
  }
  paint(scale);
};
