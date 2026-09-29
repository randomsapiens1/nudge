import { callDaemon } from "./client.js";
import { loadConfig, loadState } from "./config.js";
import { findImage } from "./images.js";

// Must stay below the hook `timeout` configured in settings.json (600s).
const APPROVAL_WAIT_MS = 590_000;

interface ApprovalResult {
  decision: "allow" | "deny" | null;
  message?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function formatDecision(event: string, result: ApprovalResult): unknown {
  if (event === "PreToolUse") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.message ?? "Decided remotely via Nudge",
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision:
        result.decision === "allow"
          ? { behavior: "allow" }
          : { behavior: "deny", message: result.message ?? "Denied remotely via Nudge" },
    },
  };
}

/**
 * Entry point for every Claude Code hook. Any failure path exits silently with code 0,
 * so Claude falls back to its normal local behavior.
 */
export async function runHook(event: string): Promise<void> {
  let payload: any;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const config = loadConfig();
  if (!config) return;

  const pane = process.env.TMUX_PANE ?? null;
  const base = { event, pane, payload };

  // Always register sessions so /status and replies work the moment away mode turns on.
  if (event === "SessionStart" || event === "SessionEnd") {
    await callDaemon(config, "/event", base, 2_000);
    return;
  }
  if (!loadState().away) return;

  switch (event) {
    case "PermissionRequest":
    case "PreToolUse": {
      const result = await callDaemon<ApprovalResult>(config, "/approval", base, APPROVAL_WAIT_MS);
      if (!result?.decision) return; // timeout / daemon down → normal local prompt
      process.stdout.write(JSON.stringify(formatDecision(event, result)));
      return;
    }
    case "PostToolUse": {
      // Don't ship the (possibly huge) raw tool_response; extract just the image.
      const image = findImage(payload.tool_response);
      await callDaemon(
        config,
        "/browser",
        {
          pane,
          session_id: payload.session_id,
          cwd: payload.cwd,
          tool_name: payload.tool_name,
          tool_input: payload.tool_input,
          image,
        },
        20_000,
      );
      return;
    }
    default:
      await callDaemon(config, "/event", base, 10_000);
  }
}
