export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function clipTail(s: string, max: number): string {
  return s.length <= max ? s : "…" + s.slice(s.length - max + 1);
}

export function ago(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

/** Human summary of a tool call for an approval prompt (HTML). */
export function describeToolCall(toolName: string, input: any): string {
  const pre = (s: string, n = 2500) => `<pre>${escapeHtml(clip(s, n))}</pre>`;
  const i = input ?? {};
  switch (toolName) {
    case "Bash":
      return (i.description ? `${escapeHtml(i.description)}\n` : "") + pre(String(i.command ?? ""));
    case "Edit":
      return (
        `<code>${escapeHtml(String(i.file_path ?? ""))}</code>\n` +
        pre(`- ${clip(String(i.old_string ?? ""), 1100)}\n+ ${clip(String(i.new_string ?? ""), 1100)}`)
      );
    case "MultiEdit":
      return `<code>${escapeHtml(String(i.file_path ?? ""))}</code> (${(i.edits ?? []).length} edits)`;
    case "Write":
      return `<code>${escapeHtml(String(i.file_path ?? ""))}</code>\n` + pre(String(i.content ?? ""), 1500);
    case "WebFetch":
      return `<code>${escapeHtml(String(i.url ?? ""))}</code>`;
    default:
      return pre(JSON.stringify(i, null, 2), 2000);
  }
}
