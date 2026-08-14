# Using Wireframe well

Draw product UI only when a reviewer must see a screen to judge the plan. Keep rationale outside the artboard, product copy in attributes, and fidelity rough. Prototype the shortest path that proves the decision; an actor handoff may add separate handoff, authentication, and review screens because combining them would lie about the flow. CLEAR also governs review-surface interactions shown inside a wireframe: comments, decisions, diagrams, expanded modes, and toolbars must meet the same bar as the product flow around them.

## CLEAR: the design front door

CLEAR is a grouping mechanism, not a five-line substitute for design judgment. Start with the five letters, then apply every relevant implementation principle beneath them.

## C · Clear job

Implementation principles:

- Match interaction complexity to decision complexity before arranging the screen. Two to five simple alternatives use one dominant `ChoiceGroup` of large `ChoiceCard`s; record comparison may use list/detail; dense operational work may use a workspace. Never promote a small choice into a miniature workspace.
- Give one screen one job and one step one decision. Split choosing, telling, checking, handing off, authenticating, reviewing, approving, and completing when each asks a different question.
- Make the page title name the user's present task, not the next step, a system state, or what another actor will do later.
- Make every action and control label describe its immediate outcome. Use `Check my request`, `Unlock to review`, `Email assignees when tickets are assigned`, or `See my wallet`, not technology names, premature `Approve`, or `Done`; use `Continue` only when nearby context already makes the next result obvious.
- Keep next actions short once nearby context makes the outcome obvious: `Continue` or `Next: tell us about it` beats a sentence-sized button.
- In a sequential step, provide one nearby route back and one prominent route forward. Remove duplicate header links and footer buttons that do the same job. A branching choice may instead offer parallel alternatives.
- Let the heading ask the question once. Put reassurance or reversibility in the subtitle—`Choose one. You can change it later.`—instead of repeating the instruction in a panel title, helper, or button.
- Close a learning or completion loop concretely: lead with the achievement, answer the original question, show specific evidence rather than unverified praise, state what remains true in the real world, and offer a purposeful next action.
- Use one achievement headline. A completion badge is metadata, not a second headline. When the learned concept changes over time, reinforce memory with one compact visual sequence before the real-world reassurance.
- Make every persistent pane earn its width with a distinct, always-useful job; remove or collapse any pane that merely repeats another. A choice detail exists only for genuine reassurance or consequence that does not fit naturally inside the selected card, and it stays beneath the choice instead of becoming a second column.
- Give a collection and its preview different jobs: the list supports rapid comparison through stable attribute positions, while the preview supports rapid judgment with urgency, context, recommendation, and a clear route into the work.
- Reveal inspectors progressively: keep core properties visible; collapse Related, Activity, and Customer detail until needed.
- In create/edit flows, group entered facts in the primary column and all routing metadata in one secondary group. Show duplicate suggestions only when results exist, preserve the draft while reviewing a match, validate required fields inline, and warn or save a draft on Cancel.
- Give every opened surface a visible way out. A proposal form, expanded figure, thread, dialog, drawer, or temporary mode needs Cancel, Close, Escape, or an equally clear return path.
- Give each review action one owner. Whole-screen comments belong to the screen or slide; element comments belong to selected elements in the expanded mode. Do not add a second floating whole-figure action that competes with the owner.
- State whether visual variations configure one component or represent different components. One concept gets one named owner; presentation experiments must not make the product model ambiguous.

Reject a simple choice drawn as list/detail, mixed jobs, titles that announce the future, repeated instructions, sentence-sized next buttons, primary actions that exit instead of advance, duplicate routes, unearned detail panes, redundant panes, doubled completion headlines, receipt-like endings that never say what the user learned, inescapable temporary surfaces, duplicate comment routes, ambiguous component ownership, and list/preview pairs that repeat the same facts.

Compilation blocks multiple `PageHeader`s and multiple filled work actions. The title and button wording still require review.

## L · Layout follows attention

Implementation principles:

