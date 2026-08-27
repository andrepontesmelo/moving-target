#!/usr/bin/env node
import { extractFirstPrompts } from "./extract.js";

const cwd = process.argv[2] ?? process.cwd();
for (const r of await extractFirstPrompts(cwd)) {
  const flat = [...r.prompt.replace(/\s+/g, " ")].slice(0, 120).join(""); // code-point-safe: no surrogate splits
  console.log(`${r.date} ${r.time} ${flat}`);
}
