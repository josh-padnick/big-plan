// Configures the public Big Plan documentation site and its navigation.

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { SIDEBAR } from "./src/sidebar";

export default defineConfig({
  site: "https://big-plan.ai",
  integrations: [
    starlight({
      title: "Big Plan",
      // The boxed favicon marks the docs site apart from the tool's plain
      // /bp favicon; the SVG swaps light/dark art itself.
      favicon: "/favicon.svg",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      // The shared sidebar module also drives the llms.txt page map.
      sidebar: [...SIDEBAR],
    }),
  ],
});