- Create one unmistakable focal point. Size, position, spacing, and contrast should answer what the user notices first.
- Make visual hierarchy follow decision hierarchy: primary question or work first, supporting facts second, next action last. Celebrate achievement before presenting quieter reassurance.
- For a small tablet decision, make the decision itself the dominant visual and touch surface: one centered column of complete option cards, never a left list competing with a right inspector.
- Make the primary workspace surface visibly dominant. A conversation, canvas, or editor gets the most width, breathing room, and contrast; navigation, lists, and inspectors stay subordinate.
- Design a deliberate reading order. A focused flow should not require left-right-back scanning like desktop settings.
- Use proximity and spacing to make relationships explicit. Separate unrelated groups; place the explanation or outcome beside the selection that changes it.
- Group by user concepts, not by available data. Hierarchy should come from meaning, not a wall of containers.
- Nest a dependent control directly beneath its parent in one shared group; never make a channel, time, or other dependency look like an unrelated peer section.
- Keep parallel options parallel in grammar, visual weight, information depth, and target treatment so the layout does not bias one accidentally.
- Make a touch option look touchable across its whole surface: complete border or fill, comfortable padding, hand-drawn identifying icon, title, one-line consequence, and a clear state target. Do not make a thin row edge carry the interaction alone.
- Inside an option, make the option name a distinct title, then place a rule before its criteria. Criterion labels are smaller than the option name, bold, and end with `:`; values remain regular weight.
- Keep comparison labels readable at their longest realistic value. Widen or break out the matrix, abbreviate with a nearby legend, or choose another explicit composition before allowing one-word-per-line headers. Center collapsed row actions on both axes.
- Set a one-sentence definition apart from answer rows with breathing room and a consistent dashed-underline definition affordance; it must read as framing help, never as another option.
- Reserve the strongest border, fill, badge, type, and color for the most important content or action. Contrast must track importance.
- Give facts, recommendations, and side effects distinct visual treatments. Entered values, suggested values with provenance, and consequences at the final action must never look interchangeable.
- Float comment input, submitted cards, and outcome chips in a quiet right-side gutter aligned with their anchor. Submitted cards show author, time, and body. The source highlight supplies context, so the card does not repeat the selected text or a long block path. Collapse long bodies behind `… more`.
- Separate the Comments panel from content with a top border; keep its staged, submitted, and resolved items in one scannable lifecycle rather than accumulating undifferentiated cards.
- Never draw a highlight border through glyphs. Use padding, background, underline, or an outside marker so comment presence is obvious without obscuring the source.
- Toolbars own viewer actions. Put note submission, counts, zoom, Fit, and maximize in stable toolbar positions; keep the primary tray action inside the tray footer and distinguish the tray header from its content. Never float a detached action over the canvas.
- Make operational lists scan in stable rows—title and time, person and organization, state and identifier—and distinguish customer, agent, and internal messages with a consistent rail, avatar/icon, or surface. Keep unread, priority, assignment, waiting, selection, and open state visually separable.
- Use one compact sticky inbox toolbar for search, filter count, and sort, with active chips directly beneath it. Show the result count once, reduce create-action prominence during triage, and add bulk controls only when real batching exists.
- Controls already size to their values by default: a `Select` or single-line `TextField` never fills its column, and a `date`/`number` field draws even narrower. There is no per-control override; use `TextArea` for anything that genuinely needs more room. Desktop content outside a workspace row also defaults to a readable measure, matching `Center`'s own default, so a lone `Panel`, `Stack`, `TextField`, or `Select` placed directly on the canvas never stretches full width on its own. `PageHeader` stays full width as banner chrome; a `List`, a `Table`, or a `Panel` wrapping one reads wide as a record collection; and a `Row` with more than one child (or a `Panel`/`Stack` wrapping one, such as a command bar) already made its own width decision and is left alone. Give content that legitimately wants the full artboard a `Row` or `Center measure="wide"` instead of a bare `Stack` or `Panel`.
- On a sparse tablet flow, use the available canvas through larger type, taller cards, generous but grouped spacing, and decisive contrast. Quiet graph paper behind the interactive region with a light surface; never shrink a desktop form and float it in the iPad.
- Optimize for scanning before reading. Headings, amounts, states, shapes, and actions should explain the screen in five seconds.
- Use decoration only to identify content, communicate state, reinforce the emotional goal, or explain an unfinished visual decision.

Reject equal-weight regions, a simple tablet choice split into columns, thin-line pseudo-selection, graph paper louder than the decision, a shrunken desktop form floating in an iPad, four squeezed full-screen panes, card walls, floating metadata or actions, cramped comparison headers, criteria styled like option titles, definitions that read as answers, comment borders crossing text, repeated anchored context, detached tray actions, unrelated dependencies, recommendation/value ambiguity, oversized empty panels, nonparallel choices, decorative filler, and anything visually louder than its importance.

