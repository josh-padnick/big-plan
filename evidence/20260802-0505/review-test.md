# Captain quick review test

Run against the final light and dark renders before the preview was packaged.
Each item records the three issues a picky review surfaced and the correction
present in the final artifact.

## Desktop · Ticket

1. The three panes competed at equal weight. The queue and properties now have
   bounded widths while conversation absorbs the flexible space.
2. The reply composer could disappear with the timeline. Conversation scrolls
   independently and the composer stays pinned to its bottom edge.
3. Reply and internal-note state relied on one selected tab. Mode names,
   audience copy, message treatment, send label, and shortcuts now reinforce
   the same state.

## Desktop · Inbox

1. Ticket facts drifted between rows. Ticket, Status, Assignee, and Updated now
   use fixed, aligned table columns.
2. Selected-row paint could touch the first cell's text. The inset selection
   edge now has explicit padding clearance and a browser regression assertion.
3. The preview was generic dead width. It now carries the actionable SLA,
   latest customer evidence, owner and account context, recommendation, and
   the route into conversation; the pane scrolls independently when needed.

## Desktop · New ticket

1. Input facts, routing judgment, and submission consequences were interleaved.
   Facts own the main pane; duplicate evidence and routing own the rail.
2. Duplicate suggestions lacked provenance and consequence-naming actions.
   The card now explains its match and offers Review ticket, Create and link,
   and Not a duplicate without sacrificing the draft.
3. The create action and its email effect fell below the fold. A sticky final
   panel keeps the checked email consequence beside “Create ticket and email
   Maya.”

## Desktop · Settings

1. Workspace and personal controls did not say whom they affected. Both groups
   now state scope explicitly.
2. Slack channel and delivery-time controls looked like peers of their parent
   switches. Dependent controls are visibly indented beneath those parents.
3. State and persistence were implicit. Switches say On/Off and one sticky bar
   owns the unsaved count, Discard, and Save changes.

## Maximized viewer and commenting

1. The current screen was hard to change in a focused view. A persistent
   vertical screen-name list now supports click, Arrow Up/Down, Home, and End.
2. Comment icons appeared throughout ordinary reading. Each screen has one
   calm whole-screen comment area; element comments require explicit selection
   and exist only while maximized.
3. Leaving maximize reset the document position. Entry position is captured
   and restored after either the restore button or Escape.

## Phone presentation

1. Phone drawings occupied too much of the reading column. Their painted
   maximum is reduced to 340px.
2. Reducing width could have shortened the silhouette. The logical device
   remains 390×844 and is scaled proportionally.
3. Reducing width could have changed authored touch geometry. Controls retain
   their source measurements; only the outer painted scale changes.
