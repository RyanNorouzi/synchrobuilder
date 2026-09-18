# Where the brief and the docs disagree

The brief says the docs win. This file lists every place the two differ, what
the docs actually say (with the raw-file line so you can check), and what we
propose instead. Line numbers refer to the raw Markdown snapshots described in
`README.md`; page notes in this directory carry the full quotes.

## 1. Shorter command prefix or aliases (`/sb:audit`)

- Brief: asks whether a plugin can expose a shorter prefix or aliases.
- Docs: the prefix is always the plugin's manifest `name`; `displayName` is
  "Not used for namespacing or lookup"; there is no alias field anywhere in
  the plugin manifest, skill frontmatter or marketplace entry
  (plugins-reference.md L500-L502, L535; skills.md L375-L389; searched
  "alias" in every page). Two things soften this:
  - "The bare `/fancy` also invokes the skill unless another command already
    uses that name" (skills.md L389). So `/audit`, `/fix`, `/setup`, `/ci`,
    `/claim`, `/notify`, `/handoff`, `/iam`, `/mute` work as typed, because
    nothing else owns those names. `/init`, `/doctor`, `/status` and
    `/tasks` are taken by built-ins (commands.md), so those four need
    different names or the full form.
  - Since v2.1.236 the `/` menu highlights a command when the typed letters
    match "a word within" its name, ignoring `:`, `_` and `-`
    (commands.md L170), so typing `/audit` and pressing Enter reaches
    `/synchrobuilder:audit` even where the bare form is ambiguous.
- Proposal: keep the plugin name `synchrobuilder`; keep every command a
  single short word; rename the four that clash (`init` → `manifest`,
  `doctor` → `diagnose`, `status` → `team`, `tasks` → `board`), and document
  the bare short forms on the Commands page. The only way to get a literal
  `/sb:` prefix is to name the plugin `sb`; we recommend against it because
  the install id and every mention would become `sb@synchrobuilder`, which
  is confusing, and the name is immutable after release (the official
  marketplace README says so). A second tiny alias plugin named `sb` is
  possible (it would symlink to the main plugin's skills inside the same
  marketplace, which the docs allow), but doubles the install and support
  surface. Owner's call: see PLAN.md open question 1.

## 2. `commands/` versus `skills/`

- Brief: layout has `commands/` for slash commands and `skills/` for
  auto-activating skills.
- Docs: "Use `skills/` for new plugins"; `commands/` is the legacy flat-file
  layout (plugins.md L177; skills.md L16, L131). A user-only command is a
  skill with `disable-model-invocation: true` (skills.md L505).
- Proposal: every command is `skills/<name>/SKILL.md`. Do not set
  `name: synchrobuilder:audit` in frontmatter: on v2.1.216 to v2.1.245 the
  prefix is doubled (skills.md L389). We drop the `commands/` directory.

## 3. Status line presence

- Brief: show presence in the status line "if the docs confirm plugins can
  do that".
- Docs: a plugin's `settings.json` supports only `agent` and
  `subagentStatusLine` (plugins.md L269, L279; plugins-reference.md L955).
  The main `statusLine` comes only from user, project, local or managed
  settings (settings-reference.md L3378), is a single object with no merge,
  and its command "runs in a shell", through Git Bash or PowerShell on
  Windows (statusline.md L56, L1033).
- Proposal: no plugin-shipped status line. `/synchrobuilder:setup` (or a
  dedicated `/synchrobuilder:statusline`) offers, with explicit consent and
  after showing the exact JSON, to write a `statusLine` entry into the
  user's settings that runs `node <absolute path>/statusline.mjs`, and warns
  that it replaces any existing status line. Because the path is absolute
  and the plugin cache path changes on every version, the entry must point
  at a stable copy under `${CLAUDE_PLUGIN_DATA}` that the plugin refreshes on
  SessionStart. Presence still shows in `/synchrobuilder:team` regardless.

## 4. "No shell anywhere" versus monitors, status line and skill injection

- Brief: no bash, PowerShell or cmd in shipped code; everything is
  `node "<path>"`.
