import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";
import { loadState } from "../config.js";
import { clip, describeToolCall, escapeHtml } from "../format.js";
import { lastAssistantText } from "../transcript.js";
import type { TelegramBridge } from "./bot.js";
import type { Session } from "./sessions.js";

const MAX_BODY = 25 * 1024 * 1024;
const APPROVAL_TIMEOUT_MS = 580_000; // just under the hook client's own wait
const PHOTO_MIN_INTERVAL_MS = 20_000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, secret: string): boolean {
  const got = Buffer.from(String(req.headers["x-nudge-secret"] ?? ""));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function startServer(config: Config, bridge: TelegramBridge) {
  const registry = bridge.registry;

  const touchFrom = (body: any): Session | null => {
    const p = body.payload ?? body;
    if (!p?.session_id) return null;
    return registry.touch(p.session_id, {
      pane: body.pane,
      cwd: p.cwd,
      transcript: p.transcript_path,
      event: body.event ?? p.hook_event_name ?? "event",
    });
  };

  const routes: Record<string, (body: any) => Promise<unknown>> = {
    "/health": async () => ({ ok: true, away: loadState().away }),

    "/event": async (body) => {
      const p = body.payload ?? {};
      if (body.event === "SessionEnd") {
        if (p.session_id) registry.remove(p.session_id);
        return {};
      }
      const s = touchFrom(body);
      if (!s || !loadState().away) return {};

      if (body.event === "Notification") {
        const message = String(p.message ?? "Claude needs your attention");
        // Permission prompts are already delivered with buttons by the PermissionRequest hook.
        if (/permission/i.test(message) && bridge.pending.size > 0) return {};
        await bridge.notify(s, `🔔 ${escapeHtml(message)}\n<i>Reply to respond.</i>`);
      } else if (body.event === "Stop") {
        const text = lastAssistantText(s.transcript) ?? "(no text output)";
        await bridge.notify(s, `✅ <b>Turn finished</b>\n\n${escapeHtml(clip(text, 3400))}\n\n<i>Reply to continue.</i>`);
      }
      return {};
    },

    "/approval": async (body) => {
      const s = touchFrom(body);
      if (!s || !loadState().away) return { decision: null };
      const p = body.payload ?? {};
      const toolName = String(p.tool_name ?? "tool");
      return bridge.requestApproval(s, toolName, describeToolCall(toolName, p.tool_input), APPROVAL_TIMEOUT_MS);
    },

    // PostToolUse from Claude in Chrome tools.
    "/browser": async (body) => {
      const s = touchFrom({ ...body, event: "browser" });
      if (!s) return {};
      const url = body.tool_input?.url;
      if (typeof url === "string" && url) s.lastUrl = url;
      if (!body.image?.data || !loadState().away) return {};
      if (Date.now() - s.lastPhotoAt < PHOTO_MIN_INTERVAL_MS) return { skipped: "rate-limited" };
      s.lastPhotoAt = Date.now();
      await bridge.sendPhoto(s, Buffer.from(body.image.data, "base64"), `🖼 ${s.lastUrl ?? "browser screenshot"}`);
      return {};
    },

    // From `nudge shot` (run by Claude via Bash, or by you).
    "/photo": async (body) => {
      const s = registry.byPane(body.pane) ?? null;
      if (s && body.url) s.lastUrl = body.url;
      await bridge.sendPhoto(s, Buffer.from(String(body.image), "base64"), `🖼 ${body.caption ?? body.url ?? ""}`);
      return {};
    },

    "/away": async (body) => {
      if (body.away) {
        await bridge.notify(null, "🛰 <b>Away mode ON</b> — I'll forward progress, questions and approvals here.");
      } else {
        bridge.releaseAll();
        await bridge.notify(null, "🏠 <b>Away mode OFF</b> — back at the keyboard.");
      }
      return {};
    },
  };

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !authorized(req, config.secret)) return send(res, 403, { error: "forbidden" });
    const handler = routes[req.url ?? ""];
    if (!handler) return send(res, 404, { error: "not found" });
    try {
      const raw = await readBody(req);
      send(res, 200, (await handler(raw ? JSON.parse(raw) : {})) ?? {});
    } catch (e: any) {
      console.error(`[nudge] ${req.url} failed:`, e?.message ?? e);
      send(res, 500, { error: String(e?.message ?? e) });
    }
  });
  server.requestTimeout = 0; // approvals are long-held requests
  server.headersTimeout = 30_000;
  server.listen(config.port, "127.0.0.1", () => console.log(`[nudge] listening on 127.0.0.1:${config.port}`));
  return server;
}
