# Using Wireframe well

A hand-drawn sketch of a product screen, drawn from a fixed vocabulary so a reviewer argues about the design rather than about the pixels.

- Reach for a wireframe when the reviewer must picture a screen to judge the plan; describe anything they can already picture in prose.
- Deliberately low fidelity is the point. Draw the regions, the copy that carries meaning, and the actions - not the polish.
- Every screen needs `id` and `name`. Add a second `Screen` and a `Button` with `navigateTo` to turn a sketch into a walkable prototype, and keep prototypes short: two or three screens along one path.
- All copy is written as attributes: `<Text text="..." />`, `<Heading text="..." />`, `<Button label="..." />`. A wireframe holds no prose, and the explanation belongs in the paragraphs around it.
- Elements nest freely. `Stack` runs down the screen, `Row` runs across it, and `Panel` bounds a region. Panels inside a `Row` share the width; buttons and copy keep their own size.
- Pick the `viewport` the design is really for. The artboard reflows to the reader's width instead of shrinking the text, so the preset sets the shape rather than the final size.

```mdx
<Wireframe id="eddys-wallet" title="Eddy's wallet" initialScreen="home">
  <Screen id="home" name="Child wallet home" viewport="tablet-landscape">
    <Heading text="Hi, Eddy!" />
    <Row gap="md">
      <Panel title="Your balance">
        <Text text="$42.50" />
        <Text text="$27.50 to go on the headphones goal" role="helper" />
      </Panel>
      <Panel title="Next lesson">
        <Text text="Borrow now, repay later" />
        <Button label="Start lesson" emphasis="primary" navigateTo="lesson" />
      </Panel>
    </Row>
  </Screen>
  <Screen id="lesson" name="Loan lesson" viewport="tablet-landscape">
    <Panel title="Borrow now, repay later">
      <Text text="Someone helps you buy something now." />
      <Button label="Back to my wallet" navigateTo="home" />
    </Panel>
  </Screen>
</Wireframe>
```
