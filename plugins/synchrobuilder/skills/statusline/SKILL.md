---
description: Offer to add team presence to your Claude Code status line.
argument-hint: "[install|remove] [--plan] [--yes]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Offer to add team presence to the Claude Code status line.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" statusline $ARGUMENTS --plan
2. Show the exact settings change it prints and warn that it replaces any existing status line. Ask the user to confirm.
3. Only after an explicit yes: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" statusline install --yes

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
