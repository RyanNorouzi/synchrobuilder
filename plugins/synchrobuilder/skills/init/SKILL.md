---
description: Inspect the project and write `synchrobuilder.json`, the manifest other machines use to set the project up.
argument-hint: "[--refresh]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Write synchrobuilder.json, the manifest that lets a teammate set this project up on another machine.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" init $ARGUMENTS
2. Show the user the manifest it wrote (or the diff, with --refresh) and ask them to confirm anything marked "unsure" in the output. Do not fill in guesses yourself.
3. Remind them that environment variables are stored as names and descriptions only, never values.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
