---
description: Toggle Nudge away mode (Telegram bridge) — on | off | status
argument-hint: on|off|status
allowed-tools: Bash(nudge:*)
---
!`nudge away $ARGUMENTS`

Report the Nudge status above to the user in one short line.

While Nudge away mode is ON, the user is following along on Telegram:
- After you make a visible UI change and check it in a browser (e.g. a localhost dev server), run `nudge shot <url>` (add `--full` for full page, `-c "<what changed>"` for a caption) so they get a screenshot.
- Keep end-of-turn summaries brief and self-contained; they are forwarded to their phone.