Defaults keep panels plain, derive dominant panes, and give secondary width to `Rail`. Compilation blocks equal desktop thirds and four-or-more outlined sibling panels; geometry tests block cramped panes, overlap, and manufactured dead bands.

## E · Explicit change

Implementation principles:

- Make selection visibly change the outcome. A selected row, card, or mode and its dependent preview must agree.
- Give every unselected `ChoiceCard` its own selected-state destination. That screen must select the same title and consequence, so two options can never pretend to differ while routing to one generic outcome.
- Never preselect a consequential `ChoiceCard` on the initial decision screen. Start unselected; a deliberate tap reveals the selected state and only then reveals or enables the continuation area.
- Make selected touch state unmistakable with several signals together: filled radio, stronger border, changed background, and checkmark or equally explicit mark. Never rely on tint or a thin left line alone.
- Reveal information progressively. Show choices before their summary; show review before approval; do not expose later-stage detail before the user confirms the current step.
- Paint active, selected, pressed, disabled, error, done, current, and unavailable states unmistakably.
- Make progress communicate state: completed steps use completion marks, exactly one step is current, future steps are quiet, and labels contain tasks rather than duplicate numbers or checkmarks.
- Make causal relationships visible. If an action changes another area, show that result next to the action.
- Give actor and mode changes an unmistakable boundary: a new screen, actor-specific heading, simplified content, lock or equivalent state cue, and a visibly different treatment.
- Treat authentication as identity proof, never consent. The sequence is handoff → authenticate → review → approve or decline. `Unlock to review` cannot buy or approve anything.
- Protect the first actor's exit before handoff; after authentication begins, the next actor may enter a focused gate.
- Make a dangerous mode switch change several signals together. Reply versus internal note changes the selected segment, composer surface and border, icon or heading, placeholder, final action, and persistent visibility warning.
- Give each piece of state one clear owner. A shortcut and a property may synchronize explicitly, but two apparently independent controls must not claim the same status.
- Keep a recommendation labeled with its evidence until the user accepts or changes it; only then may it become an ordinary saved value.
- Before a setting changes, show its scope, outcome, current state, and any dependency. Separate workspace from personal settings and say who is affected.
- Make persistence observable: `Saving…` becomes `Saved`, consequential auto-saves offer undo, explicit-save screens show the unsaved count and post-save confirmation, and navigation cannot silently discard work.
- Make comment presence obvious at its exact anchor in inline and expanded modes. A right-gutter marker selects that same anchor and enters the same creation flow as a text selection.
- Any nonempty text selection—up to a whole paragraph—shows one compact icon-plus-`Comment` affordance, not a formatting toolbar. It disappears as soon as selection or hover ends; passive scrolling never leaves orphaned buttons or sprays element affordances across the page.
- Show the whole comment lifecycle. Staged comments navigate back to their targets; submitted threads collapse to one-line outcome chips after a response, expand in place, use the reply box as the per-comment chat, and keep plan-wide chat in the Chat surface.
- Keep edit and remove easy to find on the author's own comment; confirmation belongs immediately before removal.
- Make counts live and labels unconfusable. Update after create, edit, delete, submit, and response; keep only a precise persistent signal such as `Needs your answer 2`, never an ambiguous or stale `Comments 2` alert.
- Confirm destructive actions with alert-dialog semantics immediately before they execute. Deleting authored content in an edit review remains visible as a struck-through diff; it never disappears silently.
- Use idiomatic focus paint: a border-color shift plus a soft low-opacity halo, not a thick double perimeter. When a dialog or expanded mode closes, move focus to a sensible container or prior control rather than stranding it on the exit trigger.
- Preserve context across mode changes. Entering or exiting maximize, a drawer, or a comment mode keeps the document scroll position, selected target, active screen, and relevant internal scroll.
- Render controls only when their state and anchor are valid. No unexplained dot, empty pill, or footer hover line may appear on load; fix the state cause rather than hiding it after a delay.
- Distinguish selection from opening. Selection uses background plus an outside indicator; unread and priority keep different signals; Enter or a clearly labeled preview route opens the record.
- Make required-field errors appear beside the field before submission. Specific notification consent names the person and address and is never silently enabled. Cancel preserves a draft or warns before loss.
- Settings show visible `On`/`Off` text in addition to switch position and contrast. Keep dependent controls visible-but-disabled under their parent, show integration readiness (`Connected` or `Connect Slack`), and offer a safe test action when the result cannot otherwise be verified.

