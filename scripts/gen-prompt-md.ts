/**
 * Regenerates the versioned Goal Discovery prompt document (the review-friendly
 * prompt document) from the runtime source of truth in src/lib/goal-discovery/prompt.ts.
 *
 * Run: node --import tsx scripts/gen-prompt-md.ts
 * The fenced block in the markdown must stay byte-for-byte identical to
 * GOAL_DISCOVERY_SYSTEM_PROMPT — enforced by src/test/prompt.test.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { GOAL_DISCOVERY_SYSTEM_PROMPT, PROMPT_VERSION } from "../src/lib/goal-discovery/prompt";

const targetPath = resolve(__dirname, `../docs/ai/prompts/${PROMPT_VERSION}.md`);

const markdown = [
  `# Goal Discovery System Prompt (${PROMPT_VERSION})`,
  "",
  "Generated from `src/lib/goal-discovery/prompt.ts` by `scripts/gen-prompt-md.ts`.",
  "The fenced block below is the runtime prompt, byte for byte. Edit the",
  "TypeScript constant, not this file, then regenerate.",
  "",
  "```",
  GOAL_DISCOVERY_SYSTEM_PROMPT,
  "```",
  "",
].join("\n");

mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, markdown, "utf-8");
console.log(`wrote ${targetPath} (${markdown.length} chars, prompt ${PROMPT_VERSION})`);
