#!/usr/bin/env node
// Thin executable boundary: all CLI behavior lives in src/cli (built to dist).
import { main } from "../dist/cli/main.js";

await main();
