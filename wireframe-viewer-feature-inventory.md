<!--
Records the 2026-08-06 inventory of Wireframe viewer features: what guidance and tests
name, what main implements, and where the missing controls last lived.
This is scoping evidence for follow-up ships; it does not implement the zoom viewer.
Retire this file once its follow-up ships are filed as issues; it is a snapshot of one
commit and drifts as main moves.
-->

# Wireframe viewer feature inventory

Audit date: 2026-08-06
Main audited: `origin/main` at `f61dbe9491d8594e49a104967ddc15b14df8a2a5`

`Wireframe` is the only figure family whose authoring guidance names a canvas viewer that the product does not ship.
This inventory names each named-but-absent feature, the shipped state on main, and the existing implementation the follow-up work should adopt rather than reinvent.
It exists because those controls are named in guidance that agents read while authoring plans, so an author can reasonably compose a wireframe deck expecting reader controls that are not there.

**Retirement path.** This is a temporary planning artifact under the AGENTS.md documentation map, not a maintained document.
Once the [follow-up ships](#follow-up-ships) below are filed as GitHub issues, delete this file and let the issues carry the work.
Nothing in the repository points to it, so deleting it is safe.

## What Wireframe actually implements today

The viewer script owns one Wireframe block, at `src/render/shell/viewer-script.ts:938`.
That block does exactly two things:

- **Screen navigation.** Clicking any `[data-wireframe-navigate]` trigger marks one screen current and sets `aria-current` on the matching switch.
- **Automatic shrink-to-fit.** `fit()` writes a numeric `zoom` on `.wireframe-frame` equal to `min(1, screenWidth / frameWidth)`, on load, after each screen change, and on resize.

Two properties of that fit matter for scoping the follow-up.
It is width-only, so it never fits a tall screen to the viewport height.
And it is clamped at `1`, so it only ever shrinks; there is no path above 100% and no user control over the value at all.

`src/components/wireframe/view.tsx` renders the screen switcher and the artboards.
It renders no toolbar, no zoom readout, no `Fit` control, and no maximize trigger.

The test suite matches that narrow surface.
`test/component-interactions.spec.ts:110` registers Wireframe's entire interaction contract as `affordances: ["switch screen"]`.
`test/wireframe.spec.ts` covers navigation, keyboard reach, and geometry only.
No Wireframe test asserts zoom, fit-to-viewport, expansion, or markers, so the missing features are absent from the enforcement layer as well as from the code.

Product documentation is already consistent with the shipped state, not with the guidance.
`docs/src/content/docs/intro/features.md:13` lists the maximize families and omits Wireframe.
Line 50 of that file describes the Wireframe viewer as "wireframe navigation and scaling".

## Named in guidance, not implemented

Every feature below is named in `src/components/wireframe/wireframe.guidance.md`.
Each is authored as a standard the plan author must draw inside the artboard, so guidance is not wrong to state it.
The gap is that Wireframe supplies none of it as a real reader control, which is what the follow-up ships would change.
Guidance line `:151` now records that split explicitly, so an author is no longer told the viewer supplies these.

| Feature named in guidance                                                  | Guidance | Shipped on main                                                                                |
| -------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Expanded mode entered fit-to-viewport and centered on both axes            | :141     | Not implemented. `fit()` is width-only, never centers, and there is no expanded mode to enter. |
| Zooming below 100% under reader control                                    | :141     | Not implemented. Automatic scale only, with no control and no readout.                         |
| Markers holding a fixed readable screen size under zoom                    | :141     | Not implemented. Wireframe renders no comment or selection markers at all.                     |
| Toolbar owning zoom, `Fit`, and maximize in stable positions               | :56      | Not implemented. Wireframe renders no toolbar.                                                 |
| Expanded screen navigation as a left vertical list with arrow-key movement | :140     | Not implemented. Navigation is the inline horizontal switcher only.                            |
| Focus return and scroll preservation across mode changes                   | :95      | Not applicable yet, because no mode change exists to preserve context across.                  |
| Element-level commenting reserved for expanded mode                        | :142     | Not implemented. Wireframe has no comment transport.                                           |

The two clusters are separable.
Everything in the first four rows is canvas viewer work.
The commenting rows depend on the canvas viewer existing first, and additionally on a per-element comment address that Wireframe does not have.

## Where the missing controls last lived

None of these controls were removed from Wireframe; Wireframe never had them.
They live today in sibling families, which is where the follow-up should take them from.

**Zoom and `Fit`** live in `FlowDiagram`.
The toolbar is built at `src/components/flow-diagram/view.tsx:259` as a right-aligned cluster of zoom out, a reset readout, zoom in, then `Fit`, then maximize.
The behavior is `src/render/shell/diagram-script.ts`: a single transform per diagram carrying `x`, `y`, and `zoom`, stepped through `ZOOM_STEPS` between `ZOOM_MIN` 0.25 and `ZOOM_MAX` 4, zooming about the pointer so the pixel under the cursor stays put, and a `fit()` at `:260` that measures on demand and centers on both axes.
That script also already solves the fixed-screen-size marker problem: it writes `--flow-marker-scale` as `1 / zoom` at `:209`.
The standard Wireframe's guidance names is, feature for feature, what `FlowDiagram` already does.

**Maximize** is a shared contract, not a per-component feature.
`src/components/_model/figure-controls/figure-controls.ts` owns the attribute vocabulary and labels, `src/components/_shared/figure-controls/maximize-button.tsx` renders the trigger, and the viewer script drives it.
Six families adopt it: `CodeSnippet`, `CodeDiff`, `FileTreeDiff`, `DataTable`, `DatabaseTableSchema`, `FlowDiagram`, plus plain fenced code through `src/render/markdown/code-figure.ts`.
Wireframe is the one figure family that never opted in.
This was already recorded during the branch audit: `branch-preservation-audit.md` notes that `1c1fe5b2` / PR 36 "supplies shared maximize behavior to several figure families, but not to `Wireframe`."

## Follow-up ships

Sequenced so each ship is independently reviewable and leaves the product coherent.

1. **Adopt the shared maximize contract in Wireframe.**
   Apply `MAXIMIZABLE_ATTRIBUTE` to the wireframe frame, render `MaximizeButton` in a new header row, mark the scrolling body, and extend `test/figure-maximize.spec.ts` to cover the seventh family.
   This is the smallest ship, it reuses an existing contract, and it is what unblocks a true expanded mode.

2. **Give Wireframe a canvas viewer with zoom and `Fit`.**
   Promote the pan-and-zoom transform out of `diagram-script.ts` into a shared viewer primitive that both `FlowDiagram` and `Wireframe` drive, rather than copying it.
   Replace the current width-only `fit()` with the two-axis centered fit, and let the reader move below and above 100%.
   Extract the shared toolbar cluster at the same time so zoom, `Fit`, and maximize keep identical positions across both families.

3. **Add expanded screen navigation.**
   Move the screen switcher to a left vertical list inside expanded mode, wire arrow keys, and preserve active screen, focus, and scroll across enter and exit.

4. **Reconcile the enforcement layer with whatever ships.**
   Widen the Wireframe `affordances` contract in `test/component-interactions.spec.ts`, add geometry tests for centered fit and marker scale, and update `docs/src/content/docs/intro/features.md` lines 13 and 50.

5. **Element-level Wireframe commenting.**
   Blocked on ships 2 and 3 and on a stable per-element comment address.
   `branch-preservation-audit.md` records the same blocker from the other side: `711869c1` / PR 48 supplied in-place `FlowDiagram` feedback but not Wireframe feedback transport, and `b14d38f3` / PR 45 supplied plan identity but not stable per-block comment addresses.

`wireframe.guidance.md` already states, at `:151`, that these are artboard drawing standards rather than reader controls the viewer supplies, so an author is not composing against a viewer that is not there.
When the ships above land, that sentence and `docs/src/content/docs/intro/features.md` lines 13 and 50 both need to move with them.
