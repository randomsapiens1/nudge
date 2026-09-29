import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NUDGE_DIR } from "./config.js";

/** Trailing shell comment that marks hook commands owned by Nudge. */
export const MARK = "# nudge";

interface HookSpec {
  event: string;
  matcher?: string;
  timeout: number;
}

export const HOOK_SPECS: HookSpec[] = [
  { event: "PermissionRequest", matcher: "*", timeout: 600 },
  { event: "Notification", timeout: 15 },
  { event: "Stop", timeout: 20 },
  { event: "SessionStart", timeout: 5 },
  { event: "SessionEnd", timeout: 5 },
  { event: "PostToolUse", matcher: "mcp__claude-in-chrome__.*", timeout: 30 },
];

const isOurs = (h: any) => typeof h?.command === "string" && h.command.includes(MARK);

/** Remove any Nudge hooks from a settings object (pure). */
export function removeHooks(settings: any): any {
  const s = structuredClone(settings ?? {});
  if (!s.hooks) return s;
  for (const event of Object.keys(s.hooks)) {
    const groups = (s.hooks[event] as any[])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: any) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0);
    if (groups.length) s.hooks[event] = groups;
    else delete s.hooks[event];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

/** Idempotently add Nudge hooks to a settings object (pure). */
export function mergeHooks(settings: any, commandFor: (event: string) => string): any {
  const s = removeHooks(settings);
  s.hooks ??= {};
  for (const spec of HOOK_SPECS) {
    const group: any = { hooks: [{ type: "command", command: commandFor(spec.event), timeout: spec.timeout }] };
    if (spec.matcher) group.matcher = spec.matcher;
    (s.hooks[spec.event] ??= []).push(group);
  }
  return s;
}

const CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));
const TEMPLATES = join(dirname(CLI_PATH), "..", "templates");
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const SETTINGS = join(CLAUDE_DIR, "settings.json");
const PLIST_LABEL = "com.nudge.daemon";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);

// Absolute node + script path: hooks must not depend on the hook shell's PATH.
const hookCommand = (event: string) => `"${process.execPath}" "${CLI_PATH}" hook ${event} ${MARK}`;

function readSettings(): any {
  if (!existsSync(SETTINGS)) return {};
  return JSON.parse(readFileSync(SETTINGS, "utf8"));
}

function writeSettings(next: any): string | null {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  let backup: string | null = null;
  if (existsSync(SETTINGS)) {
    backup = `${SETTINGS}.nudge-bak-${Date.now()}`;
    copyFileSync(SETTINGS, backup);
  }
  writeFileSync(SETTINGS, JSON.stringify(next, null, 2) + "\n");
  return backup;
}

function installCommands(): string[] {
  const dir = join(CLAUDE_DIR, "commands");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "nudge.md");
  writeFileSync(path, readFileSync(join(TEMPLATES, "nudge.md"), "utf8"));
  return [path];
}

function installLaunchd(): void {
  const plist = readFileSync(join(TEMPLATES, `${PLIST_LABEL}.plist`), "utf8")
    .replaceAll("__NODE__", process.execPath)
    .replaceAll("__CLI__", CLI_PATH)
    .replaceAll("__LOG__", join(NUDGE_DIR, "daemon.log"))
    .replaceAll("__PATH__", `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`);
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(NUDGE_DIR, { recursive: true });
  writeFileSync(PLIST_PATH, plist);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${PLIST_LABEL}`], { stdio: "ignore" });
  } catch {
    /* not loaded yet */
  }
  execFileSync("launchctl", ["bootstrap", domain, PLIST_PATH]);
}

export function install(opts: { launchd?: boolean }): void {
  const backup = writeSettings(mergeHooks(readSettings(), hookCommand));
  console.log(`✔ Hooks merged into ${SETTINGS}${backup ? ` (backup: ${backup})` : ""}`);
  for (const p of installCommands()) console.log(`✔ Slash command ${p}`);
  if (opts.launchd) {
    installLaunchd();
    console.log(`✔ launchd agent loaded (${PLIST_PATH}); logs: ${join(NUDGE_DIR, "daemon.log")}`);
  } else {
    console.log("• Start the daemon with: nudge daemon   (or re-run with --launchd to auto-start)");
  }
  console.log("\nNext: run `claude` inside tmux, then `/nudge on` before you step away.");
  console.log("Note: the /nudge slash command calls `nudge` from PATH (npm link / npm i -g).");
}

export function uninstall(): void {
  const backup = writeSettings(removeHooks(readSettings()));
  console.log(`✔ Nudge hooks removed from ${SETTINGS}${backup ? ` (backup: ${backup})` : ""}`);
  if (existsSync(PLIST_PATH)) {
    try {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${PLIST_LABEL}`], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
    console.log(`• launchd agent unloaded (plist left at ${PLIST_PATH})`);
  }
}
