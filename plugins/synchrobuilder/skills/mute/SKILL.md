---
description: Silence the guard hook for this project.
argument-hint: "[on|off]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Silence or re-enable the Synchrobuilder guard hook for this checkout.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" mute $ARGUMENTS
Report the result in one line.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
