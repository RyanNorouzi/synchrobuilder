# Command reference

Source of truth for the website's Commands page (`site/build.mjs` reads this
file). Every command here is **planned**: Phase 0 is complete and no plugin
code exists yet. When a command ships, its status changes to `available`
and the build also cross-checks it against the plugin's skill file.

Format: one `##` heading per command, then `- Key: value` lines, then a
paragraph. Keys: Slash, Short form, CLI, Pillar, Phase, Status, Summary.

## audit
- Slash: /synchrobuilder:audit [path] [--strict]
- Short form: /audit
- CLI: npx synchrobuilder audit [path] [--json] [--strict]
- Pillar: Portability
- Phase: 2
- Status: planned
- Summary: Scan the project for OS-specific assumptions and report each finding with a rule id, severity, location and fix.

Reports import-path casing that only works on case-insensitive disks, files whose names differ only by case, Unix-only commands and shell syntax in package scripts, hardcoded absolute or home-directory paths, required shell scripts with no portable equivalent, line-ending problems, executable bits and symlinks, Windows-illegal file names and over-long paths, `python` versus `python3` and virtualenv paths, native or architecture-specific dependencies, and README setup steps that only work on one OS. Prints a readable report, writes a JSON report, and gives a score from 0 to 100. Exits non-zero only with `--strict`, so it can gate CI.

## fix
- Slash: /synchrobuilder:fix [--only ids-or-paths]
- Short form: /fix
- CLI: npx synchrobuilder fix [--dry-run] [--yes] [--only ids-or-paths]
- Pillar: Portability
- Phase: 3
- Status: planned
- Summary: Propose a fix for each fixable audit finding, show the diff, and apply it only after you approve.

Fixers cover import casing, `.gitattributes` line-ending rules, Unix commands in package scripts (replaced with portable Node equivalents), and string path concatenation (replaced with `path.join`). Nothing is applied without consent; the CLI needs `--yes` to apply and `--dry-run` shows the diffs only.

## mute
- Slash: /synchrobuilder:mute [on|off]
- Short form: /mute
- CLI: npx synchrobuilder mute [on|off]
- Pillar: Portability
- Phase: 3
- Status: planned
- Summary: Silence the guard hook for this project.

The guard is a hook that re-audits a file right after Claude writes or edits it and tells Claude, in the same turn, if a new portability problem appeared. It is advisory only. Mute writes a per-checkout flag under `~/.synchrobuilder/`; the hook still runs but prints nothing.

## init
- Slash: /synchrobuilder:init [--refresh] [--team]
- Short form: none (`/init` belongs to Claude Code)
- CLI: npx synchrobuilder init [--refresh] [--team [--yes]]
- Pillar: Portability
- Phase: 4
- Status: planned
- Summary: Inspect the project and write `synchrobuilder.json`, the manifest other machines use to set the project up.

Detects required runtimes with exact versions, the package manager, services such as a database, environment variable names with descriptions (never values), install, migrate, seed and start commands, and a health check. The format is documented on the Manifest page and is not tied to Claude.

## setup
- Slash: /synchrobuilder:setup [--plan]
- Short form: /setup
- CLI: npx synchrobuilder setup [--plan] [--yes] [--json]
- Pillar: Portability
- Phase: 4
- Status: planned
- Summary: On a new machine, compare the manifest to what is installed, show a step-by-step plan for this OS, ask before each install, then run the health check.

Uses the OS's native package manager (winget, Homebrew, apt), pins exact versions, never elevates silently, and ends with a pass or fail plus the evidence.

## doctor
- Slash: /synchrobuilder:doctor [--record]
- Short form: none (`/doctor` belongs to Claude Code)
- CLI: npx synchrobuilder doctor [--record] [--json]
- Pillar: Portability
- Phase: 4
- Status: planned
- Summary: Record a fingerprint of a working machine, or explain why this machine differs from the manifest, most likely cause first.

