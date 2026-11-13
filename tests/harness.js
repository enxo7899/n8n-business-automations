// Runs an n8n Code node source outside n8n with $input and $() mocked.
import { readFileSync } from "node:fs";
export function runCodeNode(file, items, others = {}) {
  const src = readFileSync(new URL(`../code/${file}`, import.meta.url), "utf8");
  const wrap = (arr) => ({ all: () => arr.map((json) => ({ json })) });
  const fn = new Function("$input", "$", src);
  return fn(wrap(items), (name) => wrap(others[name] ?? [])).map((i) => i.json);
}
export const claudeReply = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
