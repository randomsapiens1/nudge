# Nudge

A lightweight bridge between Claude Code (running in tmux on your Mac) and Telegram.
Claude does the work locally; Nudge only reaches your phone while **away mode** is on.

- ✅ End-of-turn summaries and 🔔 "needs your input" notifications
- 🔐 Approve / Deny tool permissions with buttons (reply with text to deny with a reason)
- ↩️ Reply in Telegram → text is typed into Claude's tmux pane
- 🖼 Screenshots: auto-forwarded from Claude in Chrome, `nudge shot <url>`, or `/shot 3000` from your phone

## Setup

```sh
npm install && npm run build && npm link   # puts `nudge` on PATH
nudge init --token <BOTFATHER_TOKEN>       # then send /start to your bot
nudge install --launchd                    # hooks + /nudge command + auto-start daemon
```

(Without `--launchd`, run `nudge daemon` in a spare tmux window.)

## Use

```sh
tmux new -s work
claude
> /nudge on      # stepping away
> /nudge off     # back
```

Telegram commands: `/status`, `/tail [n]`, `/shot <url|port> [--full]`, `/esc`, `/keys Down Enter`, `/away on|off`.
Plain text (or a reply to a session's message) goes to that session's pane; unknown slash commands like `/compact` are passed through too.

## Safety

- If the daemon is down, away mode is off, or an approval times out (~10 min), hooks do nothing and Claude shows its normal local prompt. Nudge never auto-approves.
- Only the linked chat id is obeyed. Token + secret live in `~/.nudge/config.json` (0600); the local API binds to 127.0.0.1 and requires the secret.
- `nudge uninstall` removes the hooks (a backup of `settings.json` is kept on every change).
