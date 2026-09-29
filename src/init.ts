import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { CONFIG_PATH, loadConfig, saveConfig } from "./config.js";

async function tg(token: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

export async function init(opts: { token?: string } = {}): Promise<void> {
  const existing = loadConfig();
  const rl = opts.token ? null : createInterface({ input: process.stdin, output: process.stdout });
  try {
    let answer = opts.token?.trim() ?? "";
    if (rl) {
      console.log("Create a bot with @BotFather in Telegram (/newbot) and paste its token.");
      answer = (await rl.question(`Bot token${existing ? " (enter to keep current)" : ""}: `)).trim();
    }
    const botToken = answer || existing?.botToken;
    if (!botToken) throw new Error("A bot token is required.");

    const me = await tg(botToken, "getMe");
    console.log(`✔ Bot @${me.username}`);

    // Drop any old updates so we only pick up a fresh /start.
    await tg(botToken, "deleteWebhook", { drop_pending_updates: true });
    console.log(`Now open https://t.me/${me.username} and send /start …`);

    let chatId: number | undefined;
    let offset = 0;
    const deadline = Date.now() + 3 * 60_000;
    while (!chatId && Date.now() < deadline) {
      const updates: any[] = await tg(botToken, "getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (msg?.chat?.type === "private" && typeof msg.text === "string" && msg.text.startsWith("/start")) {
          chatId = msg.chat.id;
          console.log(`✔ Linked to ${msg.from?.username ? "@" + msg.from.username : msg.chat.id}`);
        }
      }
    }
    if (!chatId) throw new Error("Timed out waiting for /start.");
    await tg(botToken, "getUpdates", { offset, timeout: 0 }); // acknowledge

    saveConfig({
      botToken,
      chatId,
      port: existing?.port ?? 47823,
      secret: existing?.secret ?? randomBytes(24).toString("hex"),
    });
    await tg(botToken, "sendMessage", { chat_id: chatId, text: "🛰 Nudge linked to this chat." });
    console.log(`✔ Saved ${CONFIG_PATH} (mode 600)\n\nNext: nudge install`);
  } finally {
    rl?.close();
  }
}
