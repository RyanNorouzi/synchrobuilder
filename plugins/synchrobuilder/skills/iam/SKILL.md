---
description: Override the handle derived from your git email for this checkout on this machine.
argument-hint: "<handle>"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Set the user's Synchrobuilder handle for this checkout on this machine.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" iam $ARGUMENTS
Report the result.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
