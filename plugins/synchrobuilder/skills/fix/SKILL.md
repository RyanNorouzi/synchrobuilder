---
description: Propose a fix for each fixable audit finding, show the diff, and apply it only after you approve.
argument-hint: "[rule-id]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Propose fixes for portability findings and apply them only with the user's approval.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" fix $ARGUMENTS --dry-run
2. Show the user every proposed diff, grouped by rule id. Ask which ones to apply.
3. Apply only what the user approved: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" fix --yes --only <comma-separated rule ids or file paths>
4. Run the audit again and report the new score.

Never apply a change the user has not approved in this conversation.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
