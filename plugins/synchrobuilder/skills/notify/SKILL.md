---
description: Send a short message that lands in that teammate's next prompt, wrapped as untrusted teammate data.
argument-hint: "<handle> <message>"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Send a short message to a teammate. It lands in their next prompt, labelled as untrusted teammate data.

The first word of the arguments is the handle; the rest is the message.
Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" notify $ARGUMENTS
Report whether it was queued. Messages are capped at 400 characters and pass secret redaction.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
