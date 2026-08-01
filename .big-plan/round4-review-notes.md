# Round 4 picky-review pass

The final review used the regenerated `decision-component-variations.html`.
Screenshots live in `round4-shots/20260731-221617/`; every capture was written
to `/tmp/fm-bp-decision-round4/shots/`, checked for a nonempty file, then copied
into that directory.

## Variation A

1. **Option names could still blend into the criteria.** Fixed by moving option
   names to the established large text step and increasing the gap before the
   criterion block.
2. **Labels and values could still carry the same emphasis.** Fixed with
   semibold, colon-ended labels and normal-weight values.
3. **The fixed label column could clip values on phones.** Found in the 390px
   pass and fixed by stacking each value beneath its label below 36rem.

## Focus treatment

1. **The textarea could retain the captain-rejected double perimeter.** Fixed
   by removing the outline and combining an accent border shift with one
   low-opacity halo.
2. **Radio focus could replace one awkward rectangle with another around a
   whole row or column.** Fixed by keeping focus on the native circular control.
3. **Secondary controls could drift into unrelated focus styles.** Fixed by
   applying the same soft-halo language to the proposal link, comparison
   disclosure, confirm action, and change action; all document links were also
   tab-audited to confirm they did not combine an outline and shadow.

## Variation C

1. **The decider could still look attached to the first answer.** Fixed with
   its own full-width surface and a bottom rule before the radio rows.
2. **The framing sentence could feel vertically pinched.** Fixed with balanced
   block padding and the component's normal reading line-height.
3. **The new band could wrap poorly on a phone.** Verified at 390px in both
   themes; its sentence wraps without clipping or horizontal overflow.

## Component-model clarification

1. **"One component" could be mistaken for one rendered instance.** Fixed by
   saying the document contains three instances of the same component.
2. **The variations could remain unmapped to implementation.** Fixed by naming
   A as `layout="rows"`, B as `layout="matrix"`, and C as `layout="brief"`.
3. **The clarification could accidentally collapse Decision and
   ComplexDecision together.** Fixed by restating their separate jobs and
   identifying `ComparisonMatrix` as the shared internal primitive.
