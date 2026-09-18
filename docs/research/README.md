# Phase 0 research

How this directory was produced, so you can judge how much to trust it.

## Sources and method

- On 2026-09-18 we downloaded the raw Markdown of every relevant page from
  `https://code.claude.com/docs/en/<page>.md` (the docs site serves Markdown
  at that path; the index is at `https://code.claude.com/docs/llms.txt`).
  Those pages describe Claude Code up to v2.1.276, the latest version on npm
  that day. The local CLI used for experiments was v2.1.218.
- One reader agent per topic wrote a note with a line-cited quote for every
  claim; an independent verifier agent then re-opened every citation and
  corrected the note in place. The lead re-read the sections that decisions
  depend on (hook handler fields, exec form, monitors, status line, plugin
  caching) directly.
- `experiments.md` records what we ran on a real machine, with commands and
  outputs. `evidence/` holds redacted hook inputs recorded from a real
  headless session; they are the seed fixtures for the hook tests.
- `prior-art-relay-notes.md` describes a third-party project from its own
  repository; everything it says about Claude Code is that project's claim
  unless our own note or experiment confirms it.

## Notes

| File | Covers |
| :-- | :-- |
| `hooks-core.md` | Hook configuration schema, exec vs shell form, input/output contract, exit codes, timeouts, decision tables |
| `hooks-events-session-and-pretool.md` | SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, MessageDisplay, PreToolUse, PermissionRequest |
| `hooks-events-posttool-to-sessionend.md` | PostToolUse through SessionEnd, including Stop, Notification, CwdChanged, FileChanged, PreCompact |
| `hooks-async-prompt-security.md` | Async hooks, prompt and agent hooks, workspace trust, security notes, Windows PowerShell, debugging |
| `plugins-reference.md` | plugin.json schema, layout, environment variables, caching, Node dependencies, monitors, CLI commands, versioning |
| `marketplaces-and-install.md` | marketplace.json schema, plugin sources, the exact install and update commands, team pre-configuration |
| `plugins-guide-hints-relevance.md` | Plugin authoring guide, hints, relevance, plugin dependencies, evals |
| `skills-commands-agents.md` | SKILL.md and command frontmatter, arguments, naming and aliases, menu matching, agent files |
| `mcp-and-channels.md` | Plugin MCP servers and the channels research preview |
| `statusline-and-settings.md` | Status line contract and who can set it, settings files and precedence, plugin-related settings keys |
| `monitors-tools-env.md` | Tool names for matchers, the Monitor tool, PowerShell tool, environment variables |
| `agent-teams-and-cross-session-messaging.md` | Anthropic's single-user multi-session features, and why they do not cross developers |
| `cli-permissions-errors.md` | CLI flags for plugin development and headless testing, permission rules, plugin and hook error catalogue |
| `windows-notes.md` | Every Windows-specific statement in the docs, in one place |
| `prior-art-relay-notes.md` | worklab-studio/claude-code-relay: design, what to learn, what to re-verify |
| `experiments.md` | What we ran ourselves, with output |
| `conflicts.md` | Where the brief and the docs disagree, and what we propose |
| `prior-art.md` | The comparison the brief asked for: Relay and Agent Teams versus Synchrobuilder |

## Evidence files (`evidence/`)

| File | What it is |
| :-- | :-- |
| `hook-inputs-claude-2.1.218-macos.jsonl` | Redacted stdin and environment recorded by the experiment hook in a real headless session (experiment E2) |
| `transport-design-panel.json` | Three transport proposals and two adversarial judgments, including the judges' local git experiments (ADR-001) |
| `teammate-message-threat-model.json` | Surfaces, wrapper, sanitizer spec, limits and 48 injection payloads (ADR-005; seeds the Phase 6 test corpus) |
| `verification-ledger.json` | Per-note tallies from the independent verifiers: citations checked, errors fixed, remaining concerns |
