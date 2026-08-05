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
Use “User journeys” as the container name, choosing a `Part` or an untyped introductory slide according to the plan's argument.
Each typed journey then supplies a distinct `name` for its kicker and sidebar, an ultra-concise `toc` form for the overview, and a full plain-language h2 title.
Every journey slide must also contain a `Wireframe` whose `Screen` mockups let the reviewer see and click through the actual interface states in that human loop.
Prose can annotate what matters, but a prose-only journey is invalid; follow the Wireframe component's CLEAR guidance when drawing the mockups.

{{SLIDE_TYPE_CATALOG}}
