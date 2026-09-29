#!/usr/bin/env node
import { Command } from "commander";
import { callDaemon } from "./client.js";
import { loadConfig, loadState, saveState } from "./config.js";

const program = new Command()
  .name("nudge")
  .description("Bridge Claude Code (in tmux) to Telegram: progress, replies, approvals, screenshots.");

program
  .command("init")
  .description("Link a Telegram bot and chat")
  .option("--token <token>", "bot token from @BotFather (otherwise prompted)")
  .action(async (opts) => (await import("./init.js")).init(opts));

program
  .command("install")
  .description("Install Claude Code hooks and the /nudge slash command")
  .option("--launchd", "also run the daemon automatically via launchd")
  .action(async (opts) => (await import("./install.js")).install(opts));

program
  .command("uninstall")
  .description("Remove Nudge hooks from Claude Code settings")
  .action(async () => (await import("./install.js")).uninstall());

program
  .command("daemon")
  .description("Run the Telegram bridge (foreground)")
  .action(async () => (await import("./daemon/index.js")).runDaemon());

program
  .command("hook <event>")
  .description("Internal: invoked by Claude Code hooks")
  .action(async (event: string) => {
    try {
      await (await import("./hook.js")).runHook(event);
    } catch {
      /* never break Claude */
    }
    process.exit(0);
  });

program
  .command("away [mode]")
  .description("Show or set away mode: on | off | toggle")
  .action(async (mode?: string) => {
    const config = loadConfig();
    const current = loadState().away;
    const m = (mode ?? "").trim().toLowerCase();
    let next = current;
    if (m === "on") next = true;
    else if (m === "off") next = false;
    else if (m === "toggle") next = !current;
    else if (m && m !== "status") {
      console.error("Usage: nudge away [on|off|toggle|status]");
      process.exit(1);
    }
    if (next !== current) saveState({ away: next });
    if (!config) {
      console.log(`Nudge away mode: ${next ? "ON" : "OFF"} — but not configured; run \`nudge init\`.`);
      return;
    }
    const daemon =
      next !== current
        ? await callDaemon(config, "/away", { away: next })
        : await callDaemon(config, "/health", {});
    console.log(
      `Nudge away mode: ${next ? "ON" : "OFF"} (daemon: ${daemon ? "connected" : "NOT running — start it with `nudge daemon`"})`,
    );
  });

program
  .command("shot [url]")
  .description("Screenshot a URL (or port) and send it to Telegram")
  .option("--full", "full-page screenshot")
  .option("-c, --caption <text>", "caption")
  .action(async (url: string | undefined, opts: { full?: boolean; caption?: string }) => {
    const config = loadConfig();
    if (!config) {
      console.error("Not configured; run `nudge init`.");
      process.exit(1);
    }
    if (!url) {
      console.error("Usage: nudge shot <url|port> [--full] [-c caption]");
      process.exit(1);
    }
    const { captureUrl } = await import("./shot.js");
    const png = await captureUrl(url, !!opts.full);
    const ok = await callDaemon(
      config,
      "/photo",
      { pane: process.env.TMUX_PANE ?? null, url, caption: opts.caption ?? url, image: png.toString("base64") },
      30_000,
    );
    console.log(ok ? `✔ Screenshot of ${url} sent to Telegram` : "✘ Daemon not reachable — is `nudge daemon` running?");
    if (!ok) process.exit(1);
  });

program
  .command("status")
  .description("Show configuration and daemon status")
  .action(async () => {
    const config = loadConfig();
    console.log(`Configured: ${config ? `yes (chat ${config.chatId}, port ${config.port})` : "no — run `nudge init`"}`);
    console.log(`Away mode:  ${loadState().away ? "ON" : "OFF"}`);
    if (config) console.log(`Daemon:     ${(await callDaemon(config, "/health", {})) ? "running" : "not running"}`);
  });

program.parseAsync().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
