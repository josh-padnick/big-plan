# Using Wireframe well

Draw product UI only when a reviewer must see a screen to judge the plan. Keep rationale outside the artboard, copy in attributes, fidelity rough, and prototypes to one two-or-three-screen path. `device` owns true width and frame: `desktop` may show `url`; `tablet` and `tablet-portrait` use native device frames; `phone` is one column with `TopBar` and `BottomBar`.

## LOOP: make the design

1. **Look it up.** Name a proven pattern from Linear, GitHub, Notion, Stripe, Figma, iPadOS, or iOS before drawing.
2. **Open the render.** Inspect every screen at its declared device size, light and dark, including hover, focus, active, empty, disabled, and error states.
3. **Object three times.** Name three things a picky reviewer would flag on each screen, fix them, then present.
4. **Push the fix down.** When a defect is possible because of a primitive or default, fix that layer rather than one example.

## STAMP: judge the screen

- **Space:** primary work dominates. `Rail` is the only secondary-width primitive and wraps instead of squeezing. Authors never set pane widths.
- **Tiers:** page title, content, metadata; one primary work action. Navigation and mode selection are state, not extra actions.
- **Align:** one spacing rhythm, numeric columns right-aligned, two-line list rows, content-driven pane height.
- **Minimal boxes:** `Panel` is plain by default; use `filled` for a pane and `outlined` only for a card.
- **Plain state:** say state in words, reinforce it with tone, and mark selection with tint plus an inset edge.

## Pass by device

| Device  | Pass when                                                                                                                                                                                                                                                | Reject                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Desktop | Professional dense B2B workspace: flush full-height `Sidebar`, stable global nav, main canvas owns most width, primary surface about 60–75%, `Rail` about 300px. Settings use sub-nav plus one dense field column; create/edit is a route or real modal. | Equal thirds; floating tablet sidebar; two large settings cards; inflated chrome.              |
| Tablet  | Intentional iPad multi-column or master/detail at 4:3 or 3:4, with touch spacing and card-like grouping only where useful.                                                                                                                               | Browser `url`; compressed desktop density; very wide short strips; forced phone single-column. |
| Phone   | Tall narrow native flow: compact `TopBar`, one column, 44px controls, 52–64px rows, bottom tabs, list → detail push, progressive disclosure.                                                                                                             | `AppShell`/`Sidebar`; side-by-side properties; vertical iPad; desktop copy squeezed narrow.    |

## Establish hierarchy

1. One focal point. 2. Deliberate reading order. 3. Proximity shows relationships. 4. Groups map to user concepts. 5. The next action is obvious and outcome-named. 6. Language is tangible (`$27.50 to go`, not `61%`). 7. Terms match the user’s mental model. 8. Effects and relationships are explicit. 9. Weak signals recede. 10. Names and states stay consistent. 11. A five-second scan reveals purpose. 12. Decoration reinforces meaning. 13. The screen supports the intended feeling. 14. Fidelity stays as rough as the decision permits.

Before delivery ask: what lands first, what job is primary, what happens next, what belongs together, what is accidentally connected, what is too loud, what can sound more human, and can the screen be understood in five seconds?

## Six paste-ready patterns

Master-detail:

```mdx
<Screen id="record" name="Record" device="desktop" pattern="list-detail">
  <Panel title="Records">
    <List>
      <ListItem label="Selected record" selected />
    </List>
  </Panel>
  <Panel title="Detail">
    <Text text="Primary work" />
  </Panel>
</Screen>
```

Table + inspector:

````mdx
<Screen id="runs" name="Runs" device="desktop" pattern="list-detail">
  <Panel><Table selected="1">

```text
Run | State
#1042 | [Failed:danger]
```

  </Table></Panel>
  <Panel title="Inspector"><Text text="Failure details" /></Panel>
</Screen>
````

Settings:

```mdx
<Screen id="settings" name="Settings" device="desktop" pattern="settings">
  <Panel>
    <Nav>
      <NavItem label="Notifications" active />
    </Nav>
  </Panel>
  <Panel title="Notifications">
    <Switch label="Email alerts" on />
  </Panel>
</Screen>
```

Focused form:

```mdx
<Screen id="create" name="Create" device="tablet-portrait">
  <Center measure="prose">
    <Stack>
      <TextField label="Name" />
      <Button label="Create" emphasis="primary" />
    </Stack>
  </Center>
</Screen>
```

Canvas + inspector:

```mdx
<Screen id="canvas" name="Canvas" device="desktop">
  <Row>
    <Panel title="Canvas">
      <Text text="Primary workspace" />
    </Panel>
    <Rail>
      <Panel title="Inspector">
        <Select label="State" value="Ready" />
      </Panel>
    </Rail>
  </Row>
</Screen>
```

Phone list → detail:

```mdx
<Screen id="inbox" name="Inbox" device="phone">
  <Stack>
    <TopBar title="Inbox" />
    <List>
      <ListItem label="Checkout freeze" navigateTo="ticket" />
    </List>
    <BottomBar>
      <Button label="Inbox" emphasis="primary" />
    </BottomBar>
  </Stack>
</Screen>
<Screen id="ticket" name="Ticket" device="phone">
  <Stack>
    <TopBar title="Ticket">
      <Button label="‹ Inbox" navigateTo="inbox" />
    </TopBar>
    <Text text="Checkout freeze" />
    <BottomBar>
      <Button label="Inbox" emphasis="primary" navigateTo="inbox" />
    </BottomBar>
  </Stack>
</Screen>
```
