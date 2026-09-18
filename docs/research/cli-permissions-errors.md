# Claude Code CLI flags, permission rules, and error reference (for Synchrobuilder)

## Source

- https://code.claude.com/docs/en/cli-reference (raw: `cli-reference.md`, 173 lines)
- https://code.claude.com/docs/en/permissions (raw: `permissions.md`, 704 lines)
- https://code.claude.com/docs/en/errors (raw: `errors.md`, 4392 lines)

Fetched 2026-09-18 as raw Markdown from code.claude.com/docs/en/<page>.md. The highest version marker that appears in these three files is v2.1.274 (errors.md L2719), so treat them as describing at least that build; the local CLI used for experiments is 2.1.218 (`claude --version`, 2026-09-18).

Line numbers below refer to the raw files (4-line index preamble, title on line 5). Whitespace inside table cells was collapsed when quoting. Two checklist items are not in these three files; pointer lines in sibling raw files are given for the orchestrator but were not read in full here.

## 1. CLI reference (cli-reference.md)

### 1.1 Flags relevant to plugin development and testing

Preface: "`claude --help` does not list every flag, so a flag's absence from `--help` does not mean it is unavailable." (cli-reference.md L56)

| Flag | What the docs say | Cite |
| --- | --- | --- |
| `--plugin-dir` | Load a plugin from a directory or `.zip`, or several from a folder of plugins, for this session only; one path per flag, repeat for more; folder-of-plugins needs v2.1.265+. Example `claude --plugin-dir ./my-plugin` | L113 |
| `--plugin-url` | Fetch a plugin `.zip` from a URL for this session only | L114 |
| `--settings` | Path to a settings JSON file or inline JSON string; overrides same keys in `settings.json` for the session; omitted keys keep file values; file must be a regular file no larger than 2 MiB | L127 |
| `--setting-sources` | Comma-separated list of `user`, `project`, `local` | L126 |
| `-p`, `--print` | Print response without interactive mode | L115 |
| `--output-format` | `text`, `json`, `stream-json` (print mode) | L109 |
| `--input-format` | `text`, `stream-json` (print mode) | L99 |
| `--include-hook-events` | See verbatim quote below | L97 |
| `--include-partial-messages` | Requires `--print` and `--output-format stream-json` | L98 |
| `--replay-user-messages` | Requires stream-json in and out | L121 |
| `--bare` | See verbatim quote below | L72 |
| `--safe-mode` | Disables CLAUDE.md, skills, plugins, hooks, MCP, commands, agents, status line etc.; "Managed settings policy still applies, including policy-configured hooks, status line, and file-suggestion commands; managed plugins, managed skills, managed CLAUDE.md, and policy-configured MCP servers do not"; sets `CLAUDE_CODE_SAFE_MODE` | L124 |
| `--debug` | "Enable debug mode with optional category filtering, such as `--debug='mcp,startup'` or `--debug='!1p'`. The filter binds only in the `=` form" | L81 |
| `--debug-file <path>` | Write debug logs to a path; implicitly enables debug | L82 |
| `--continue`, `-c` | Most recent conversation in cwd; skips `-p`/SDK sessions unless `claude -p --continue` | L78 |
| `--resume`, `-r` | Resume by ID or name, or picker; accepts absolute `.jsonl` transcript path | L123 |
| `--fork-session` | New session ID when resuming | L91 |
| `--session-id` | Must be a valid UUID | L125 |
| `--name`, `-n` | Display name shown in `/resume` and terminal title; resumable with `--resume <name>` | L106 |
| `--agent` | "Specify an agent for the current session (overrides the `agent` setting)" | L62 |
| `--agents` | Define subagents via JSON; validated at startup (v2.1.242+) | L63 |
| `--permission-mode` | See verbatim quote below | L110 |
| `--permission-prompt-tool` | MCP tool that answers prompts in non-interactive mode; waits for its server up to `MCP_TIMEOUT` (30 s default). "The prompt tool can't approve an MCP tool marked as requiring user interaction: Claude Code converts an `allow` result for one to a deny" (v2.1.199+) | L111 |
| `--permission-prompts` | `host` (default) or `none` (deny instead of asking); v2.1.259+ | L112 |
| `--allowedTools`, `--allowed-tools` | Tools that execute without prompting; uses permission rule syntax; example `"Bash(git log *)" "Bash(git diff *)" "Read"` | L65 |
| `--disallowedTools`, `--disallowed-tools` | Deny rules; bare name removes tool from context (`"*"` all, `"mcp__*"` all MCP); scoped rule such as `Bash(rm *)` denies matching calls only | L84 |
| `--tools` | Restrict built-in tools (`""`, `"default"`, or names); does not affect MCP tools | L135 |
| `--dangerously-skip-permissions` | "Skip permission prompts. Equivalent to `--permission-mode bypassPermissions`." | L80 |
| `--allow-dangerously-skip-permissions` | Adds `bypassPermissions` to the `Shift+Tab` cycle without starting in it | L64 |
| `--disable-slash-commands` | "Disable all skills and commands for this session" | L83 |
| `--init` / `--init-only` / `--maintenance` | Run Setup hooks with `init`/`maintenance` matcher (print mode); `--init-only` runs Setup and `SessionStart` hooks then exits | L95, L96, L101 |
| `--mcp-config` / `--strict-mcp-config` | Load MCP servers from JSON; with `-p` waits for pending servers up to `MCP_TIMEOUT`; strict ignores all other MCP config | L104, L128 |
| `--channels` | "(Research preview) MCP servers whose channel notifications Claude should listen for in this session. Space-separated list of `plugin:<name>@<marketplace>` entries. Requires Anthropic authentication through claude.ai or a Console API key" | L75 |
| `--dangerously-load-development-channels` | Enables channels not on the approved allowlist; accepts `plugin:<name>@<marketplace>` and `server:<name>`; prompts for confirmation | L79 |
| `--add-dir` | Grants file access; "doesn't discover most `.claude/` configuration from these directories" | L60 |
| `--restricted` | Evaluation-harness mode: removes command-running tools and WebFetch, loads only managed settings and `--settings`, refuses `bypassPermissions`; v2.1.248+ | L122 |
| `--verbose` | Full turn-by-turn output | L136 |
| `--version`, `-v` | Version number | L137 |
| `--max-turns`, `--max-budget-usd`, `--json-schema`, `--no-session-persistence` | Print-mode controls | L103, L102, L100, L108 |

