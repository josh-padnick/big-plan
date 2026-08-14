# Using Slide well

`Slide` is the guidance hook for a recurring plan role: place one self-closing marker directly above the h2 it describes.
Run this command once before drafting a plan; the complete catalog below is designed to stay in context for the whole authoring pass.

1. State what the next slide needs to help the reviewer understand or decide.
2. Look for a matching type below.
3. When one fits, write `<Slide type="..." />` immediately above the h2 and follow that type's guidance.
4. When none fits, write an untyped slide under the general guidance; never force a one-off idea into the nearest label.

For a typed slide, the type supplies the sentence-case structural name shown in the kicker, overview, and navigation.
The h2 supplies this plan's title: normally distinct from the name, written with concrete nouns and active verbs, without evaluative adjectives, superlatives, slogans, or abstract noun stacks.
This plain-language discipline stays guidance because broad title lint would create false positives; identical name and title remain structurally valid when a distinct title would be strained.

`user-journey` applies the same distinction one level deeper.
Use “User journeys” as the container name, and nest every journey underneath it rather than beside it.
Make the container a `Part` by default: a marker attaches only to an h2, so the Part is the only container that holds typed journey slides as its children, and lint rejects a typed journey authored next to an untyped container slide.
Each typed journey then supplies a distinct `name` for its kicker and sidebar, an ultra-concise `toc` form for the overview, and a full plain-language h2 title.
An untyped “User journeys” slide is still a valid container when every journey fits an h3 sub-slide of it, which trades those marker affordances and the wireframe contract for a shorter section.
Open the container Part with an intro slide that introduces the actors - one bullet per actor with its journey count, a sub-bullet naming what that actor does, and a jump line linking each journey by the slug of its h2 - and title that slide with its claim, since the Part already carries the container name.
Most typed journey slides should contain a `Wireframe` whose `Screen` mockups let the reviewer see and click through the actual interface states in that human loop.
When no UI exists to show, add a non-empty `wireframeReason` attribute to the `Slide` marker that explains the choice; never leave a missing Wireframe unexplained.
Prose can annotate what matters, and the Wireframe component's CLEAR guidance applies whenever you draw mockups.

{{SLIDE_TYPE_CATALOG}}
