---
description: On a new machine, compare the manifest to what is installed, show a step-by-step plan for this OS, ask before each install, then run the health check.
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Set this machine up from synchrobuilder.json.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" setup --plan
2. Show the user the complete plan for this operating system. Ask whether to proceed.
3. Only then run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" setup
   It asks before each install step. Relay each question to the user and answer through the command's prompts; never pass --yes unless the user explicitly asked for unattended mode.
4. Report the health check result with the evidence the command prints.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
