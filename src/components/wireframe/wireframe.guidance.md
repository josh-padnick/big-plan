# Using Wireframe well

Draw product UI only when a reviewer must see a screen to judge the plan. Keep rationale outside the artboard, product copy in attributes, and fidelity rough. Prototype the shortest path that proves the decision; an actor handoff may add separate handoff, authentication, and review screens because combining them would lie about the flow.

## CLEAR: the design front door

CLEAR is a grouping mechanism, not a five-line substitute for design judgment. Start with the five letters, then apply every relevant implementation principle beneath them.

## C · Clear job

Implementation principles:

- Give one screen one job and one step one decision. Split choosing, telling, checking, handing off, authenticating, reviewing, approving, and completing when each asks a different question.
- Make the page title name the user's present task, not the next step, a system state, or what another actor will do later.
- Make the primary action match the user's goal and describe its immediate result. Use `Check my request`, `Unlock to review`, or `See my wallet`, not vague `Continue`, premature `Approve`, or `Done`.
- In a sequential step, provide one nearby route back and one prominent route forward. Remove duplicate header links and footer buttons that do the same job. A branching choice may instead offer parallel alternatives.
- Close a learning or completion loop concretely: lead with the achievement, answer the original question, show specific evidence rather than unverified praise, state what remains true in the real world, and offer a purposeful next action.

Reject mixed jobs, titles that announce the future, primary actions that exit instead of advance, duplicate routes, redundant completion headlines, and receipt-like endings that never say what the user learned.

Compilation blocks multiple `PageHeader`s and multiple filled work actions. The title and button wording still require review.

## L · Layout follows attention

Implementation principles:

- Create one unmistakable focal point. Size, position, spacing, and contrast should answer what the user notices first.
- Make visual hierarchy follow decision hierarchy: primary question or work first, supporting facts second, next action last. Celebrate achievement before presenting quieter reassurance.
- Design a deliberate reading order. A focused flow should not require left-right-back scanning like desktop settings.
- Use proximity and spacing to make relationships explicit. Separate unrelated groups; place the explanation or outcome beside the selection that changes it.
- Group by user concepts, not by available data. Hierarchy should come from meaning, not a wall of containers.
- Keep parallel options parallel in grammar, visual weight, information depth, and target treatment so the layout does not bias one accidentally.
- Reserve the strongest border, fill, badge, type, and color for the most important content or action. Contrast must track importance.
- Optimize for scanning before reading. Headings, amounts, states, shapes, and actions should explain the screen in five seconds.
- Use decoration only to identify content, communicate state, reinforce the emotional goal, or explain an unfinished visual decision.

Reject equal-weight regions, card walls, floating metadata, unrelated adjacency, oversized empty panels, nonparallel choices, decoration that only fills space, and anything visually louder than its importance.

Defaults keep panels plain, derive dominant panes, and give secondary width to `Rail`. Compilation blocks equal desktop thirds and four-or-more outlined sibling panels; geometry tests block cramped panes, overlap, and manufactured dead bands.

## E · Explicit change

Implementation principles:

- Make selection visibly change the outcome. A selected row, card, or mode and its dependent preview must agree.
- Reveal information progressively. Show choices before their summary; show review before approval; do not expose later-stage detail before the user confirms the current step.
- Paint active, selected, pressed, disabled, error, done, current, and unavailable states unmistakably.
- Make progress communicate state: completed steps use completion marks, exactly one step is current, future steps are quiet, and labels contain tasks rather than duplicate numbers or checkmarks.
- Make causal relationships visible. If an action changes another area, show that result next to the action.
- Give actor and mode changes an unmistakable boundary: a new screen, actor-specific heading, simplified content, lock or equivalent state cue, and a visibly different treatment.
- Treat authentication as identity proof, never consent. The sequence is handoff → authenticate → review → approve or decline. `Unlock to review` cannot buy or approve anything.
- Protect the first actor's exit before handoff; after authentication begins, the next actor may enter a focused gate.

Reject generic summaries after a specific choice, faint selection, full summaries shown too early, ambiguous progress, a handoff used as a mere heading, mixed child/adult modes, and Face ID or PIN labeled as approval.

Compilation requires exactly one selected record beside visible detail, validates navigation targets, and blocks ambiguous Stepper state or authored duplicate numbering. State primitives own hover, focus, active, and selection paint.

## A · Audience language

Implementation principles:

- Use concrete words, outcomes, amounts, and time that match the audience's mental model: `$27.50 to go`, `two Friday payments left`, or `Nothing will be bought yet`.
- Use one term per concept and one label per destination. Do not alternate among choice, question, note, and request for the same object.
- Make one screen speak to one audience. When the actor changes, change the mode and heading before addressing the next person.
- Name what the current branch is about: a purchase request, a loan question, or help with something confusing—not a generic summary.
- Make reassurance name the actual risk and what remains unchanged: `Unlocking does not approve or buy anything`; `This was practice—no money moved`.
- Match labels to what the user would naturally say. Avoid internal, technical, adult-oriented, or agent-process language.
- Design for the emotional goal—capable, safe, motivated, informed, or in control—without hiding facts.
- Prefer specific feedback and a visual recap over unverified praise. Do not claim `You know how…` when the interface only observed practice.

Reject terminology drift, abstract labels such as `available` or `current loan` when plain language exists, mixed audiences, generic reassurance, branchless summaries, technical badges, and praise the product cannot verify.

Lint keeps agent-process copy outside the artboard; audience fit, term consistency, and risk wording require review.

## R · Real device

Cross-device principles:

- Each device is a native layout language, never a scaled version of another. Start from proven patterns: Linear/GitHub/Notion for desktop, iPadOS multi-column for tablet, and iOS conventions for phone.
- Keep hand-drawn warmth in strokes, grid, icons, and rough borders. Irregularity never belongs in alignment, spacing, reading order, contrast, information architecture, or target size.
- Keep three clear type roles—page title, content, metadata—with device-appropriate scale and legible contrast.
- Make interactive controls unmistakable through shape, state, hover, focus, and at least 44px touch targets on tablet and phone.

Desktop passes when it reads as dense professional B2B software: a flush, narrow, full-height `Sidebar`; stable global navigation; most width given to the canvas; a primary surface around 60–75%; secondary properties in a 240–320px-class `Rail`; tighter vertical rhythm; Linear-style settings with a settings sub-nav and one dense field column; create/edit as a route or true modal. Reject equal thirds, a sidebar taking a third of the canvas, floating tablet navigation, two large settings cards, inflated chrome, or oversized iPad sheets.

Tablet passes when it reads as intentional iPad software: fixed 1180 × 820 or 820 × 1180 frame (about 1.44:1) with internal overflow; native frame with no browser `url`; touch-first type and 44px controls; wider gutters; intentional master/detail or focused step flow; card-like grouping only where useful. Reject a stretched near-square bezel, compressed desktop density, browser chrome, squeezed desktop sidebars, tiny text, or a desktop task flow.

Phone passes when it reads as a tall narrow handset: 390 × 720 minimum; compact `TopBar`; one content column; 44px controls and 52–64px rows; primary destinations in `BottomBar`; fewer fields; progressive disclosure; list → detail push navigation. Reject `AppShell`/`Sidebar`, side-by-side properties, a vertical iPad, tablet cards with only the height changed, or desktop copy squeezed narrow.

Device presets own widths, fixed tablet ratio, shell availability, type roles, pane widths, touch floors, contrast, and state paint. Geometry tests fence true sizes, 1.39–1.44 tablet ratio, shells, pane floors, overlap, dead bands, and target sizes.

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
