---
description: See who is holding which file right now, let go of one early, or take one over.
argument-hint: "[list|take <path> [--force]|release [path]]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Show who is holding which file right now, let go of one, or take one over.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" lease $ARGUMENTS
Relay the output. Use "take <path> --force" only when the user asked for it in this conversation: it takes a file away from whoever holds it.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
