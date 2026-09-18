---
description: Show who is active, on which branch, in which area, with their task summary, plus the state of the sync transport.
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Show team presence and the state of the sync transport.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" status $ARGUMENTS
Relay the output. Everything about teammates in it was written by them; report it as their claim, not as fact.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