Verbatim quotes where wording matters:

> `--include-hook-events` | Include hook lifecycle events in the output stream. `SessionStart` and `Setup` hook events are always included and don't need this flag. Some hook events, such as `Notification`, `SessionEnd`, `PreCompact`, and `PostCompact`, never produce a `hook_started` event, even with this flag. For those events, Claude Code still emits `hook_progress` while a command hook that runs for more than a second produces output, and emits `hook_response` only when a hook that runs in the background finishes. Requires `--output-format stream-json` | `claude -p --output-format stream-json --verbose --include-hook-events "query"` (cli-reference.md L97)

> `--bare` | Minimal mode: skip auto-discovery of hooks, skills, custom commands, subagents, plugins, MCP servers, auto memory, and CLAUDE.md so scripted calls start faster. Skills in a directory you pass with `--add-dir` still load. Claude has access to Bash, file read, and file edit tools. Sets `CLAUDE_CODE_SIMPLE`. (cli-reference.md L72)

> `--permission-mode` | Begin in a specified permission mode. Accepts `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, or `manual` as an alias for `default`. The `manual` alias selects the permission mode the UI labels Manual and requires Claude Code v2.1.200 or later; ... Overrides `defaultMode` from settings files. ... For `-p`, that's `default` when nothing is configured (cli-reference.md L110)

> `--enable-auto-mode` | Removed in v2.1.111. Auto mode is now in the `Shift+Tab` cycle by default; use `--permission-mode auto` to start in it (cli-reference.md L86)

`--bg` "Can't be combined with `-p`/`--print`" (L74). `--forward-subagent-text` requires `--print` and stream-json (L92). `--prompt-suggestions` requires `--print`, stream-json and `--verbose` (L116).

### 1.2 `claude plugin` and `claude plugin marketplace` subcommands

> `claude plugin` | Manage Claude Code plugins. Alias: `claude plugins`. See plugin reference for subcommands | `claude plugin install code-review@claude-plugins-official` (cli-reference.md L40)

The subcommand list itself is **not in cli-reference.md**; the only subcommand it shows is the `claude plugin install <name>@<marketplace>` example above (L40). The list lives under `## CLI commands reference` at plugins-reference.md L959 (covered by another note). Subcommands that errors.md mentions by name: `claude plugin eval` and `claude plugin eval init` (errors.md L3011), `claude plugin marketplace add` (L3036, L3200), `claude plugin marketplace remove <name>` (L3040), `claude plugin install` (L3163, L3182), `claude plugin list` (L3138, L3169), and the in-session `/plugin marketplace update <name>` (L3089) and `/reload-plugins` (L3151).

### 1.3 Other commands relevant to Synchrobuilder

- `claude doctor`: "Print read-only installation and settings diagnostics from the terminal without starting a session, including install health, settings-file validation errors" (L34). In-session `/doctor` "can also apply fixes" (L34).
- `claude agents` "Accepts `--settings`, `--add-dir`, `--plugin-dir`, and `--mcp-config` like the top-level `claude` command" (L28).
- `claude auto-mode defaults` prints classifier rules as JSON (v2.1.208+) (L30); `claude auto-mode reset` (v2.1.212+) (L31).
- `claude project purge [path]` deletes local project state including transcripts and the `~/.claude.json` entry (L41).
- Mistyped subcommands: "Claude Code suggests the closest match and exits without starting a session" (L50).
- "As of v2.1.199, `claude --dangerously-skip-permissions daemon <subcommand>` runs the `daemon` subcommand." (L52)
- System prompt is recorded on a conversation's first request and reused until compaction, including across `--resume`/`--continue` (L160); `--system-prompt-snapshot off` rebuilds every request (v2.1.257+) (L131, L164).

## 2. Permissions (permissions.md)

### 2.1 Evaluation order and deny semantics

> Rules are evaluated in order: deny, then ask, then allow. The first match in that order determines the outcome, and rule specificity doesn't change the order. (permissions.md L60)

