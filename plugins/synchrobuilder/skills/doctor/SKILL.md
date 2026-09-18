---
description: Record a fingerprint of a working machine, or explain why this machine differs from the manifest, most likely cause first.
disable-model-invocation: true
allowed-tools: Bash(node *), PowerShell(node *)
---

Diagnose why this machine differs from the project's manifest and fingerprint, and check what Synchrobuilder itself needs.

Run: node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" doctor $ARGUMENTS
Present the findings in the order printed: most likely cause first, each with the exact fix for this operating system.

Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.
