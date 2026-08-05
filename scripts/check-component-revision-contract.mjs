// Closes the component revision-adapter registry after TypeScript emits it so
// no registered component can silently fall back to flattened Markdown diffs.

import { COMPONENT_REGISTRY } from "../dist/components/_registration/registry.js";

const missing = Object.entries(COMPONENT_REGISTRY).flatMap(
  ([name, definition]) => {
    const adapter = definition.revision;
    return adapter &&
      typeof adapter.semantic === "function" &&
      typeof adapter.text === "function" &&
      typeof adapter.view === "function"
      ? []
      : [name];
  },
);

if (missing.length > 0) {
  throw new Error(
    `Registered components without revision adapters: ${missing.join(", ")}`,
  );
}

console.log(
  `checked ${Object.keys(COMPONENT_REGISTRY).length} component revision adapters`,
);
