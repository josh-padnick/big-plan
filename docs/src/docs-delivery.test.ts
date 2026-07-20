// Covers the clean-Markdown projection shared by the agent-facing docs
// endpoints.

import { describe, expect, it } from "vitest";
import { serializeMarkdownBody } from "./docs-delivery";

describe("serializeMarkdownBody", () => {
  it("should replace presentation-only MDX while preserving authored Markdown", () => {
    const body = `
import ThemeImage from "./ThemeImage.astro";
import light from "./light.png";
import dark from "./dark.png"

## How it looks

<ThemeImage
  light={light}
  dark={dark}
  alt="The component in the light theme"
/>

\`\`\`mdx
import Example from "./Example.astro";
<Example />
<ThemeImage light={light} dark={dark} alt="An authored example" />
\`\`\`
`;

    expect(serializeMarkdownBody(body)).toBe(`## How it looks

The component in the light theme

\`\`\`mdx
import Example from "./Example.astro";
<Example />
<ThemeImage light={light} dark={dark} alt="An authored example" />
\`\`\`
`);
  });

  it("should drop live embed frames while keeping the prose beside them", () => {
    const body = `
import ThemeFrame from "../../../components/ThemeFrame.astro";

## How it looks

All four callout types, rendered live by the viewer:

<ThemeFrame
  light="/embeds/callout-types-light.html"
  dark="/embeds/callout-types-dark.html"
  title="All four callout types rendered in the viewer"
  height="34rem"
/>

Next paragraph.
`;

    expect(serializeMarkdownBody(body)).toBe(`## How it looks

All four callout types, rendered live by the viewer:

Next paragraph.
`);
  });

  it("should convert Starlight tabs into labeled Markdown sections", () => {
    const body = `
import { Tabs, TabItem } from "@astrojs/starlight/components";

<Tabs>
  <TabItem label="Light mode">
    ![Light screenshot](./light.png)
  </TabItem>
  <TabItem label='Dark mode'>
    ![Dark screenshot](./dark.png)
  </TabItem>
</Tabs>

\`\`\`mdx
<Tabs>
  <TabItem label="Authored example">
    Content
  </TabItem>
</Tabs>
\`\`\`
`;

    expect(serializeMarkdownBody(body)).toBe(`### Light mode

![Light screenshot](./light.png)

### Dark mode

![Dark screenshot](./dark.png)

\`\`\`mdx
<Tabs>
  <TabItem label="Authored example">
    Content
  </TabItem>
</Tabs>
\`\`\`
`);
  });
});