Reject preselected consequential choices, premature continuation, generic summaries after a specific choice, faint or single-signal selection, full summaries shown too early, ambiguous progress, single-signal dangerous modes, duplicate state owners, invisible comment anchors, comment clutter, highlights that cover text, stale counts, ambiguous alerts, unconfirmed deletion, silent destructive edits, awkward focus rings, stranded focus, lost scroll or selection, invalid load-state controls, unlabeled recommendations, silent persistence, scope-free settings, a heading-only handoff, mixed child/adult modes, and Face ID or PIN labeled as approval.

Compilation requires exactly one selected record beside visible detail, validates navigation targets, requires every unselected `ChoiceCard` to reveal its own matching selected outcome, and blocks ambiguous Stepper state or authored duplicate numbering. State primitives own hover, focus, active, and selection paint.

## A · Audience language

Implementation principles:

- Use concrete words, outcomes, amounts, and time that match the audience's mental model: `$27.50 to go`, `two Friday payments left`, or `Nothing will be bought yet`.
- Use one term per concept and one label per destination. Do not alternate among choice, question, note, and request for the same object.
- Preserve the user's words after selection. `Ask about a purchase` remains `You chose: Ask about a purchase`; do not rename it `Purchase request` before a request exists.
- Make one screen speak to one audience. When the actor changes, change the mode and heading before addressing the next person.
- Name what the current branch is about: a purchase, a loan question, or something confusing—not a generic summary or a request that does not exist yet.
- Make reassurance name the actual risk and what remains unchanged: `Unlocking does not approve or buy anything`; `This was practice—no money moved`.
- Keep saved views and filters semantically separate. Views are reusable queues such as `All`, `Mine`, and `Unassigned`; filters are temporary constraints such as `Waiting ×`, `SLA risk ×`, and `+ Add filter`.
- Prefer time-to-act over arithmetic: `First response due in 4m`, `Breached by 6m`, or `Waiting 2h`, never a reviewer-calculated elapsed/target pair. Never rely on color alone.
- Let the anchor carry comment context. Use the slide or screen title for the thread title and keep the highlighted source visible; do not repeat a paragraph excerpt or internal block path in the card.
- Separate person from organization, or present a combined identity that names both. A side effect such as email consent names the person, destination, and triggering event.
- Group settings by event or user goal, not technology. Keep daily/digest wording consistent, state delivery time and timezone, and explain who integration-dependent behavior reaches.
- Name stateful toggles and alerts by the current, live outcome: `Show comments`, `Hide comments`, or `Needs your answer 2`. A count and label must change together and must not make a panel toggle look like an ordinary action.
- Keep definitions to one plain sentence behind the same dashed-underline affordance everywhere. The words explain the term; the treatment signals that help is available.
- Match labels to what the user would naturally say. Avoid internal, technical, adult-oriented, or agent-process language.
- Prefer natural outcome copy: `See how much money I would have left` beats `See what money stays in my wallet`.
- Keep identity and escape visible in a quiet tablet header, such as `Eddy's Wallet` and `Back to my wallet`, so a child always knows whose space this is and can leave the flow.
- Design for the emotional goal—capable, safe, motivated, informed, or in control—without hiding facts.
- Prefer specific feedback and a visual recap over unverified praise. Do not claim `You know how…` when the interface only observed practice.

Reject terminology drift after selection, calling an unsubmitted choice a request, unnatural outcome copy, trapped flows without identity or escape, abstract labels such as `available` or `current loan` when plain language exists, mixed audiences, generic reassurance, branchless summaries, repeated comment excerpts or block paths, stale or ambiguous count labels, ordinary-action styling for state toggles, inconsistent definition treatments, technical badges, and praise the product cannot verify.

Lint keeps agent-process copy outside the artboard; audience fit, term consistency, and risk wording require review.

## R · Real device

Cross-device principles:

