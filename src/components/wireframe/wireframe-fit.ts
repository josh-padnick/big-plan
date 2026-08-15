// Scales one wireframe screen's device frame to fit the space its screen box
// offers: width alone at rest, both width and height once the screen sits
// inside a maximized figure, whose fixed viewport otherwise clips the frame
// or scrolls it out of view.
//
// Shared by the shell viewer script, which embeds this source as text
// through its own build step (see viewer-script.ts), and the review diff
// lens, which imports it directly - so a maximized wireframe fits the same
// whether shown in place or inside a Was/Now comparison.
export const fitWireframeScreen = (screen: HTMLElement): void => {
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
  // offsetWidth stays in the frame's unscaled coordinate space. Writing a
  // numeric zoom avoids relying on unsupported length division in CSS.
  frame.style.zoom = "1";
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
  const inset =
    Number.parseFloat(cardStyle.paddingLeft) +
    Number.parseFloat(cardStyle.paddingRight) +
    Number.parseFloat(cardStyle.borderLeftWidth) +
    Number.parseFloat(cardStyle.borderRightWidth);
  const widthScale =
    (screen.clientWidth - screenHorizontalPadding - inset) / frame.offsetWidth;
  // Height only constrains a maximized figure. At rest the document owns
  // vertical scrolling and the screen box grows with the drawing, so its
  // height carries no budget to fit into; fitting to it there would shrink
  // every phone and tablet away from the true size they are drawn at.
  //
  // A maximized panel is the opposite: its height is fixed, and fitting only
  // the width means a short wide window scrolls the device out of view - the
  // reader opened the figure to see all of it at once, and instead gets a
  // scrollbar and a cut-off frame. Both axes have to fit.
  let scale = Math.min(1, widthScale);
  if (screen.closest("[data-figure-maximized]") !== null) {
    const verticalInset =
      Number.parseFloat(cardStyle.paddingTop) +
      Number.parseFloat(cardStyle.paddingBottom) +
      Number.parseFloat(cardStyle.borderTopWidth) +
      Number.parseFloat(cardStyle.borderBottomWidth);
    // The caption is a block spanning the screen, so its height does not
    // depend on the scale being computed and one pass settles. A caption
    // pinned to the frame's painted width would reintroduce that
    // circularity and need to iterate.
    let captionHeight = 0;
    if (caption !== null) {
      const captionStyle = getComputedStyle(caption);
      captionHeight =
        caption.getBoundingClientRect().height +
        Number.parseFloat(captionStyle.marginTop) +
        Number.parseFloat(captionStyle.marginBottom);
    }
    const screenVerticalPadding =
      Number.parseFloat(screenStyle.paddingTop) +
      Number.parseFloat(screenStyle.paddingBottom);
    const heightScale =
      (screen.clientHeight -
        screenVerticalPadding -
        captionHeight -
        verticalInset) /
      frame.offsetHeight;
    scale = Math.min(scale, heightScale);
  }
  frame.style.zoom = String(scale);
};
