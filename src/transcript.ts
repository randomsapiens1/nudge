import { closeSync, openSync, readSync, statSync } from "node:fs";

const TAIL_BYTES = 2 * 1024 * 1024;

function readTail(path: string): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8");
}

/** Extract the text of the most recent assistant message from a Claude Code JSONL transcript. */
export function lastAssistantTextFromJsonl(jsonl: string): string | null {
  const lines = jsonl.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // first line of a tail read may be partial
    }
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

export function lastAssistantText(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return lastAssistantTextFromJsonl(readTail(path));
  } catch {
    return null;
  }
}