- Docs: hooks in exec form spawn `node` "with no shell involved"
  (hooks.md L459, L468-L470), which fully satisfies the rule and is the
  documented pattern. But three surfaces are shell-launched by Claude Code
  itself and cannot be otherwise: monitor commands "run through a shell"
  (plugins-reference.md L337), the status line command "runs in a shell"
  (statusline.md L56), and dynamic context in skills (`!` injection) "runs
  the commands through the Bash tool or the PowerShell tool"
  (skills.md L645-L649).
- Proposal: our shipped programs are Node; where Claude Code insists on a
  shell string, the string is the single token `node "<path>"` with a
  forward-slash path and nothing else (no pipes, no variables beyond the
  documented placeholders). We do not use `!` injection at all. This is
  recorded as an accepted exception in ADR-003.

## 5. Plugin monitors for the sync loop and urgent messages

- Brief: evaluate monitors as the way to run the background loop and deliver
  urgent teammate messages.
- Docs: monitors deliver "every stdout line to Claude as a notification"
  (plugins-reference.md L293) and run for the session lifetime, but they are
  experimental (L319), run only in interactive CLI sessions and are skipped
  where the Monitor tool is unavailable (L295), which includes Bedrock,
  Vertex, Foundry, and any session with `DISABLE_TELEMETRY` or
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set (tools-reference.md L345).
  They keep running after the plugin is disabled mid-session (L339) and do
  not load for project-scope skills-dir plugins (L399).
- Proposal: monitors are an optional accelerator, never the baseline. The
  baseline sync loop is a detached Node worker started from `SessionStart`
  (experiment E5) that exits when the session's `CLAUDE_PID` disappears;
  delivery to Claude is at the next hook (SessionStart, UserPromptSubmit,
  PreToolUse, PostToolUse) from the local cache. A monitor, when available,
  adds "sooner" delivery by printing one line per urgent event. ADR-001
  records this; PLAN.md lists the monitor behavior as a Phase 5 experiment.

## 6. Handoff "when a session ends"

- Brief: write the handoff at session end.
- Docs: SessionEnd hooks have a 1.5 s default budget, and "Timeouts set on
  plugin-provided hooks don't raise the budget" (hooks.md L3348-L3350).
  Whether SessionEnd fires on a killed terminal is not stated.
- Proposal: the handoff is pre-staged incrementally on every `Stop` hook
  (which carries `last_assistant_message`, and has a generous budget) into
  a local journal; `SessionEnd` only marks the session closed and hands the
  push to the detached worker. A session that dies without SessionEnd still
  produces a handoff from the journal at the next start.

## 7. "Tells Claude in the same turn" (guard) and "next prompt" (notify)

- Brief: guard reports in the same turn; notify lands in the next prompt.
- Docs: synchronous `PostToolUse` `additionalContext` is placed next to the
  tool result and read "on the next model request" (hooks.md L1000, L1017),
  which is inside the same user turn. Async hook output "is delivered on
  the next conversation turn" (hooks.md L3760). `UserPromptSubmit` context
  lands alongside the prompt and "Neither channel produces a visible
  transcript entry" (hooks.md L1371).
- Proposal: guard and collision hooks are synchronous (never `async`).
  Because hook context is invisible to the human, notify also returns a
  short `systemMessage` ("Synchrobuilder: 1 message from bob") so the person
  sees that something arrived, and the wrapped message goes to Claude.

## 8. Collision "warn or ask"

- Brief: warn or ask before editing a claimed file.
- Docs: `permissionDecision: "ask"` shows `permissionDecisionReason` "to the
  user but not Claude" and forces a prompt even in auto mode
  (hooks.md L1809, L1819); `additionalContext` goes to Claude, not the user
  (L1000). A timed-out PreToolUse hook does not block (L873).
- Proposal: "warn" mode returns `additionalContext` plus `systemMessage`
  (both audiences); "ask" mode returns `ask` with a reason and the same
  `additionalContext`. Teams opt into "ask" in `.synchrobuilder/config.json`;
  the default is warn, as the brief requires.

## 9. Mute

- Brief: `/synchrobuilder:mute` silences the guard per project.
- Docs: "There is no way to disable an individual hook" (hooks.md L734).
- Proposal: mute is a flag file under `.git/synchrobuilder/` that every
  hook checks first; the hook still runs but exits with no output.

