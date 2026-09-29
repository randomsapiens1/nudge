import { randomBytes } from "node:crypto";
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Config } from "../config.js";
import { loadState, saveState } from "../config.js";
import { ago, clip, clipTail, escapeHtml } from "../format.js";
import { captureUrl } from "../shot.js";
import { capturePane, sendKeys, sendText } from "../tmux.js";
import { Registry, type Session } from "./sessions.js";

export type Decision = { decision: "allow" | "deny" | null; message?: string };

interface PendingApproval {
  sessionId: string;
  toolName: string;
  messageId: number;
  html: string;
  resolve: (d: Decision) => void;
}

const MAX_TEXT = 4000;

export class TelegramBridge {
  readonly bot: Bot;
  readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly config: Config,
    readonly registry: Registry,
  ) {
    this.bot = new Bot(config.botToken);
    this.bot.catch((err) => console.error("[nudge] bot error:", err.error));
    this.registerHandlers();
  }

  // ---------- outbound ----------

  async notify(session: Session | null | undefined, html: string, keyboard?: InlineKeyboard): Promise<number> {
    const header = session ? `<b>[${escapeHtml(Registry.label(session))}]</b>\n` : "";
    const msg = await this.bot.api.sendMessage(this.config.chatId, clip(header + html, MAX_TEXT), {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    this.registry.recordMessage(msg.message_id, session?.id);
    return msg.message_id;
  }

  async sendPhoto(session: Session | null | undefined, png: Buffer, caption: string): Promise<void> {
    const header = session ? `[${Registry.label(session)}] ` : "";
    const text = clip(header + caption, 1000);
    try {
      const msg = await this.bot.api.sendPhoto(this.config.chatId, new InputFile(png, "screenshot.png"), {
        caption: text,
      });
      this.registry.recordMessage(msg.message_id, session?.id);
    } catch {
      // Very tall full-page shots exceed photo dimension limits; send as a file instead.
      const msg = await this.bot.api.sendDocument(this.config.chatId, new InputFile(png, "screenshot.png"), {
        caption: text,
      });
      this.registry.recordMessage(msg.message_id, session?.id);
    }
  }

  /** Ask for approval; resolves when a button is tapped or after `timeoutMs`. */
  async requestApproval(session: Session, toolName: string, bodyHtml: string, timeoutMs: number): Promise<Decision> {
    if (session.alwaysAllow.has(toolName)) return { decision: "allow" };

    const id = randomBytes(4).toString("hex");
    const keyboard = new InlineKeyboard()
      .text("✅ Approve", `ap:${id}:a`)
      .text("❌ Deny", `ap:${id}:d`)
      .row()
      .text(`✅ Always allow ${toolName} (this session)`, `ap:${id}:s`);
    const html = `🔐 <b>${escapeHtml(toolName)}</b> needs approval\n${bodyHtml}`;
    const messageId = await this.notify(session, html + "\n<i>Tap a button, or reply with text to deny with a reason.</i>", keyboard);

    return new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.finishApproval(messageId, session, html, "⏱ Timed out — answer on the Mac.");
        resolve({ decision: null });
      }, timeoutMs);
      this.pending.set(id, {
        sessionId: session.id,
        toolName,
        messageId,
        html,
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d);
        },
      });
    });
  }

  private finishApproval(messageId: number, session: Session | undefined, html: string, outcome: string): void {
    const header = session ? `<b>[${escapeHtml(Registry.label(session))}]</b>\n` : "";
    this.bot.api
      .editMessageText(this.config.chatId, messageId, clip(`${header}${html}\n\n<b>${escapeHtml(outcome)}</b>`, MAX_TEXT), {
        parse_mode: "HTML",
      })
      .catch(() => {});
  }

  /** Resolve every pending approval (e.g. when away mode is switched off). */
  releaseAll(): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      this.finishApproval(p.messageId, this.registry.sessions.get(p.sessionId), p.html, "↩️ Released to the Mac.");
      p.resolve({ decision: null });
    }
  }

  // ---------- inbound ----------

  private registerHandlers(): void {
    const bot = this.bot;

    // Only the configured chat may talk to the bot.
    bot.use(async (ctx, next) => {
      if (ctx.chat?.id === this.config.chatId) await next();
    });

    bot.command(["start", "help"], (ctx) =>
      ctx.reply(
        [
          "Nudge is connected.",
          "",
          "Reply to any message (or just type) to send text to Claude.",
          "/status – sessions",
          "/tail [n] – last n lines of the pane",
          "/shot [url] – screenshot a page (e.g. /shot 3000)",
          "/esc – interrupt Claude (Escape)",
          "/keys <k…> – raw tmux keys, e.g. /keys Down Enter",
          "/away on|off – toggle away mode",
        ].join("\n"),
      ),
    );

    bot.command("status", async (ctx) => {
      const state = loadState();
      const lines = [...this.registry.sessions.values()]
        .sort((a, b) => b.lastAt - a.lastAt)
        .map(
          (s) =>
            `${s.id === this.registry.lastActive ? "▶" : "•"} <b>${escapeHtml(Registry.label(s))}</b> ` +
            `pane ${escapeHtml(s.pane ?? "—")} · ${escapeHtml(s.lastEvent)} ${ago(s.lastAt)}`,
        );
      await ctx.reply(
        `Away mode: <b>${state.away ? "ON" : "OFF"}</b>\nPending approvals: ${this.pending.size}\n\n` +
          (lines.join("\n") || "No sessions seen yet."),
        { parse_mode: "HTML" },
      );
    });

    bot.command("tail", async (ctx) => {
      const s = this.registry.resolve(ctx.message?.reply_to_message?.message_id);
      if (!s?.pane) return ctx.reply("No tmux pane known for that session.");
      const n = Math.min(Math.max(parseInt(ctx.match, 10) || 40, 5), 300);
      const out = await capturePane(s.pane, n).catch((e) => `tmux error: ${e.message}`);
      const msg = await ctx.reply(
        `<b>[${escapeHtml(Registry.label(s))}]</b>\n<pre>${escapeHtml(clipTail(out, 3700))}</pre>`,
        { parse_mode: "HTML" },
      );
      this.registry.recordMessage(msg.message_id, s.id);
    });

    bot.command("esc", async (ctx) => {
      const s = this.registry.resolve(ctx.message?.reply_to_message?.message_id);
      if (!s?.pane) return ctx.reply("No tmux pane known for that session.");
      await sendKeys(s.pane, ["Escape"]);
      await ctx.reply(`⎋ Sent Escape to ${Registry.label(s)}`);
    });

    bot.command("keys", async (ctx) => {
      const s = this.registry.resolve(ctx.message?.reply_to_message?.message_id);
      if (!s?.pane) return ctx.reply("No tmux pane known for that session.");
      const keys = ctx.match.split(/\s+/).filter(Boolean);
      if (!keys.length) return ctx.reply("Usage: /keys Down Enter");
      await sendKeys(s.pane, keys);
      await ctx.reply(`⌨️ Sent ${keys.join(" ")} to ${Registry.label(s)}`);
    });

    bot.command("away", async (ctx) => {
      const arg = ctx.match.trim().toLowerCase();
      if (arg !== "on" && arg !== "off") return ctx.reply(`Away mode is ${loadState().away ? "ON" : "OFF"}. Use /away on|off`);
      saveState({ away: arg === "on" });
      if (arg === "off") this.releaseAll();
      await ctx.reply(`Away mode ${arg.toUpperCase()}.`);
    });

    bot.command("shot", async (ctx) => {
      const s = this.registry.resolve(ctx.message?.reply_to_message?.message_id);
      const url = ctx.match.trim() || s?.lastUrl;
      if (!url) return ctx.reply("Usage: /shot <url or port>, e.g. /shot 3000");
      const full = /\s--full\b/.test(` ${url}`);
      const target = url.replace(/\s*--full\b/, "").trim();
      await ctx.replyWithChatAction("upload_photo");
      try {
        const png = await captureUrl(target, full);
        await this.sendPhoto(s, png, target);
      } catch (e: any) {
        await ctx.reply(`Screenshot failed: ${e.message}`);
      }
    });

    bot.on("callback_query:data", async (ctx) => {
      const [kind, id, choice] = ctx.callbackQuery.data.split(":");
      if (kind !== "ap") return ctx.answerCallbackQuery();
      const p = this.pending.get(id);
      if (!p) return ctx.answerCallbackQuery({ text: "This request is no longer pending." });
      this.pending.delete(id);
      const session = this.registry.sessions.get(p.sessionId);
      if (choice === "s" && session) session.alwaysAllow.add(p.toolName);
      const allow = choice === "a" || choice === "s";
      p.resolve(allow ? { decision: "allow" } : { decision: "deny" });
      this.finishApproval(
        p.messageId,
        session,
        p.html,
        choice === "s" ? `✅ Approved (always for ${p.toolName})` : allow ? "✅ Approved" : "❌ Denied",
      );
      await ctx.answerCallbackQuery({ text: allow ? "Approved" : "Denied" });
    });

    // Plain text (and unknown slash commands like /compact) → typed into Claude's pane.
    bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      const replyTo = ctx.message.reply_to_message?.message_id;

      // A text reply to an approval prompt = deny with that reason.
      if (replyTo !== undefined) {
        for (const [id, p] of this.pending) {
          if (p.messageId !== replyTo) continue;
          this.pending.delete(id);
          p.resolve({ decision: "deny", message: `User replied via Telegram: ${text}` });
          this.finishApproval(p.messageId, this.registry.sessions.get(p.sessionId), p.html, `❌ Denied: ${text}`);
          return;
        }
      }

      const s = this.registry.resolve(replyTo);
      if (!s?.pane) return ctx.reply("No Claude session with a tmux pane is known yet. Start claude inside tmux.");
      try {
        await sendText(s.pane, text);
        const msg = await ctx.reply(`↩️ Sent to ${Registry.label(s)}`);
        this.registry.recordMessage(msg.message_id, s.id);
      } catch (e: any) {
        await ctx.reply(`Failed to send to pane ${s.pane}: ${e.message}`);
      }
    });
  }

  async start(): Promise<void> {
    await this.bot.api
      .setMyCommands([
        { command: "status", description: "List Claude sessions" },
        { command: "tail", description: "Show the last lines of the pane" },
        { command: "shot", description: "Screenshot a URL / port" },
        { command: "esc", description: "Interrupt Claude (Escape)" },
        { command: "keys", description: "Send raw tmux keys" },
        { command: "away", description: "Toggle away mode" },
        { command: "help", description: "Help" },
      ])
      .catch(() => {});
    void this.bot.start({ onStart: (me) => console.log(`[nudge] bot @${me.username} polling`) });
  }
}