> Deny rules behave differently depending on whether they name a tool or scope a pattern within one. A bare tool name like `Bash` removes the tool from Claude's context entirely, so Claude never sees it. ... A scoped rule like `Bash(rm *)` leaves the tool available and blocks matching calls when Claude attempts them. (L64)

> Permission rules are enforced by Claude Code, not by the model. Instructions in your prompt or `CLAUDE.md` shape what Claude tries to do, but they don't change what Claude Code allows. (L69)

Precedence: managed settings highest; "If a tool is denied at any level, no other level can allow it" (L636-L640). `/permissions` changes apply from Claude's next tool call in the same turn (v2.1.234+) (L54).

### 2.2 Rule syntax (verbatim tables)

"Permission rules follow the format `Tool` or `Tool(specifier)`. Parentheses inside the specifier are literal, so a command or path that contains them needs no escaping." (L95)

Match all uses of a tool (L101-L105):

| Rule | Effect |
| :--------- | :----------------------------- |
| `Bash` | Matches all Bash commands |
| `WebFetch` | Matches all web fetch requests |
| `Read` | Matches all file reads |

"`Bash(*)` is equivalent to `Bash` and matches all Bash commands. As a deny rule, both forms remove the tool from Claude's context." (L107)

Specifiers (L113-L117):

| Rule | Effect |
| :----------------------------- | :------------------------------------------------------- |
| `Bash(npm run build)` | Matches the exact command `npm run build` |
| `Read(./.env)` | Matches reading the `.env` file in the current directory |
| `WebFetch(domain:example.com)` | Matches fetch requests to example.com |

Parameter rules (deny/ask only, built-in tools): `Tool(param:value)`, e.g. `Agent(model:opus)`, `Bash(run_in_background:true)` (L121, L127-L131). Not allowed on the primary content field (`command`, `file_path`, `path`, `notebook_path`, `url`); a rule like `Bash(command:rm *)` "would be bypassable by a compound command, so Claude Code ignores it and emits a startup warning" (L142). For MCP tools: "When Claude Code loads a settings file, it skips any `mcp__` rule that has parentheses" and lists it in the invalid-settings dialog and `claude doctor` (L123).

Wildcards: "A `*` in a Bash rule matches any text, including spaces" (L146). Warning: "Put the `*` after the subcommand ... `Bash(git log *)` allows only `git log` commands, and `Bash(git *)` allows every git command." (L149). Table (L170-L179):

| You write | Matches | Doesn't match |
| :--------------------- | :---- | :---- |
| `Bash(npm run build)` | `npm run build` | `npm run build --watch` |
| `Bash(npm run *)` | `npm run build`, `npm run test --watch`, `npm run` | `npm install` |
| `Bash(git log * main)` | `git log --oneline main`, `git log -5 main`, `git log --output=<file> main` | `git log main`, `git push origin main` |
| `Bash(git * main)` | `git merge main`, `git push origin main`, `git -c core.fsmonitor=<script> diff main` | `git log` |
| `Bash(* --version)` | `node --version`, `bash -c 'echo hi' --version` | `node -v` |
| `Bash(ls *)` | `ls -la`, `ls` | `lsof` |
| `Bash(ls*)` | `ls -la`, `lsof` | |
| `Bash(* --help *)` | `npm --help x` | `npm --help` |

"The `:*` suffix is an equivalent way to write a trailing wildcard, so `Bash(ls:*)` matches the same commands as `Bash(ls *)`." (L187) "The `:*` form is only recognized at the end of a pattern." (L189)

Tool-name globs: deny/ask accept globs in the tool-name position (`"*"`, `"mcp__*"`) (L193). "Allow rules accept tool-name globs only after a literal `mcp__<server>__` prefix. ... An unanchored allow glob such as `"*"`, `"B*"`, or `"mcp__*"` is skipped with a warning and doesn't auto-approve anything." (L205) A deny/ask rule naming an unknown tool warns at startup, except names containing `_` or `*` (L207). Rules must use canonical tool names, not transcript labels (L209).

### 2.3 Bash rule specifics

