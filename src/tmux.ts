import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// launchd starts the daemon with a minimal PATH, so look in the usual Homebrew locations too.
const TMUX =
  process.env.NUDGE_TMUX ??
  ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find((p) => existsSync(p)) ??
  "tmux";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Type literal text into the pane, then press Enter. */
export async function sendText(pane: string, text: string): Promise<void> {
  await run(TMUX, ["send-keys", "-t", pane, "-l", text]);
  await sleep(150); // let the TUI absorb the paste before submitting
  await run(TMUX, ["send-keys", "-t", pane, "Enter"]);
}

/** Send tmux key names (e.g. "Escape", "C-c", "1"). */
export async function sendKeys(pane: string, keys: string[]): Promise<void> {
  await run(TMUX, ["send-keys", "-t", pane, ...keys]);
}

export async function capturePane(pane: string, lines = 40): Promise<string> {
  const { stdout } = await run(TMUX, ["capture-pane", "-p", "-J", "-t", pane, "-S", `-${lines}`]);
  return stdout.replace(/\s+$/, "");
}