## 10. Consent and `extraKnownMarketplaces`

- Brief: consent before anything that changes a machine.
- Docs: with `extraKnownMarketplaces` in a repo's `.claude/settings.json`,
  "Claude Code adds these marketplaces without a further prompt" once the
  folder is trusted (discover-plugins.md L531).
- Proposal: `/synchrobuilder:init` never writes `extraKnownMarketplaces` or
  `enabledPlugins` by default; it offers to, shows the exact JSON, and
  explains that teammates will be prompted only by the trust dialog. The
  install page recommends the explicit two commands instead.

## 11. Marketplace cloning and auth

- Docs: the `owner/repo` shorthand clones over SSH unless
  `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` is set: "Set to `1` to clone GitHub
  `owner/repo` shorthand sources over HTTPS instead of SSH ... Useful in CI
  runners, containers, or any environment without a configured SSH key for
  `github.com`" (env-vars.md L334). Interactive SSH prompts are suppressed,
  so a missing key or unknown host fails rather than asks
  (plugin-marketplaces.md L786). Third-party marketplaces have auto-update
  off by default (discover-plugins.md L516).
- Proposal: the install page leads with the git-URL form
  `https://github.com/<owner>/<repo>.git`, which needs no SSH key, and shows
  the `owner/repo` shorthand as the alternative for people with keys. Which
  form to lead with is confirmed in Phase 1 by running both on a machine
  without an SSH key. The page also shows the update command, since updates
  are manual for third-party marketplaces.

## 12. `packages/core`, `packages/hooks`, `packages/cli` and `dist/`

- Brief: shared code in `packages/*`, bundled into `plugins/synchrobuilder/dist/`.
- Docs: a plugin cannot reference files outside its own directory, and
  files above the plugin root are not copied into the cache
  (plugins-reference.md L860-L866). A `package.json` plus npm lockfile at
  the plugin root triggers an automatic `npm ci --ignore-scripts` (L831-L854).
- Proposal: one source tree inside `plugins/synchrobuilder/` with no build
  step and no lockfile (ADR-003). Tests live in `tests/` outside the plugin.

## 13. `MultiEdit`

- Brief: not named, but Relay's matcher includes it.
- Docs: no tool named `MultiEdit` exists (searched hooks.md and
  tools-reference.md).
- Proposal: matchers use `Edit|Write|NotebookEdit` only.

## 14. Hook latency

- Brief: under 50 ms for pre-edit and prompt hooks.
- Docs: no latency guidance; defaults are 600 s, 30 s for UserPromptSubmit.
- Not a conflict. Experiment E4 shows about 20 ms end to end on a laptop
  for a Node hook, so the budget is self-imposed and achievable. The
  Windows number is unknown until CI runs.

## 15. Things the brief expects that the docs simply do not offer

- A way for a plugin to push a message to Claude while it is idle, other
  than monitors (above) and channels. Channels need `--channels` on every
  launch and, outside the official marketplace,
  `--dangerously-load-development-channels` with a warning
  (channels-reference.md L141, L777-L779). We do not use channels in v1.
- A per-plugin hook off-switch (see 9).
- A plugin-declared runtime requirement ("needs Node 20"): plugin
  `dependencies` name other plugins only (plugin-dependencies.md L9-L46).
  `/synchrobuilder:diagnose` checks it at runtime and the install page states
  it.

## 16. State under `~/.synchrobuilder/`, not `.git/synchrobuilder/`

- Brief: operate the hidden clone "under `.git/synchrobuilder/`".
- Docs and panel: nothing in the docs forbids it, but the design judges
  showed that writing inside the user's `.git` fails on read-only or
  ACL-restricted repositories and complicates linked worktrees, while the
  plugin's persistent data directory is deleted on uninstall and not
  exported to Bash-tool commands (plugins-reference.md L721, L803).
- Proposal: the plugin owns `~/.synchrobuilder/` (override with
  `SYNCHROBUILDER_HOME`): hidden bare repos per remote, per-checkout state,
  logs. The user's repository is never written to. Hooks find the right
  directory by reading `.git/config` and the `gitdir`/`commondir` files
  (ADR-001 §6). `npx synchrobuilder clean` removes the directory.