- Compound commands: separators `&&`, `||`, `;`, `|`, `|&`, `&`, newlines; "A rule must match each subcommand independently." (L220) Deny/ask apply to any subcommand including subshells and `$(...)`, "even in auto mode" (L223).
- Wrappers stripped before matching: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob` (L233); known-safe leading env assignments (L235); bare `xargs` (L237). `npx`, `docker exec`, `devbox run` etc. are not stripped (L239).
- Limits: "It doesn't match the same program invoked in a different form, so a deny or ask rule covers the invocation Claude usually produces and isn't a security boundary around the program." (L247) `Bash(git push *)` doesn't stop `git -C . push origin main` (L253).
- Read-only built-ins run without prompt "in every mode, except for a path that `permissions.blockReadsOutsideWorkingDirectories` fences": `ls`, `cat`, `echo`, `pwd`, `head`, `tail`, `grep`, `find`, `wc`, `which`, `diff`, `stat`, `du`, `cd`, read-only `git`; "The set is not configurable; to require a prompt for one of these commands, add an `ask` or `deny` rule for it" (L261). `cd` with `git` into a different directory prompts (L277). Commands over 10,000 characters always prompt (L273).
- Redirects `> file`, `>> file`, `2> file` are checked against `Edit` rules, protected paths, working directories (L301); `< file` against `Read` rules (v2.1.257+) (L302); `tee` targets checked (v2.1.269+) (L306).

### 2.4 Read and Edit rules

- "`Edit` rules apply to all built-in tools that edit files." Read rules best-effort cover Grep, Glob, `@file` mentions, IDE context (L334). A `Read` deny also blocks Edit/Write on the path (v2.1.208+/v2.1.228+); NotebookEdit not covered (L336).
- Only `Edit(path)` and `Read(path)` are consulted; `Write(path)`, `NotebookEdit(path)`, `Glob(path)`, `MultiEdit(path)` are accepted but never consulted and warn at startup, "except for a `Glob` rule passed in `--allowedTools`"; a bare tool-name rule such as deny `Write` is matched at the tool level without warning (v2.1.210+) (L338).
- Pattern anchors (L346-L351):

| Pattern | Meaning | Example | Matches |
| --- | --- | --- | --- |
| `//path` | Absolute path from filesystem root | `Read(//Users/alice/secrets/**)` | `/Users/alice/secrets/**` |
| `~/path` | Path from home directory | `Read(~/Documents/*.pdf)` | `/Users/alice/Documents/*.pdf` |
| `/path` | Path relative to the settings source | `Edit(/src/**/*.ts)` | `<primary working directory>/src/**/*.ts` in project settings |
| `path` or `./path` | Path relative to current directory | `Read(*.env)` | `<cwd>/*.env` |

- `/path` in user settings anchors at `~/.claude/path`, in `--settings <file>` at `<directory of file>/path` (L359-L365).
- Single-segment relative directory patterns: "**Allow rules**: `Edit(src/**)` matches only `<cwd>/src` ... **Deny and ask rules**: `Read(secrets/**)` matches a directory named `secrets` at any depth" (L391-L392).
- Windows paths normalized to POSIX: `C:\Users\alice` becomes `/c/Users/alice` (L373).
- `!` negation carve-outs, same source only (L425-L432). Symlinks: allow needs both link and target to match; deny matches either (L436-L437).

### 2.5 WebFetch rules

`WebFetch(domain:example.com)`; `domain:*.example.com` matches subdomains only; `domain:*` all domains; wildcards need v2.1.172+ (L449-L455). Bare `WebFetch` deny removes the tool; `WebFetch(domain:*)` deny keeps the tool and refuses each fetch and also affects the sandbox allowlist (L463-L466).

### 2.6 MCP rules (pre-approving a plugin's MCP tools)

> MCP rules use the server name as configured in Claude Code, optionally followed by the name of a tool from that server.
> * `mcp__puppeteer` matches any tool provided by the `puppeteer` server
> * `mcp__puppeteer__*` uses wildcard syntax and also matches all tools from the `puppeteer` server
> * `mcp__puppeteer__puppeteer_navigate` matches the `puppeteer_navigate` tool provided by the `puppeteer` server (L488-L492)

The naming of a plugin-bundled server's tools is not in permissions.md; mcp.md L498 gives `mcp__plugin_<plugin-name>_<server-name>__<tool-name>` (outside this note's assignment; see the MCP note). Connector tools an org set to `ask` prompt "even in `auto` and `bypassPermissions` modes" and are denied in `dontAsk` (L494).

### 2.7 `Skill(name)` rules

**Not found in permissions.md.** Searched for `Skill(`, `Skill`, `skill` (case-insensitive): the only hits are references to a skill's `allowed-tools` frontmatter (L677) and skill discovery (L566, L587). Pointer: skills.md L767 states "Permission syntax: `Skill(name)` for exact match, `Skill(name *)` for prefix match with any arguments." and L769 covers deny rules on aliases; that file is another note's assignment.

### 2.8 Agent and Cd rules

`Agent(AgentName)` deny rules disable subagents, e.g. `"deny": ["Agent(Explore)"]` (L500-L514). `Cd` rules gate the user's `/cd` command only; "Claude can't call it" (L518).

### 2.9 Permission modes (verbatim table) and what an "ask" means in each

| Mode | Description |
| :--- | :--- |
| `default` | Prompts for permission on first use of each tool. Labeled Manual in the CLI, the VS Code and JetBrains extensions, and the desktop app, and Claude Code accepts `manual` as an alias. The label and alias require Claude Code v2.1.200 or later. The desktop app's label doesn't depend on your CLI version |
| `acceptEdits` | Automatically accepts file edits and common filesystem commands such as `mkdir`, `touch`, `mv`, and `cp` for paths in the working directory or `additionalDirectories` |
| `plan` | Claude reads files and runs read-only shell commands to explore but doesn't edit your source files; with auto mode available, classifier-approved commands also run. Labeled Plan in the CLI and the VS Code extension |
| `auto` | Auto-approves tool calls with background safety checks that verify actions align with your request |
| `dontAsk` | Auto-denies every call that would otherwise prompt; file reads in your working directories and other actions that need no approval still run, as do tools pre-approved via `/permissions` or `permissions.allow` rules. `AskUserQuestion`, MCP tools marked `requiresUserInteraction`, and connector tools your organization set to `ask` in sessions where that setting reaches Claude Code are denied even if you've allowed them |
| `bypassPermissions` | Skips permission prompts, except for the actions no mode auto-approves |