- Each device is a native layout language, never a scaled version of another. Start from proven patterns: Linear/GitHub/Notion for desktop, iPadOS multi-column for tablet, and iOS conventions for phone.
- Keep hand-drawn warmth in strokes, grid, icons, and rough borders. Irregularity never belongs in alignment, spacing, reading order, contrast, information architecture, or target size.
- Keep three clear type roles—page title, content, metadata—with device-appropriate scale and legible contrast.
- Make interactive controls unmistakable through shape, state, hover, focus, and at least 44px touch targets on tablet and phone.
- In an expanded multi-screen viewer, show screen names as a vertical list on the left and let arrow keys move through that list. The active screen stays visible while the user changes screens.
- Enter expanded mode fit-to-viewport and centered on both axes; support zooming below 100%. Comment and selection markers keep a fixed readable screen size under zoom, like Figma, rather than shrinking or distorting with canvas content.
- Reserve element-level commenting for expanded mode: select an element, then comment. Inline viewing keeps one calm whole-screen comment area and never turns ordinary scrolling into a field of transient controls.
- Keep the expanded toolbar stable between modes. The `Add N notes to plan feedback` action stays flush left, appears inline and expanded, and never overlaps the live note count.

Desktop passes when it reads as dense professional B2B software: the application fits its viewport with no app-wide horizontal scroll; flexible minmax-style columns let the primary surface absorb remaining width; a flush 64–180px navigation rail, 280–320px list, dominant primary surface, and 280–320px inspector stay in one row; persistent panes scroll independently at viewport height while the ticket header and composer remain anchored; narrower widths collapse navigation, then the inspector, before they overflow. It also keeps tighter vertical rhythm, Linear-style settings with a settings sub-nav and one dense field column, create/edit as a route or true modal, and keyboard shortcuts for list movement, search focus, open, compose, mode switch, send, assign, and resolve that supplement visible controls. Reject equal thirds, whole-page scrolling while answering, horizontal app scrolling, four squeezed full-screen panes, a sidebar taking a third of the canvas, floating tablet navigation, two large settings cards, inflated chrome, or oversized iPad sheets.

Tablet passes when it reads as intentional iPad software: fixed 1020 × 720 landscape or 820 × 1180 portrait frame (about 1.44:1), laid out to fit that frame with no internal scroll; native frame with no browser `url`; quiet identity/escape header; touch-first type and 44px controls; wider gutters; and a composition chosen by decision complexity. Two to five simple alternatives use a dominant centered `ChoiceGroup` of tall `ChoiceCard`s with no initial selection and explicit continuation after tap. Master/detail is reserved for a genuine collection whose persistent detail adds useful context. The interaction region quiets the grid rather than shrinking its contents. A fixed-frame screen (tablet or tablet-portrait) must lay out entirely within its declared artboard; an internal scrollbar is a layout defect to fix, not a scroll affordance to keep. Reject a simple decision as list/detail or `Rail`, preselection, faint row selection, a stretched near-square bezel, compressed desktop density, browser chrome, squeezed desktop sidebars, tiny text, a desktop task flow, or content that needs an internal scrollbar to fit its fixed frame.

Phone passes when it reads as a tall narrow handset: 390 × 720 minimum; compact `TopBar`; one content column; 44px controls and 52–64px rows; primary destinations in `BottomBar`; fewer fields; progressive disclosure; list → detail push navigation. Reject `AppShell`/`Sidebar`, side-by-side properties, a vertical iPad, tablet cards with only the height changed, or desktop copy squeezed narrow.

Device presets own widths, fixed tablet ratio, shell availability, type roles, flexible pane widths, independent workspace overflow, anchored conversation chrome, touch floors, contrast, and state paint. `ChoiceGroup`/`ChoiceCard` own simple-decision dominance, touch surfaces, and multi-signal selection; compilation blocks initial preselection, premature continuation, nonmatching option outcomes, and tablet choice groups beside competing columns. The Wireframe viewer owns screen switching, an automatic width-only shrink-to-fit, the shared figure maximize contract, and an expanded left screen rail with arrow-key sequencing, toolbar placement, focus return, and scroll preservation; fit-to-viewport centered expansion, below-100% zoom, and fixed-screen-size markers remain standards you must draw inside the artboard, not reader controls the viewer supplies. Geometry tests fence true sizes, app-wide overflow, primary dominance, independent panes, anchored header/composer, 1.39–1.44 tablet ratio, shells, pane floors, overlap, unjustified dead bands, and target sizes.

