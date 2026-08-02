# Using Wireframe well

Draw product UI only when a reviewer must see a screen to judge the plan. Keep rationale outside the artboard, copy in attributes, fidelity rough, and prototypes to one two-or-three-screen path. `device` owns true width and frame: `desktop` may show `url`; `tablet` and `tablet-portrait` use native device frames; `phone` is one column with `TopBar` and `BottomBar`.

## CLEAR: the design front door

- **Clear job.** One screen advances one task; the primary action names that goal. Split choose, prepare, handoff, and approval into screens.
- **Layout follows attention.** One focal point leads through related groups to the next action. Use proximity, alignment, restrained boxes, three text tiers, and contrast—not equal visual weight.
- **Explicit change.** Selection visibly changes the outcome; reveal later information progressively; mark active, selected, disabled, error, and mode handoffs unmistakably.
- **Audience language.** Use concrete words, outcomes, and amounts the intended user says. Support the desired feeling; avoid technical, process, or abstract summary copy.
- **Real device.** Use the native shell and interaction model. Keep fidelity rough but alignment exact, affordances obvious, and decoration meaningful.

## Pass by device

| Device  | Pass when                                                                                                                                                                                                                                                | Reject                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop | Professional dense B2B workspace: flush full-height `Sidebar`, stable global nav, main canvas owns most width, primary surface about 60–75%, `Rail` about 300px. Settings use sub-nav plus one dense field column; create/edit is a route or real modal. | Equal thirds; floating tablet sidebar; two large settings cards; inflated chrome.           |
| Tablet  | Intentional iPad layout in a fixed 1180 × 820 or 820 × 1180 frame (about 1.44:1), with 44px controls, progressive steps, and card-like grouping only where useful.                                                                                       | Stretched bezel; browser `url`; compressed desktop density; desktop-like task flow.         |
| Phone   | Tall narrow native flow: compact `TopBar`, one column, 44px controls, 52–64px rows, bottom tabs, list → detail push, progressive disclosure.                                                                                                             | `AppShell`/`Sidebar`; side-by-side properties; vertical iPad; desktop copy squeezed narrow. |

## Contracts and blocking checks

Defaults own pane widths, fixed type roles, device frames, contrast, hover/focus paint, selection, and touch floors. Compilation blocks multiple `PageHeader`s, multiple primary work actions, equal desktop thirds, missing detail selection, boxed-region walls, and device-shell mismatches. Lint keeps process copy outside the artboard. Geometry tests fence pane width, overlap, dead bands, iPad ratio, shells, and touch targets.

## LOOP: prove it before delivery

1. **Look it up:** start from a proven native pattern.
2. **Open the render:** inspect every screen at declared size, light/dark, hover, focus, active, empty, disabled, and error.
3. **Object three times:** challenge each screen with CLEAR, fix three findings, and re-open it.
4. **Push the fix down:** when the interface allowed the defect, repair the primitive or diagnostic rather than one example.

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