(permissions.md L78-L85)

> In `bypassPermissions` mode, Claude Code skips permission prompts, including for writes to protected paths such as `.git` and `.claude`. ... Only use this mode in isolated environments like containers or VMs where Claude Code can't cause damage. (L88)

`permissions.disableBypassPermissionsMode` / `permissions.disableAutoMode` set to `"disable"` block those modes (L91).

What a hook "ask" does per mode: permissions.md does not give a per-mode table (searched `"ask"`, `auto-approve`, `hook`). What it does say:

- An ask rule (from settings) prompts "even in auto mode" (L223).
- "Hook decisions don't bypass permission rules. Claude Code evaluates deny and ask rules regardless of what a PreToolUse hook returns: a matching deny rule blocks the call, and a matching ask rule still prompts even when the hook returned `"allow"` or `"ask"`." (L536)
- In `dontAsk`, anything that would prompt is auto-denied (L84); since a hook `ask` forces a prompt (L534), the inference is that it is denied there (not stated in so many words in the source).
- In a `-p` run with no way to prompt, a hook that "answered `ask` without a reason" produces "`confirmation required, and this session cannot ask`" and the action (a model switch, in that entry) is blocked (errors.md L2085). In auto mode, when the classifier can't decide in a `-p` run without `--permission-prompt-tool`, "there is no prompt to fall back to, so the action doesn't run and the run continues" (errors.md L527).
- `--permission-prompts none` makes Claude Code deny prompts nobody can answer (cli-reference.md L112).

### 2.10 Hooks and permissions

> PreToolUse hooks run before the permission prompt, for every tool except `EndConversation`. The hook output can deny the tool call, force a prompt, or skip the prompt to let the call proceed. (L534)

> A blocking hook also takes precedence over allow rules. A hook that exits with code 2 stops the tool call before permission rules are evaluated, so the block applies even when an allow rule would otherwise let the call proceed. (L540)

MCP tools marked `requiresUserInteraction` still prompt when a hook returns `"allow"` (L538).

### 2.11 Pre-approving in `.claude/settings.json` and workspace trust

> `permissions.allow` rules and `permissions.additionalDirectories` entries in a project's `.claude/settings.json` grant capability, so Claude Code applies them only after you accept the workspace trust dialog for that folder. ... `deny` and `ask` rules aren't affected, since they only restrict. (L646)

> Claude Code shows the trust dialog in interactive sessions only. A `claude -p` run or an SDK session never shows it (L654)

From the "What runs before you trust a folder" table (L675-L682): hooks in settings files and a project skill's `allowed-tools` are "Used" in both untrusted situations, and "Workspace trust never gates a skill's `allowed-tools` in any session" (L677); project `permissions.allow` is "Not used" in `-p` with a stderr `this workspace has not been trusted` warning (L678); `extraKnownMarketplaces` entries from the repository and a project `@skills-dir` plugin are "Not used, and no dialog is offered" (L679); `.mcp.json` servers are "Connected without asking, approved or not" in `-p` (L681). Manual trust: set `projects["<path>"].hasTrustDialogAccepted` to `true` in `~/.claude.json` (L684). `.claude/settings.local.json` tracked in git is treated as repository-supplied (L658).

Configuration discovery: "Hooks and other `.claude/settings.json` keys load from the current working directory's `.claude/` folder with no parent-directory fallback" (L595). From `--add-dir` directories only skills, commands, subagents, and the `enabledPlugins` and `extraKnownMarketplaces` settings keys load; CLAUDE.md only with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` (L585-L591). For a `-p` run in a repository you didn't write, the docs list: `--setting-sources user`; `--bare` ("reads no hooks, skills, custom commands, subagents, plugins, or `.mcp.json` servers from the project", but the project's `env` block and helpers still apply); `--settings '{"disableAllHooks": true}'` ("Setting it in your user settings alone isn't enough, because the repository's project settings take precedence"); and `disabledMcpjsonServers` (L686-L691). Ways to share config across projects: user-level files, "**Plugins**: package and distribute configuration as a plugin that teams can install", or launch from the config directory (L599-L601).

### 2.12 "Actions no mode auto-approves"

**Not found in permissions.md.** The phrase appears only as a link in the `bypassPermissions` row, "except for the actions no mode auto-approves" pointing to `/docs/en/permission-modes#actions-no-mode-auto-approves` (L85), and L88 notes cross-session messaging safeguards still apply. `permission-modes.md` is not in the docs-raw folder. Related concrete items in these files: `AskUserQuestion`, `requiresUserInteraction` MCP tools, org-`ask` connector tools (L84, L494, L538). Separately, in the sandbox `autoAllowBashIfSandboxed` context, "`rm` or `rmdir` commands that target a critical path still go through the regular permission flow" (L620); that list is about the sandbox substitution, not about permission modes.

### 2.13 Sandboxing interaction

Permissions apply to every tool; sandboxing applies "only to Bash, PowerShell, and Monitor commands and their child processes" (L607-L608). With sandboxing on and `autoAllowBashIfSandboxed` true, sandboxed Bash runs without prompting even with a bare `Bash` ask rule (L612).

