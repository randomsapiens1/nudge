import { describe, expect, it } from "vitest";
import { findImage, normalizeUrl } from "./images.js";
import { HOOK_SPECS, MARK, mergeHooks, removeHooks } from "./install.js";
import { lastAssistantTextFromJsonl } from "./transcript.js";
import { formatDecision } from "./hook.js";
import { Registry } from "./daemon/sessions.js";

const cmd = (ev: string) => `node cli.js hook ${ev} ${MARK}`;

describe("mergeHooks", () => {
  const userSettings = {
    model: "opus",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
  };

  it("adds every hook and keeps user hooks", () => {
    const out = mergeHooks(userSettings, cmd);
    expect(out.model).toBe("opus");
    for (const spec of HOOK_SPECS) expect(out.hooks[spec.event]).toBeDefined();
    expect(out.hooks.Stop).toHaveLength(2);
    expect(out.hooks.Stop[0].hooks[0].command).toBe("say done");
    expect(out.hooks.PermissionRequest[0]).toMatchObject({ matcher: "*", hooks: [{ timeout: 600 }] });
  });

  it("is idempotent", () => {
    const once = mergeHooks(userSettings, cmd);
    expect(mergeHooks(once, cmd)).toEqual(once);
  });

  it("removeHooks restores the original", () => {
    expect(removeHooks(mergeHooks(userSettings, cmd))).toEqual(userSettings);
    expect(removeHooks(mergeHooks({}, cmd))).toEqual({});
  });
});

describe("transcript", () => {
  it("returns the last assistant text, skipping tool-only turns and partial lines", () => {
    const jsonl = [
      '{"type":"ass', // partial first line from a tail read
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "first" }] } }),
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done: updated the button." }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
      "",
    ].join("\n");
    expect(lastAssistantTextFromJsonl(jsonl)).toBe("Done: updated the button.");
  });
});

describe("images", () => {
  const b64 = "A".repeat(200);
  it("finds MCP image content", () => {
    expect(findImage([{ type: "text", text: "x" }, { type: "image", data: b64, mimeType: "image/jpeg" }])).toEqual({
      data: b64,
      mime: "image/jpeg",
    });
  });
  it("finds Anthropic-style nested image content", () => {
    expect(findImage({ content: [{ type: "image", source: { data: b64, media_type: "image/png" } }] })?.mime).toBe(
      "image/png",
    );
  });
  it("returns null when there is no image", () => {
    expect(findImage({ content: [{ type: "text", text: "ok" }] })).toBeNull();
  });
  it("normalizes urls", () => {
    expect(normalizeUrl("3000")).toBe("http://localhost:3000");
    expect(normalizeUrl("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(normalizeUrl("https://x.dev")).toBe("https://x.dev");
  });
});

describe("formatDecision", () => {
  it("formats PermissionRequest allow/deny", () => {
    expect(formatDecision("PermissionRequest", { decision: "allow" })).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    expect((formatDecision("PermissionRequest", { decision: "deny", message: "no" }) as any).hookSpecificOutput.decision)
      .toEqual({ behavior: "deny", message: "no" });
  });
  it("formats PreToolUse", () => {
    expect((formatDecision("PreToolUse", { decision: "deny" }) as any).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

describe("Registry", () => {
  it("routes replies to the session of the replied-to message, else last active", () => {
    const r = new Registry();
    r.touch("aaaaaaaa", { event: "Stop", pane: "%1", cwd: "/x/app" });
    r.touch("bbbbbbbb", { event: "Stop", pane: "%2", cwd: "/x/api" });
    r.recordMessage(10, "aaaaaaaa");
    expect(r.resolve(10)?.pane).toBe("%1");
    expect(r.resolve(99)?.pane).toBe("%2");
    expect(r.resolve()?.id).toBe("bbbbbbbb");
    expect(r.byPane("%1")?.id).toBe("aaaaaaaa");
    expect(Registry.label(r.sessions.get("aaaaaaaa")!)).toBe("app · aaaaaa");
  });
});
