---
description: Scan the project for OS-specific assumptions and report each finding with a rule id, severity, location and fix.
argument-hint: "[path] [--strict]"
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Audit the project for OS-specific assumptions.

1. Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" audit $ARGUMENTS --json
2. Read the JSON report it prints (a path to the report file is also printed). Summarize the score and the findings grouped by severity. For each finding give the rule id, the file and line, the plain-English explanation and the suggested fix, exactly as reported. Do not invent findings or fixes.
3. If the user asked for a plain report instead of JSON, run it again without --json and show the output.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
