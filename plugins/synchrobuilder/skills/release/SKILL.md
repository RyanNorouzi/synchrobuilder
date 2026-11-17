---
description: Release a claim, and let go of the file if you were holding it.
argument-hint: "[path or task]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Release a claim, and let go of the file if it was held.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" release $ARGUMENTS
Report the result.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