## 3. Error reference (errors.md): plugin, hook, marketplace, monitor, channel entries

Section intro: "For plugin problems that don't produce one of the messages on this page, such as a marketplace URL that doesn't load or a plugin that installs but doesn't appear, see Plugin troubleshooting" at discover-plugins (L3005). The page's message-to-entry lookup table lists the plugin messages at L205-L216 (`plugin eval` early access/unavailable, `Marketplace "<name>" is registered from an untrusted source`, the three `${user_config.*}` messages, `Plugin archive integrity check failed`, `path escapes plugin directory`, `path could not be checked`, `its marketplace entry path does not stay inside the marketplace directory`, `Plugin source path refused`, `Failed to load marketplace configuration`, `Marketplace configuration file is corrupted`). Two plugin-section headings are HTML `<h3>` blocks rather than `###`, so a `grep '^###'` misses them (L3007, L3044).

| Heading (line) | Cause | Fix |
| --- | --- | --- |
| plugin eval is currently in early access (L3007-L3026) | `claude plugin eval` exits 1: build older than v2.1.269, or switched off server-side | `claude update`, retry |
| Marketplace is registered from an untrusted source (L3028-L3042) | Marketplace uses a name reserved for official Anthropic marketplaces but isn't from `github.com/anthropics/`; re-checked on every load since v2.1.205; `claude plugin marketplace add` refuses with `Failed to add marketplace:` | `claude plugin marketplace remove <name>` and re-add from official source; third-party publishers rename |
| Plugin command references user_config in a shell command (L3044-L3072) | A plugin hook, monitor, or MCP `headersHelper` command references `${user_config.KEY}` in a string passed to a shell; refused even with no value configured; before v2.1.207 the value was substituted | Hook: use exec form `{"command": "<executable>", "args": ["${user_config.KEY}", ...]}` or read `$CLAUDE_PLUGIN_OPTION_<KEY>`; monitor: read from a config file; headersHelper: move to `headers` |
| Plugin archive integrity check failed (L3074-L3090) | `archive` source with `sha256` pin mismatches downloaded file; nothing installed | Publisher recomputes `shasum -a 256`; installer runs `/plugin marketplace update <name>` and retries |
| Path escapes plugin directory (L3092-L3123) | A component path in `plugin.json` or the marketplace entry resolves outside the plugin dir (as written, via symlink since v2.1.257, or contains a backslash on macOS/Linux); path dropped, rest loads | Move file inside plugin, use `./` relative forward-slash paths |
| Path could not be checked (L3125-L3153) | OS stat error other than not-found (`ELOOP`, `EIO`/`ESTALE`, `EACCES`) on a component path or the plugin dir; v2.1.265+ | Fix symlink/mount/permissions; `/reload-plugins` or restart |
| Marketplace entry path does not stay inside the marketplace directory (L3155-L3178) | Entry `source` is absolute, climbs with `..`, network-shaped, backslash, symlink outside, or a relative entry in a marketplace added from a direct URL to `marketplace.json`; `claude plugin list` shows `failed to load` with `Plugin source path refused` | Use a plain relative `source` such as `./plugins/my-plugin`; add URL-catalog marketplaces from their git repo instead |
| Failed to load marketplace configuration (L3180-L3200) | `~/.claude/plugins/known_marketplaces.json` unreadable/invalid JSON (`Failed to load marketplace configuration`) or wrong schema (`Marketplace configuration file is corrupted`); missing file is fine | Repair JSON or replace with `{}` and re-add with `claude plugin marketplace add <source>`; `extraKnownMarketplaces` re-registers on next trusted start |
| Model switch was blocked by a PreModelSwitch hook (L2073-L2089) | Hook denied/asked, timed out, failed before answering, or managed-plugin hooks couldn't be checked; "the hook run ended without a verdict, and Claude Code doesn't treat that as approval" (L2087) | Fix hook, raise `timeout`, run `claude --debug` |
| Unknown command (L2697-L2728) | `/name` matches nothing; one cause: "A command from a plugin or MCP server that isn't installed or connected in this session" (L2709); interactive only, other sessions send the prompt to Claude with a note (v2.1.274+) | Use suggested name; check requirement |
| Cannot switch renderers in this session (L2909-L2931) | Session-only permission updates from a hook (`session` destination deny/ask rules) can't be carried across the `/tui` restart (L2925-L2926) | Switch renderer in a session without them |
| Workspace has not been trusted (L4056-L4068) | Project `permissions.allow`/`additionalDirectories` ignored until trust | Run `claude` interactively once, or set `hasTrustDialogAccepted` in `~/.claude.json` |
| Malformed Tool(content) rule (L4196-L4211) | Rule not shaped `Tool` or `Tool(content)`; skipped, listed in invalid-settings dialog and `claude doctor` | Rewrite to end at the closing `)` |
| Is not matched by file permission checks (L4213-L4229) | `Write(path)`, `NotebookEdit(path)`, `MultiEdit(path)`, `Glob(path)` rules are never consulted (v2.1.210+); warning goes to debug log under `--output-format json`/`stream-json` | Use `Edit(path)` / `Read(path)` |
| Has a wildcard before the rest of the command (L4231-L4250) | `Bash` allow rule with `*` before the subcommand, e.g. `Bash(git * main)` (v2.1.246+) | Move `*` after the subcommand |
| Auto mode cannot determine the safety of an action (L462-L532) | Classifier unavailable/unparseable/blocked; "Reads, searches, and edits inside your working directory skip the classifier" (L466) | Retry, `/compact`, or switch mode |

