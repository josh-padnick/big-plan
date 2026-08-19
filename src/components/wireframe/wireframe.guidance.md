# Using Wireframe well

Draw product UI only when a reviewer must see a screen to judge the plan. Keep rationale outside the artboard, product copy in attributes, and fidelity rough. Prototype the shortest path that proves the decision; an actor handoff may add separate handoff, authentication, and review screens because combining them would lie about the flow. CLEAR also governs review-surface interactions shown inside a wireframe: comments, decisions, diagrams, expanded modes, and toolbars must meet the same bar as the product flow around them.

## The envelope is fixed

A wireframe is laid out at its device's true size and then scaled as one unit into the review document's figure slot. That slot never widens. The reading column shares its width with the reader's table of contents, and no drawing is worth taking a reader's navigation away, so **a wide figure does not exist**. Desktop, tablet, and phone are the three envelopes and there is no wider variant of any of them.

What follows, and none of it is optional:

- **The screen yields; the review chrome never does.** A screen that does not fit is a screen to simplify: drop a column, split it into two screens, or disclose progressively. Nothing you can author makes the drawing bigger.
- **Column budget per Row: desktop 3, landscape tablet 3, portrait tablet 2, phone 1.** Three desktop columns means collection, primary surface, and inspector. A fourth column can only come out of the primary surface, which is the one that had to stay dominant. Lint reports a Row past its budget.
- **Painted size is the only size that counts.** A desktop artboard is painted at roughly five-eighths of its declared size, so desktop type is drawn deliberately larger than the real product's and desktop density deliberately lower. Judge every screen at its rendered size, never in the source.
- **Maximize is a reading aid, not a design target.** A screen that only works maximized does not work.

## Visual fundamentals

