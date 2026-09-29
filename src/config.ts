import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const NUDGE_DIR = process.env.NUDGE_HOME ?? join(homedir(), ".nudge");
const CONFIG_PATH = join(NUDGE_DIR, "config.json");
const STATE_PATH = join(NUDGE_DIR, "state.json");

export interface Config {
  botToken: string;
  chatId: number;
  port: number;
  secret: string;
}

export interface State {
  away: boolean;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writePrivate(path: string, data: unknown): void {
  mkdirSync(NUDGE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function loadConfig(): Config | null {
  return readJson<Config>(CONFIG_PATH);
}

export function saveConfig(config: Config): void {
  writePrivate(CONFIG_PATH, config);
}

export function loadState(): State {
  return readJson<State>(STATE_PATH) ?? { away: false };
}

export function saveState(state: State): void {
  writePrivate(STATE_PATH, state);
}

export { CONFIG_PATH, STATE_PATH };
