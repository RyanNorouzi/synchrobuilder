---
description: Write a structured handoff (done, files changed, interfaces changed, decisions, blockers, next steps, who it is for) from this session's local events.
argument-hint: "[handle] [--draft] [--confirm <draft id>]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Write a handoff for teammates from this session's local events.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" handoff --draft
2. Show the draft. Ask the user to correct or add anything (done, files changed, interfaces changed, decisions, blockers, next steps, who it is for).
3. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" handoff --confirm <draft id> with any edits the user gave, as the command's options describe.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