CLEAR says what to decide. These say how any of those decisions is executed. Two ideas cover most of what makes a drawing look amateur: the four CRAP principles (Robin Williams, _The Non-Designer's Design Book_) and information hierarchy.

### Contrast, repetition, alignment, proximity

- **Contrast - if two things are not the same, make them obviously different.** Almost-the-same is the failure, and it is the most common one: a group title a fifth of a step above the rows under it, a primary action one shade from its neighbour, two panes of near-equal width where one holds the work and one holds metadata. The test is not "is there a difference" but "would a reader see it without comparing". Two things that differ should differ on **two axes at once** - size and weight, or size and case, or weight and colour - because a single axis at a small step reads as an accident. Here: `emphasis="primary"` on the one action that advances the job and `tertiary` on the way out; `surface="outlined"` only where something behaves like a card; the widest pane for the primary surface; and the type ramp's own steps, which are fenced apart by a test so no two roles can drift into looking alike.
- **Repetition - repeat one visual decision until the screen reads as one system.** The same status mark for the same state, the same weight for every secondary action, the same gap for every peer group, the same pane order on every screen of a flow. A screen where each region solved spacing its own way reads as unfinished even when every region is fine alone.
- **Alignment - nothing is placed arbitrarily; everything lines up with something.** Readers follow invisible edges: label left edges, value right edges, the baseline a row shares. `Stack` and `Row` with a `gap` token do the aligning for you, so an element that seems to need nudging is a sign the grouping is wrong, not the spacing.
- **Proximity - what belongs together sits together, and what does not, does not.** Space is the primary grouping tool; a box is the last one. A field and its hint sit tighter than two field groups do; a heading sits tighter to its group than to the group above. Change a `gap` before reaching for `surface="outlined"`, because a box around everything groups nothing.

The common failure is all four drawn flat: sizes close, weights close, gaps equal, every region boxed. That reads as a wall no matter how correct the content is.

### Information hierarchy

Rank before drawing:

1. **One job per screen.** Everything else supports it.
2. **Four levels, each a visible step apart** - page title, section title, content, metadata. Nothing beyond four: a fifth level is one a reader cannot reliably separate at drawing scale. The ramp already holds these apart (a title is at least a quarter larger than content, a page title a fifth larger again), and a group label nested inside a card steps _down_ into the quiet uppercase label vocabulary rather than competing with the title above it. Do not hand-tune sizes to fake a level; pick the role and let the ramp size it.
3. **One entry point.** Where the eye lands first (top-left in a left-to-right reading order) and the highest-contrast element on the screen should be the same place.
4. **One reading path.** Down a column beats across three.
5. **The action last**, where the path ends rather than where there was room.

Then test the drawing against the ranking: what you ranked first should win on size, weight, position, and surrounding space at once. One signal is a suggestion; several agreeing is a hierarchy.

Chunk before ranking. Seven undifferentiated rows are a wall; three labelled groups of two or three are a structure a reviewer can hold. Group by the reader's concepts, and let each group's label say what the group is for. Where a group reports a state - finished, needs you, waiting, blocked - say it with `status` on the group's `Panel` and on the rows inside it, so the answer is visible before a single line is read.

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
- Draw a surface that sits above the page as an `Overlay`, never as one more panel in the column. A confirmation or dialog authored as page content tells the reviewer that the page underneath is still available when it is not, which is exactly the fact the drawing existed to settle. `backdrop="dim"` says the page is unavailable until this surface is answered; `backdrop="clear"` says the reader may still see and use it. An overlay centers over the page it covers, so it draws a dialog, a confirmation, or a sheet; a control anchored to one row or one button belongs in the page beside that anchor.
- Show one moment per screen. An overlay and the page beneath it are one moment; a second overlay is a second `Screen`, and so is the state after the overlay is answered.
- Give each review action one owner. Whole-screen comments belong to the screen or slide; element comments belong to selected elements in the expanded mode. Do not add a second floating whole-figure action that competes with the owner.
- State whether visual variations configure one component or represent different components. One concept gets one named owner; presentation experiments must not make the product model ambiguous.

Reject a simple choice drawn as list/detail, mixed jobs, titles that announce the future, repeated instructions, sentence-sized next buttons, primary actions that exit instead of advance, duplicate routes, unearned detail panes, redundant panes, doubled completion headlines, receipt-like endings that never say what the user learned, inescapable temporary surfaces, confirmations and dialogs drawn as page content, duplicate comment routes, ambiguous component ownership, and list/preview pairs that repeat the same facts.

Compilation blocks multiple `PageHeader`s and multiple filled work actions, counting an overlay's actions as its own layer rather than the page's. It also blocks a second `Overlay` on one screen, an `Overlay` with no page under it, and an `Overlay` holding no `Button` to leave by. The title and button wording still require review.

## L · Layout follows attention

Implementation principles:

- Apply the [visual fundamentals](#visual-fundamentals) here: rank the content, then execute the ranking with contrast, repetition, alignment, and proximity. Every principle below is one of those four applied to a specific situation.
- Create one unmistakable focal point. Size, position, spacing, and contrast should answer what the user notices first.
- Make visual hierarchy follow decision hierarchy: primary question or work first, supporting facts second, next action last. Celebrate achievement before presenting quieter reassurance.
- For a small tablet decision, make the decision itself the dominant visual and touch surface: one centered column of complete option cards, never a left list competing with a right inspector.
- Make the primary workspace surface visibly dominant, and mean it as a ratio. A conversation, canvas, document, or record detail gets the most width, breathing room, and contrast; navigation, collections, and inspectors stay subordinate. **Never two panes of equal width**: a workspace is a primary surface plus its secondaries, and an even split reads as a layout nobody chose. The primary is held at least a third wider than any pane beside it, and a geometry test measures that ratio rather than a bare inequality. An inspector is the narrowest pane of all, because labelled values need far less width than a column of record titles.
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
- Controls already size to their values by default: a `Select` or single-line `TextField` never fills its column, and a `date`/`number` field draws even narrower.
  There is no per-control override; use `TextArea` for anything that genuinely needs more room.
  Desktop content outside a workspace row also defaults to a readable measure, matching `Center`'s own default, so a lone `Panel`, `Stack`, `TextField`, or `Select` placed directly on the canvas never stretches full width on its own.
  `PageHeader` stays full width as banner chrome; a `List`, a `Table`, or a `Panel` wrapping one reads wide as a record collection; and a `Row` with more than one child (or a `Panel`/`Stack` wrapping one, such as a command bar) already made its own width decision and is left alone.
  Text inside those wide surfaces still keeps the readable measure.
  Give content that legitimately wants the full artboard a `Row` or `Center measure="wide"` instead of a bare `Stack` or `Panel`.
- On a sparse tablet flow, use the available canvas through larger type, taller cards, generous but grouped spacing, and decisive contrast. Quiet graph paper behind the interactive region with a light surface; never shrink a desktop form and float it in the iPad.
- Optimize for scanning before reading. Headings, amounts, states, shapes, and actions should explain the screen in five seconds.
- Use decoration only to identify content, communicate state, reinforce the emotional goal, or explain an unfinished visual decision.
- Draw an icon the product actually shows as an `Icon`, or as `icon` on the `Button` that owns it, never as a character typed into a label. A mark typed into copy is not a mark a reviewer can judge: it takes the label's size instead of its own, it cannot be told apart from the words around it, and it reaches a screen reader as part of the sentence. Give each meaning one named glyph and reuse it on every screen, so the drawing reads as one system.
- Keep the two owners separate. `Icon` is a mark that identifies or annotates and is never clickable; anything a person clicks is a `Button` carrying the same named glyph. One drawn affordance never has two ways to be authored.
- Reach for `iconOnly` only where the product would: a toolbar of marks a user already recognizes, a close control, a copy affordance beside the thing it copies. An icon-only control still carries its `label`, which becomes its accessible name and its tooltip, so hiding the words never hides the meaning. A row of unrecognizable icon-only controls is worse than a row of short labels.
- Size an icon by its job rather than by taste: `sm` rides a line of metadata, `md` stands with body copy, and `lg` is the one mark a screen is about or a target a finger reaches for. The steps are multiples of the artboard's own body type, so the same authored size is correct on every device.
- A meaning the named set does not hold draws a crossed placeholder carrying that name, which is a prompt rather than a finished drawing: pick a named meaning, or say plainly in the surrounding prose that the mark is still undecided. Never work around it by typing a character that looks close.

Reject equal-weight regions, a simple tablet choice split into columns, thin-line pseudo-selection, graph paper louder than the decision, a shrunken desktop form floating in an iPad, four squeezed full-screen panes, card walls, floating metadata or actions, cramped comparison headers, criteria styled like option titles, definitions that read as answers, comment borders crossing text, repeated anchored context, detached tray actions, unrelated dependencies, recommendation/value ambiguity, oversized empty panels, nonparallel choices, decorative filler, icons typed into labels as characters, unlabelled icon-only controls, placeholder glyphs left in a delivered plan, and anything visually louder than its importance.

Defaults keep panels plain, derive dominant panes, and give secondary width to `Rail`. The derivation names exactly one collection per row - the first pane holding a `List` or `Table` - so a detail pane that also holds a list (properties, context, a checklist) stays the primary surface instead of becoming a second bounded column. That derivation is device-independent: a tablet master/detail row is proportioned the same way a desktop one is. Compilation blocks equal desktop thirds and four-or-more outlined sibling panels; lint blocks a Row past its device's column budget; a ramp test keeps the type roles a visible step apart; geometry tests block cramped panes, overlap, manufactured dead bands, painted type below the legibility floor, and a primary surface less than a third wider than the panes beside it.

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
- Confirm destructive actions with alert-dialog semantics immediately before they execute, drawn as `Overlay kind="alert"` over the page the action would change. Name the consequence in the surface - what goes with it, and whether it can be undone - rather than leaving the button label to carry it. `kind="dialog"` is the ordinary task surface; reserve the alert for the irreversible one. Deleting authored content in an edit review remains visible as a struck-through diff; it never disappears silently.
- Use idiomatic focus paint: a border-color shift plus a soft low-opacity halo, not a thick double perimeter. When a dialog or expanded mode closes, move focus to a sensible container or prior control rather than stranding it on the exit trigger.
- Preserve context across mode changes. Entering or exiting maximize, a drawer, or a comment mode keeps the document scroll position, selected target, active screen, and relevant internal scroll.
- Render controls only when their state and anchor are valid. No unexplained dot, empty pill, or footer hover line may appear on load; fix the state cause rather than hiding it after a delay.
- Distinguish selection from opening. Selection uses background plus an outside indicator; unread and priority keep different signals; Enter or a clearly labeled preview route opens the record.
- Make required-field errors appear beside the field before submission. Specific notification consent names the person and address and is never silently enabled. Cancel preserves a draft or warns before loss.
- Settings show visible `On`/`Off` text in addition to switch position and contrast. Keep dependent controls visible-but-disabled under their parent, show integration readiness (`Connected` or `Connect Slack`), and offer a safe test action when the result cannot otherwise be verified.
- Report where work stands with `status` on `ListItem` and on the `Panel` heading its group: `done`, `attention`, `waiting`, `blocked`. Each draws a distinct mark beside copy that already says the same thing, so a review surface answers "is anything waiting on me?" before a line is read. Keep the honest distinction: complete groups read complete and open groups read open. Never manufacture rows to make a sparse screen look busy; an empty state that explains itself is the stronger drawing.

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
- Keep four visibly separated type levels - heading, panel title, body, and metadata - with device-appropriate scale and legible contrast.
- Make interactive controls unmistakable through shape, state, hover, focus, and at least 44px touch targets on tablet and phone.
- In an expanded multi-screen viewer, show screen names as a vertical list on the left and let arrow keys move through that list. The active screen stays visible while the user changes screens.
- Enter expanded mode fit-to-viewport and centered on both axes; support zooming below 100%. Comment and selection markers keep a fixed readable screen size under zoom, like Figma, rather than shrinking or distorting with canvas content.
- Reserve element-level commenting for expanded mode: select an element, then comment. Inline viewing keeps one calm whole-screen comment area and never turns ordinary scrolling into a field of transient controls.
- Keep the expanded toolbar stable between modes. The `Add N notes to plan feedback` action stays flush left, appears inline and expanded, and never overlaps the live note count.

Desktop passes when it reads as dense professional B2B software: the application fits its viewport with no app-wide horizontal scroll; flexible minmax-style columns let the primary surface absorb remaining width; a flush 240px labelled navigation sidebar (or a deliberate 64–72px icon-only rail, which is a different design rather than a squeezed version of this one), a 272px collection, a dominant primary surface, and a 240px inspector stay in one row, which is the whole 1200px canvas spent exactly once and leaves the primary surface half again wider than the collection beside it; persistent panes scroll independently at viewport height while the ticket header and composer remain anchored; narrower widths collapse navigation, then the inspector, before they overflow. It also keeps tighter vertical rhythm, Linear-style settings with a settings sub-nav and one dense field column, create/edit as a route or true modal, and keyboard shortcuts for list movement, search focus, open, compose, mode switch, send, assign, and resolve that supplement visible controls. Reject equal thirds, whole-page scrolling while answering, horizontal app scrolling, four squeezed full-screen panes, a sidebar taking a third of the canvas, floating tablet navigation, two large settings cards, inflated chrome, or oversized iPad sheets.

Tablet passes when it reads as intentional iPad software: fixed 1020 × 720 landscape or 820 × 1180 portrait frame (about 1.44:1), laid out to fit that frame with no internal scroll; native frame with no browser `url`; quiet identity/escape header; touch-first type and 44px controls; wider gutters; and a composition chosen by decision complexity. Two to five simple alternatives use a dominant centered `ChoiceGroup` of tall `ChoiceCard`s with no initial selection and explicit continuation after tap. Master/detail is reserved for a genuine collection whose persistent detail adds useful context. The interaction region quiets the grid rather than shrinking its contents. A fixed-frame screen (tablet or tablet-portrait) must lay out entirely within its declared artboard; an internal scrollbar is a layout defect to fix, not a scroll affordance to keep. Reject a simple decision as list/detail or `Rail`, preselection, faint row selection, a stretched near-square bezel, compressed desktop density, browser chrome, squeezed desktop sidebars, tiny text, a desktop task flow, or content that needs an internal scrollbar to fit its fixed frame.

Phone passes when it reads as a tall narrow handset: 390 × 720 minimum; compact `TopBar`; one content column; 44px controls and 52–64px rows; primary destinations in `BottomBar`; fewer fields; progressive disclosure; list → detail push navigation. Reject `AppShell`/`Sidebar`, side-by-side properties, a vertical iPad, tablet cards with only the height changed, or desktop copy squeezed narrow.

Device presets own widths, fixed tablet ratio, shell availability, type roles, flexible pane widths, independent workspace overflow, anchored conversation chrome, touch floors, contrast, and state paint. `ChoiceGroup`/`ChoiceCard` own simple-decision dominance, touch surfaces, and multi-signal selection; compilation blocks initial preselection, premature continuation, nonmatching option outcomes, and tablet choice groups beside competing columns. The Wireframe viewer owns screen switching, a caption beneath every frame naming that screen over its device and viewport metadata (so never draw the screen's own name inside the artboard), automatic width fitting at rest, two-axis fitting while maximized, the shared figure maximize contract, and an expanded left screen rail with arrow-key sequencing, toolbar placement, focus return, and scroll preservation; horizontal centering of the fitted frame, below-100% zoom, and fixed-screen-size markers remain standards you must draw inside the artboard, not reader controls the viewer supplies. Geometry tests fence true sizes, app-wide overflow, primary dominance, independent panes, anchored header/composer, 1.39–1.44 tablet ratio, shells, pane floors, overlap, unjustified dead bands, and target sizes.

## LOOP: prove it before delivery

1. **Look it up:** start from a proven native pattern.
2. **Open the render:** inspect every screen at declared size, light/dark, hover, focus, active, empty, disabled, and error.
3. **Object three times:** challenge each screen with CLEAR, fix three findings, and re-open it.
4. **Probe every lifecycle:** have a fresh reviewer adversarially select whole and partial text, add/view/edit/delete/submit/revisit comments, enter/exit expanded modes, zoom in/out, change screens, and verify focus, scroll, markers, counts, labels, and escape routes. Incorporate confirmed findings before presentation.
5. **Push the fix down:** when the interface allowed the defect, repair the primitive or diagnostic rather than one example.

## Eight paste-ready patterns

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
      <Button label="Inbox" icon="back" navigateTo="inbox" />
    </TopBar>
    <Text text="Checkout freeze" />
    <BottomBar>
      <Button label="Inbox" emphasis="primary" navigateTo="inbox" />
    </BottomBar>
  </Stack>
</Screen>
```

Destructive confirmation over a page:

```mdx
<Screen id="plans" name="Plans" device="desktop" url="app.example.com/plans">
  <PageHeader title="Plans">
    <Button label="Search plans" icon="search" iconOnly />
    <Button label="Workspace settings" icon="settings" iconOnly />
  </PageHeader>
  <Panel title="Plans">
    <List>
      <ListItem label="Checkout rewrite" meta="Draft" selected />
    </List>
  </Panel>
  <Overlay kind="alert" title="Delete Checkout rewrite?">
    <Text text="The plan and its two open comments go with it. This cannot be undone." />
    <Row gap="sm" justify="end">
      <Button
        label="Keep the plan"
        emphasis="tertiary"
        navigateTo="plans-kept"
      />
      <Button
        label="Delete plan"
        emphasis="destructive"
        navigateTo="plans-deleted"
      />
    </Row>
  </Overlay>
</Screen>
```