## LOOP: prove it before delivery

1. **Look it up:** start from a proven native pattern.
2. **Open the render:** inspect every screen at declared size, light/dark, hover, focus, active, empty, disabled, and error.
3. **Object three times:** challenge each screen with CLEAR, fix three findings, and re-open it.
4. **Probe every lifecycle:** have a fresh reviewer adversarially select whole and partial text, add/view/edit/delete/submit/revisit comments, enter/exit expanded modes, zoom in/out, change screens, and verify focus, scroll, markers, counts, labels, and escape routes. Incorporate confirmed findings before presentation.
5. **Push the fix down:** when the interface allowed the defect, repair the primitive or diagnostic rather than one example.

## Seven paste-ready patterns

Simple tablet choice:

```mdx
<Screen id="choose" name="Choose" device="tablet">
  <Stack>
    <TopBar title="Eddy's Wallet">
      <Button label="Back to my wallet" emphasis="tertiary" />
    </TopBar>
    <Center measure="wide">
      <PageHeader
        title="What do you want help with?"
        description="Tap one. You can change it later."
      />
      <ChoiceGroup>
        <ChoiceCard
          icon="⚽"
          title="Ask about a purchase"
          description="See how much money I would have left"
          navigateTo="purchase-selected"
        />
        <ChoiceCard
          icon="💵"
          title="Ask about my loan"
          description="See what I owe and ask a question"
          navigateTo="loan-selected"
        />
      </ChoiceGroup>
    </Center>
  </Stack>
</Screen>
<Screen id="purchase-selected" name="Purchase selected" device="tablet">
  <Stack>
    <TopBar title="Eddy's Wallet">
      <Button label="Back to my wallet" emphasis="tertiary" />
    </TopBar>
    <Center measure="wide">
      <PageHeader
        title="What do you want help with?"
        description="You can change your choice."
      />
      <ChoiceGroup>
        <ChoiceCard
          icon="⚽"
          title="Ask about a purchase"
          description="See how much money I would have left"
          selected
        />
        <ChoiceCard
          icon="💵"
          title="Ask about my loan"
          description="See what I owe and ask a question"
          navigateTo="loan-selected"
        />
      </ChoiceGroup>
      <Text
        text="Next, tell us the item and price. Nothing will be bought yet."
        role="helper"
      />
      <Button label="Continue" emphasis="primary" navigateTo="tell-us" />
    </Center>
  </Stack>
</Screen>
<Screen id="loan-selected" name="Loan selected" device="tablet">
  <Stack>
    <TopBar title="Eddy's Wallet">
      <Button label="Back to my wallet" emphasis="tertiary" />
    </TopBar>
    <Center measure="wide">
      <PageHeader
        title="What do you want help with?"
        description="You can change your choice."
      />
      <ChoiceGroup>
        <ChoiceCard
          icon="⚽"
          title="Ask about a purchase"
          description="See how much money I would have left"
          navigateTo="purchase-selected"
        />
        <ChoiceCard
          icon="💵"
          title="Ask about my loan"
          description="See what I owe and ask a question"
          selected
        />
      </ChoiceGroup>
      <Text
        text="Next, tell us your loan question. Your balance will not change."
        role="helper"
      />
      <Button label="Continue" emphasis="primary" navigateTo="loan-question" />
    </Center>
  </Stack>
</Screen>
<Screen id="tell-us" name="Tell us" device="tablet">
  <Stack>
    <TopBar title="Eddy's Wallet">
      <Button label="Back to my wallet" emphasis="tertiary" />
    </TopBar>
    <Center measure="prose">
      <PageHeader title="Tell us about the purchase" />
      <TextField label="Item" />
    </Center>
  </Stack>
</Screen>
<Screen id="loan-question" name="Loan question" device="tablet">
  <Stack>
    <TopBar title="Eddy's Wallet">
      <Button label="Back to my wallet" emphasis="tertiary" />
    </TopBar>
    <Center measure="prose">
      <PageHeader title="What do you want to know about your loan?" />
      <TextArea label="My loan question" placeholder="I want to know…" />
    </Center>
  </Stack>
</Screen>
```

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