Also checks the things the plugin itself needs: `node` and `git` on PATH, the plugin's data directory, whether background monitors are available, and whether the sync transport can reach the remote.

## ci
- Slash: /synchrobuilder:ci [--write]
- Short form: /ci
- CLI: npx synchrobuilder ci [--write]
- Pillar: Portability
- Phase: 4
- Status: planned
- Summary: Generate a GitHub Actions workflow that installs, builds, tests and health-checks the project on ubuntu, macos and windows, plus a README badge.

The badge only says "verified" when that workflow passes.

## iam
- Slash: /synchrobuilder:iam <handle>
- Short form: /iam
- CLI: npx synchrobuilder iam <handle>
- Pillar: Multiplayer
- Phase: 5
- Status: planned
- Summary: Override the handle derived from your git email for this checkout on this machine.

Handles normally come from `git config user.email` mapped through the committed `.synchrobuilder/team.json`. No accounts, passwords or tokens.

## status
- Slash: /synchrobuilder:status
- Short form: none (`/status` belongs to Claude Code)
- CLI: npx synchrobuilder status
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Show who is active, on which branch, in which area, with their task summary, plus the state of the sync transport.

Also shows a friendly, non-blocking note once a week when more than three people were active in the last 30 days, pointing at the pricing page. Nothing is ever disabled.

## claim
- Slash: /synchrobuilder:claim <path or task>
- Short form: /claim
- CLI: npx synchrobuilder claim <path or task>
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Tell teammates you are working on a path or task.

Before a teammate's Claude edits a file you claimed or are actively editing, it is warned (or asked, if that team opted in), at most once per file per 30 minutes, with who, which branch, and how long ago. Warnings never block.

## release
- Slash: /synchrobuilder:release [path or task]
- Short form: /release
- CLI: npx synchrobuilder release [path or task]
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Release a claim.

## notify
- Slash: /synchrobuilder:notify <handle> <message>
- Short form: /notify
- CLI: npx synchrobuilder notify <handle> <message>
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Send a short message that lands in that teammate's next prompt, wrapped as untrusted teammate data.

Messages are limited to 400 characters, pass secret redaction before leaving your machine, and are sanitized again on the receiving side.

## board
- Slash: /synchrobuilder:board [list|add|take|done|next] [...]
- Short form: /board
- CLI: npx synchrobuilder board [list|add <title> [--deps a,b]|take <id> [--force]|done <id>|next]
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: A minimal shared task list with dependencies; a teammate's Claude can pick up the next unclaimed, unblocked task.

## handoff
- Slash: /synchrobuilder:handoff [handle] [--draft] [--confirm <draft id>]
- Short form: /handoff
- CLI: npx synchrobuilder handoff [handle] [--draft] [--confirm <draft id> [--task t] [--done "a; b"] [--next ..] [--decisions ..] [--blockers ..] [--interfaces ..] [--files a;b] [--for a,b]]
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Write a structured handoff (done, files changed, interfaces changed, decisions, blockers, next steps, who it is for) from this session's local events.

A handoff is also staged automatically as a session runs and finalized when it ends. It is built by heuristics from local events, never from transcripts and never by an extra model call.

## statusline
- Slash: /synchrobuilder:statusline [install|remove] [--plan] [--yes]
- Short form: /statusline is Claude Code's own; use the full form
- CLI: npx synchrobuilder statusline [install|remove] [--plan] [--yes]
- Pillar: Multiplayer
- Phase: 6
- Status: planned
- Summary: Offer to add team presence to your Claude Code status line.

A plugin cannot set the status line itself, so this command shows the exact settings change, warns that it replaces any status line you already have, and applies it only when you say yes.

## clean
- Slash: none
- Short form: none
- CLI: npx synchrobuilder clean
- Pillar: Both
- Phase: 5
- Status: planned
- Summary: Remove everything Synchrobuilder stored under `~/.synchrobuilder/` on this machine.
