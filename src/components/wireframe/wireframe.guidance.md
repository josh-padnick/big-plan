# Using Wireframe well

A hand-drawn sketch of a product screen, drawn from a fixed vocabulary so a reviewer argues about the design rather than about the pixels.

- Reach for a wireframe when the reviewer must picture a screen to judge the plan; describe anything they can already picture in prose.
- Deliberately low fidelity is the point. Draw the regions, the copy that carries meaning, and the actions - not the polish.
- Every screen needs `id` and `name`. Add a second `Screen` and a `Button` with `navigateTo` to turn a sketch into a walkable prototype, and keep prototypes short: two or three screens along one path.
- All copy is written as attributes: `<Text text="..." />`, `<Metric label="..." value="..." />`, `<Button label="..." />`. A wireframe holds no prose, and the explanation belongs in the paragraphs around it.
- Pick the `viewport` the design is really for. The artboard reflows to the reader's width instead of shrinking the text, so the preset sets the shape rather than the final size.
- Say what kind of product this is with `chrome`. A web product uses `chrome="browser"` and a `url`, which tells a reviewer the route before they read a label; a phone screen uses `chrome="phone"`. An unframed screen floats on the page and reads as a tablet app whatever is inside it, so frame every screen of a real product and keep the frame the same across the prototype.

The vocabulary, by what it is for:

- **Frame** - `AppShell` holds `Sidebar`, an optional `TopBar`, and `AppContent`. Reach for it whenever the screen sits inside a product, and skip it for a single focused page.
- **Layout** - `Stack` runs down, `Row` runs across. Panels in a `Row` share the width; buttons and copy keep their own size.
- **Regions** - `Panel` bounds a region, `PageHeader` says what the page is once at the top.
- **Content** - `Metric` for the number a screen exists to show, `Progress` for how far along something is, `List` and `ListItem` for repeated rows, `Text`, `Heading`, `Badge`, `Divider`, and `ImagePlaceholder` for art nobody has drawn yet.
- **Navigation** - `Nav` and `NavItem`, with `active` on the current destination. A `NavItem` takes `navigateTo` just like a button.
- **Forms** - `TextField`, `TextArea`, `Select`, `Checkbox`, and `Switch` draw as the real controls. Every one needs a `label`; an unlabelled box has not decided what the field is for.
- **Flow** - `Stepper` and `Step` show where the user is in a multi-step create flow; `Connector` is the arrow between two steps on a canvas, labeled with the condition that follows it.

```mdx
<Wireframe id="eddys-wallet" title="Eddy's wallet" initialScreen="home">
  <Screen
    id="home"
    name="Child wallet home"
    viewport="tablet-landscape"
    chrome="browser"
    url="app.example.dev/wallet"
  >
    <AppShell>
      <Sidebar brand="Eddy's Wallet" mode="Child mode">
        <Nav label="Main">
          <NavItem label="My wallet" active />
          <NavItem label="Learn" navigateTo="lesson" />
        </Nav>
      </Sidebar>
      <AppContent>
        <PageHeader title="Hi, Eddy!" badge="Read only" />
        <Row gap="md">
          <Panel title="Your balance">
            <Metric label="Available now" value="$42.50" />
            <Progress
              label="Headphones goal"
              value="61"
              detail="$42.50 of $70"
            />
          </Panel>
          <Panel title="Next lesson">
            <Text text="Borrow now, repay later" />
            <Button
              label="Start lesson"
              emphasis="primary"
              navigateTo="lesson"
            />
          </Panel>
        </Row>
      </AppContent>
    </AppShell>
  </Screen>
  <Screen id="lesson" name="Loan lesson" viewport="tablet-landscape">
    <Panel title="Borrow now, repay later">
      <Text text="Someone helps you buy something now." />
      <Button label="Back to my wallet" navigateTo="home" />
    </Panel>
  </Screen>
</Wireframe>
```
