---
description: A minimal shared task list with dependencies; a teammate's Claude can pick up the next unclaimed, unblocked task.
argument-hint: "[list|add|take|done|next] [...]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Use the shared task board: add, take, done, next.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" board $ARGUMENTS
Relay the output. When the user asks what to work on, run "board next" and offer the first unclaimed, unblocked task; do not take it until they agree.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
