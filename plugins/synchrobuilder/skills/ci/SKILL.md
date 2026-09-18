---
description: Generate a GitHub Actions workflow that installs, builds, tests and health-checks the project on ubuntu, macos and windows, plus a README badge.
argument-hint: "[--write]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Generate a GitHub Actions workflow that proves the project runs on ubuntu, macos and windows.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" ci $ARGUMENTS
2. Show the generated workflow path and the README badge snippet it printed. Explain that the badge only says "verified" when the workflow passes.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