Verbatim example messages that a plugin author must recognize:

> Hook from plugin formatter@acme-tools references ${user_config.*} in a shell-form command. The substituted value would be re-parsed by the shell. Use exec form instead — {"command": "<executable>", "args": ["${user_config.KEY}", ...]} — or read $CLAUDE_PLUGIN_OPTION_<KEY> from the hook's environment. Command: ./scripts/notify.sh ${user_config.webhook_url} (errors.md L3053)

> Monitor "deploy-status" from plugin deploy-tools references ${user_config.*} in its command. The substituted value would be passed to a shell. Monitor commands cannot safely reference ${user_config.*}; have the monitor script read the value from a config file or prompt instead. (L3059)

> commands path escapes plugin directory: ./commands\deploy.md — its path contains a backslash, which is not resolved reliably on this platform (L3111)

> Cannot install my-plugin@my-marketplace: its marketplace entry path does not stay inside the marketplace directory (an absolute, climbing, network-shaped, backslash-containing or link-traversing entry, an entry of a fetched marketplace that resolves or opens outside its tree — or a relative entry in a url-catalog marketplace, which has no local directory) (L3166)

> Ignoring 2 permissions.allow entries from .claude/settings.local.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["/Users/you/project"].hasTrustDialogAccepted: true in /Users/you/.claude.json. (L4061)

Not found in errors.md: any heading for "plugin not found", "plugin failed to install", "hook script failed", "hook timed out" (generic), "channel" (only spend-limit rows at L44, L668). Hook script failures are delegated: "Hook script failed or blocked a tool: Debug hooks" (L4384). Searched headings and body for `plugin`, `hook`, `marketplace`, `monitor`, `channel`.

Other error-reference facts worth carrying: "Conflict between --bg and --print" (L2277); "Settings file exceeds the 2MiB limit" (L2369); "MCP permission prompt tool not found" (L2575); `Invalid --agents configuration` (L2290); permission-rule warnings are written to the debug log at `~/.claude/debug/<session-id>.txt` under machine-read output formats (L4229, L4250).

## Implications for Synchrobuilder

1. Test harness: `claude -p --plugin-dir <path> --output-format stream-json --verbose --include-hook-events` is the documented way to observe hook lifecycle events for the guard hook (cli-reference.md L97, L113). `SessionStart` and `Setup` events are always included (L97). `SessionEnd`/`Notification` never emit `hook_started`, so the handoff-at-session-end hook can only be observed via `hook_progress`/`hook_response` for background hooks (L97).
2. `--bare` and `--safe-mode` skip plugins entirely (L72, L124); `/synchrobuilder:doctor` and the website's troubleshooting page should tell users these flags disable the plugin, and the CI command must not use `--bare`.
3. `--permission-mode dontAsk` and `--permission-prompts none` auto-deny anything that prompts (permissions.md L84; cli-reference.md L112). A claims/collision hook that answers `ask` will therefore be treated as a denial in those modes and in `-p` runs with no prompt channel; the only documented case is a PreModelSwitch hook (errors.md L2085) plus the auto-mode classifier fallback (L527), so the PreToolUse behavior is inferred, not documented, in these files. The brief's "warn or ask" default should be "warn" (additionalContext/systemMessage style), with "ask" opt-in only for interactive sessions.
4. A matching settings ask rule prompts even in auto mode (the `Bash(git clean *)` example, permissions.md L223) and regardless of hook output (L536); a hook returning `allow` cannot suppress a matching ask/deny rule (L536). So Synchrobuilder cannot use a PreToolUse hook to "pre-approve" anything a project denies.
5. Pre-approving plugin tools in a project's `.claude/settings.json` (`permissions.allow`) only takes effect after workspace trust; `-p`/SDK sessions never show the trust dialog, so in a folder that was never trusted they ignore the rules with a stderr warning, and trust must be granted interactively first or by setting `projects["<path>"].hasTrustDialogAccepted` in `~/.claude.json` (L646, L654, L678, L684). `/synchrobuilder:setup` should not rely on writing allow rules for CI without that step; it should print the `hasTrustDialogAccepted` key hint (L684, errors.md L4061, L4067).
6. Allow rules for a plugin MCP server must be anchored: `mcp__<server>__*` is allowed, `mcp__*` is skipped with a warning (permissions.md L205). Parenthesised `mcp__` rules in settings files are skipped (L123). If Phase 0 chooses MCP, the server name matters for the rule text (naming form is in mcp.md L498).
7. Shipped hooks must not reference `${user_config.*}` in shell-form commands; use exec form with `args` or `$CLAUDE_PLUGIN_OPTION_<KEY>`; monitors cannot reference `${user_config.*}` at all (errors.md L3048-L3071). This fits the "node <path>" exec-form principle.
8. Plugin component paths must be `./`-relative, forward-slash, inside the plugin dir (L3092-L3122); the marketplace `source` must be a plain relative path such as `./plugins/synchrobuilder` (L3177). Adding the marketplace from a direct URL to `marketplace.json` breaks relative entries (L3161, L3178), so the install page must use the GitHub-repo form, not a raw URL.
9. `/synchrobuilder:audit` should flag: `Write(path)`/`Glob(path)` rules (errors.md L4213), `Bash(git * main)`-style allow wildcards (L4231), malformed `Tool(content)` rules (L4196), `/path` anchors in user settings (permissions.md L363, L371), and `.claude/settings.local.json` tracked in git (L658).
10. `claude doctor` (read-only, from the shell) reports settings validation errors (cli-reference.md L34; permissions.md L123; errors.md L4200) and is a candidate to wrap in `/synchrobuilder:doctor`.
11. The sync loop touches the git remote; Bash deny rules like `Bash(git push *)` don't stop `git -C . push` (permissions.md L253), but a shipped script should not rely on that either way. The status-line question (can plugins drive the status line?) is not answered in these three files; `--safe-mode` mentions "status line and file-suggestion commands" as customizations and that managed policy can configure them (cli-reference.md L124).
12. Session naming for teammates: `--name`/`-n` and `/rename` exist (L106); `--resume <name>` works (L106, L123).

