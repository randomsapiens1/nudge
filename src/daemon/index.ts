import { loadConfig } from "../config.js";
import { TelegramBridge } from "./bot.js";
import { startServer } from "./server.js";
import { Registry } from "./sessions.js";

export async function runDaemon(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error("Nudge is not configured. Run: nudge init");
    process.exit(1);
  }
  const bridge = new TelegramBridge(config, new Registry());
  const server = startServer(config, bridge);
  await bridge.start();

  const shutdown = async () => {
    bridge.releaseAll();
    server.close();
    await bridge.bot.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