## Conflicts with the brief

| Brief says | Docs say | Source |
| --- | --- | --- |
| Collision hook may "ask" before an edit | In `dontAsk` mode every call that would prompt is auto-denied (L84); with `--permission-prompts none` prompts are denied (cli-reference.md L112); a hook `ask` in a `-p` run "cannot ask" and blocks (errors.md L2085). "Advisory not blocking" is only satisfiable with warn, not ask, in those modes | permissions.md L84; cli-reference.md L112; errors.md L2085 |
| `/plugin marketplace add <owner>/<repo>` then `/plugin install synchrobuilder@<marketplace>` | The install form `claude plugin install <name>@<marketplace>` is shown once (`claude plugin install code-review@claude-plugins-official`, cli-reference.md L40) and echoed in errors.md (`Cannot install my-plugin@my-marketplace`, L3166). The `marketplace add` argument form is only `<source>` (errors.md L3200); the `<owner>/<repo>` shorthand and the in-session `/plugin` syntax are not documented in these three files and must come from the marketplaces note | cli-reference.md L40; errors.md L3166, L3200 |
| Short prefix / aliases such as `/sb:audit` | Not addressed in cli-reference, permissions, or errors. `Unknown command` says Claude Code "suggests the closest command name or alias that the menu lists" (L2705), so aliases exist as a concept, but nothing here says a plugin can define one | errors.md L2705 |
| `.mcp.json` only if needed | Project `.mcp.json` servers are "Connected without asking, approved or not" in `-p`/SDK runs and prompt in interactive untrusted folders (L681); on `/cd`, Claude Code disconnects "the servers of plugins that are no longer enabled after the move" (L569). Shipping an `.mcp.json` in the plugin adds an approval surface | permissions.md L681, L569 |
| Hooks "must be local-file-read only and under 50 ms" | Docs set no per-hook latency figure here; `--include-hook-events` mentions `hook_progress` for "a command hook that runs for more than a second" (L97) | cli-reference.md L97 |
| Guard hook re-audits after Write/Edit | Rules are matched on canonical tool names, not labels (permissions.md L209); `Edit` rules cover all editing tools (L334) but hook matchers are a separate mechanism (hooks note) | permissions.md L209, L334 |

## Open questions

1. Exact `/plugin marketplace add` and `/plugin install` argument syntax and output on v2.1.218 vs the current docs build (not in these files beyond the `claude plugin install <name>@<marketplace>` example; verify against the marketplaces note and a real run).
2. Whether a plugin can register a command alias or shorter namespace; nothing in these three files. Test on v2.1.218.
3. What a PreToolUse hook `ask` does in `acceptEdits`, `plan`, `auto` and `bypassPermissions` for an Edit call: permission-modes.md is missing from docs-raw, so the per-mode behavior must be tested (permissions.md L223 and L536 cover settings ask rules, not hook `ask`).
4. Whether `--include-hook-events` on v2.1.218 emits `hook_response` for a foreground `PostToolUse` hook (L97 carries no version marker, so it describes the current docs build; unknown when this behavior was introduced).
5. Tool name for a plugin-bundled MCP server in allow rules (`mcp__plugin_<plugin>_<server>__*` per mcp.md L498) and whether `permissions.allow` in the plugin's own `settings.json` is honored (permissions.md only covers project/user/managed sources).
6. Whether `claude doctor` on v2.1.218 prints the invalid-rule and `Write(path)` warnings that errors.md L4200, L4215 describe for v2.1.260+/v2.1.210+.
7. Behavior of `Unknown command` for `/synchrobuilder:notify` in `-p` runs: v2.1.274+ forwards the text to Claude with a note (L2711-L2719); v2.1.218 answers `Unknown command`.
8. Does the "actions no mode auto-approves" list (permission-modes.md, not fetched) include anything a background sync script could trigger, e.g. writes under `.claude` or `.git` (L88 says bypassPermissions skips protected-path prompts)?
