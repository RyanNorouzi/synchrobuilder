# Windows notes: the single Windows fact sheet for a Synchrobuilder plugin author

## Source

Raw Markdown downloaded on 2026-09-18 from `code.claude.com/docs/en/<page>.md` into
`scratchpad/docs-raw/`. Every file in that directory was grepped (case-insensitive) for:
windows, powershell, git bash, cmd.exe, backslash, wsl, named pipe, msys, mingw,
%USERPROFILE%, .cmd, .bat, case-insensitive, CRLF, path length, 260, win32, node.exe,
pwsh, forward slash, executable bit, chmod, line ending. The surrounding paragraph of every
hit was read. The first 4 lines of each raw file are an index preamble; content starts at
the `# ` title on line 5.

Canonical pages cited (raw file name in parentheses):

- https://code.claude.com/docs/en/hooks (hooks.md)
- https://code.claude.com/docs/en/hooks-guide (hooks-guide.md)
- https://code.claude.com/docs/en/statusline (statusline.md)
- https://code.claude.com/docs/en/tools-reference (tools-reference.md)
- https://code.claude.com/docs/en/settings-reference (settings-reference.md)
- https://code.claude.com/docs/en/settings (settings.md)
- https://code.claude.com/docs/en/permissions (permissions.md)
- https://code.claude.com/docs/en/plugin-marketplaces (plugin-marketplaces.md)
- https://code.claude.com/docs/en/plugins-reference (plugins-reference.md)
- https://code.claude.com/docs/en/plugins (plugins.md)
- https://code.claude.com/docs/en/discover-plugins (discover-plugins.md)
- https://code.claude.com/docs/en/plugin-evals (plugin-evals.md)
- https://code.claude.com/docs/en/plugin-relevance (plugin-relevance.md)
- https://code.claude.com/docs/en/cross-session-messaging (cross-session-messaging.md)
- https://code.claude.com/docs/en/agent-teams (agent-teams.md)
- https://code.claude.com/docs/en/skills (skills.md)
- https://code.claude.com/docs/en/sub-agents (sub-agents.md)
- https://code.claude.com/docs/en/mcp (mcp.md)
- https://code.claude.com/docs/en/env-vars (env-vars.md)
- https://code.claude.com/docs/en/errors (errors.md)
- https://code.claude.com/docs/en/commands (commands.md)

The highest version marker that appears anywhere in these raw files is v2.1.275 (grep of
`v2.1.NNN` across `docs-raw/`); the docs do not state which npm release they describe. The local
CLI used for experiments reports `2.1.218 (Claude Code)` (`claude --version`, 2026-09-18).

Files grepped with no Windows-relevant hits: channels-reference.md, plugin-dependencies.md,
plugin-hints.md (only a platform-neutral mention of the PowerShell tool at L17), remote-control.md
(only Windows Hello sign-in prompts, L243/L272/L274), cli-reference.md (only WSL Glob/Grep note
at L135), agent-view.md (only background-session keyboard/daemon notes, L213/L877/L945/L958/L992).

---

## 1. How hooks run on Windows

### 1.1 Exec form vs shell form (the core rule)

> A command hook runs as exec form when `args` is set, and shell form when `args` is omitted. Set `args` whenever the hook references a [path placeholder](#reference-scripts-by-path), since each element is passed as one argument with no quoting. (hooks.md L468)

> **Exec form** runs when `args` is present. Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell, so each `args` element is one argument exactly as written, and path placeholders like `${CLAUDE_PLUGIN_ROOT}` are substituted into `command` and into each `args` element as plain strings. Special characters such as apostrophes, `$`, and backticks pass through verbatim because there is no shell to interpret them. No shell tokenization happens on any platform. (hooks.md L470)

> **Shell form** runs when `args` is absent. The `command` string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed. Set the `shell` field to choose explicitly. The shell tokenizes the string, expands variables, and interprets pipes, `&&`, redirects, and globs. (hooks.md L472)

The `shell` command-hook field (hooks.md L462):

> Shell to use for this hook. Accepts `"bash"` or `"powershell"`. Defaults to `"bash"`, or to `"powershell"` on Windows when Git Bash isn't installed. Setting `"powershell"` runs the command via PowerShell on Windows. Does not require `CLAUDE_CODE_USE_POWERSHELL_TOOL` since hooks spawn PowerShell directly. Ignored when `args` is set

### 1.2 The `.cmd`/`.bat` shim caveat and the `node` + script-path pattern

> On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`. The `.cmd` and `.bat` shims that npm, npx, eslint, and other tools install in `node_modules/.bin` are not executables and can't be spawned without a shell. To run them in exec form, invoke the underlying script with `node` directly, for example `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`. The `node` plus script-path pattern works on every platform because `node.exe` is a real binary. To run a `.cmd` or `.bat` shim by name, use shell form. (hooks.md L475)

Canonical exec-form example (hooks.md L480-L486):

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]
}
```

Bare-name-with-whitespace warning (hooks.md L504):

> In exec form, `command` is the executable name or path only. If `command` is a bare name with no path separator and contains whitespace alongside `args`, Claude Code logs a warning because the spawn will fail: there is no executable named `node script.js`. Move the extra tokens into `args`. Absolute paths with spaces, such as `C:\Program Files\nodejs\node.exe`, are a single valid executable and don't trigger the warning.

Both forms export the placeholders as environment variables, so a Node script can read them
regardless of launch mode (hooks.md L497):

> Both forms support the same [path placeholders](#reference-scripts-by-path), and both export them as the environment variables `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA` on the spawned process, so a script can read `process.env.CLAUDE_PLUGIN_ROOT` regardless of how it was launched.

Plugin `${user_config.*}` values substitute in exec form only; a shell-form plugin hook that references them fails with an error instead of running (hooks.md L499-L501). Prefer exec form for any hook that references a path placeholder; in shell form wrap each placeholder in double quotes (hooks.md L632).

### 1.3 Placeholder rewriting in PowerShell shell form, with version markers

> To reference the project root from a PowerShell shell-form command, write `${CLAUDE_PROJECT_DIR}` or `$env:CLAUDE_PROJECT_DIR`. As of v2.1.198, Claude Code rewrites the `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PLUGIN_DATA}` placeholders in a PowerShell shell-form command to PowerShell's `${env:NAME}` form, whether the hook is defined in `settings.json`, a plugin, or a skill. PowerShell then resolves the value from the exported environment after parsing, so the placeholder works inside double-quoted strings but not inside single-quoted strings, where PowerShell never expands variables. (hooks.md L3813)

> Before v2.1.198, this rewrite applied only to plugin hooks. On earlier versions, a `settings.json` hook needs the `$env:` form or [exec form](#exec-form-and-shell-form), where `${CLAUDE_PROJECT_DIR}` is substituted in each `args` element regardless of where the hook is defined. (hooks.md L3815)

> Don't write the bare `$CLAUDE_PROJECT_DIR` spelling in a PowerShell hook. PowerShell parses it as an undefined local variable and resolves it to `$null`, which leaves the script path without its project-root prefix. Claude Code doesn't rewrite that form; it logs a warning in the [debug log](#debug-hooks) instead. (hooks.md L3817)

PowerShell executable detection for `"shell": "powershell"` hooks (hooks.md L3792):

> On Windows, you can run individual hooks in PowerShell by setting `"shell": "powershell"` on a command hook. Claude Code auto-detects `pwsh.exe`, the PowerShell 7 and later executable, and falls back to `powershell.exe` for Windows PowerShell 5.1.

Version-independent PowerShell shell-form example (hooks.md L3821-L3827):

```json
{
  "type": "command",
  "shell": "powershell",
  "command": "& \"$env:CLAUDE_PROJECT_DIR\\.claude\\hooks\\check.ps1\""
}
```

The docs' recurring Windows tab pattern is exec form with `powershell.exe` and
`-NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/x.ps1"`
(hooks.md L126-L160, L1536-L1557, L3154-L3175); "The `-NoProfile` flag skips loading your PowerShell profile so the hook starts fast" (hooks.md L163, L1560).

`CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` (env-vars.md L336):

> Set to `1` to stop Claude Code from passing `-ExecutionPolicy Bypass` when spawning PowerShell for tool calls, hooks, and status line commands, and respect the machine's effective execution policy instead. By default Claude Code bypasses execution policy at process scope so `.ps1` scripts and module imports work on default-Restricted Windows installs. Process-scope bypass never overrides Group Policy `MachinePolicy` or `UserPolicy` regardless of this setting

`CLAUDE_CODE_SHELL_PREFIX` does not wrap PowerShell hooks or exec-form hooks: "PowerShell hooks and exec-form hooks run without the prefix." (env-vars.md L358)

### 1.4 Backslash `file_path` in `tool_input` and `$PWD` under Git Bash

> For the file tools `Write`, `Edit`, and `Read`, `tool_input.file_path` is always absolute: (hooks.md L1601)
>
> * Claude Code expands `~` and relative paths before hooks run, so a hook that matches on paths can't be bypassed via `~` or a relative spelling of the same path
> * On Windows, the path arrives with backslash separators, even when your hook runs under Git Bash where `$PWD` looks like `/c/project`
> * A comparison written with forward slashes, such as a `/src/` check, never matches a backslash path, and the tool call proceeds as if the hook had nothing to block
> * Normalize separators before comparing: `FILE_PATH="${FILE_PATH//\\//}"` in Bash, or `file_path.replace("\\", "/")` in Python, then match a path segment such as `/src/` rather than anchoring with `^`, since the path is absolute (hooks.md L1603-L1606)

Verbatim Windows `Write` example (hooks.md L1608-L1620):

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "C:\\project\\src\\index.ts",
    "content": "..."
  },
  ...
}
```

PostToolUse delivers the same format: "File-tool `tool_input` paths arrive in the same format as for [PreToolUse](#pretooluse-input): always absolute, with the platform's native separators, so backslashes on Windows." (hooks.md L1998). The hooks guide's protect-files example normalizes with `FILE_PATH="${FILE_PATH//\\//}"` under the comment "Normalize Windows backslash separators so the patterns below match" (hooks-guide.md L262-L263).

Permission rules, by contrast, are normalized to POSIX before matching: "On Windows, paths are normalized to POSIX form before matching. `C:\Users\alice` becomes `/c/Users/alice`, so use `//c/**/.env` to match `.env` files anywhere on that drive. To match across all drives, use `//**/.env`." (permissions.md L373)

### 1.5 `CLAUDE_CODE_GIT_BASH_PATH`

> Windows only: path to the Git Bash executable (`bash.exe`). Use when Git Bash is installed but not in your PATH. If the path doesn't exist or the file isn't named `bash.exe`, `sh.exe`, `bash`, or `sh`, Claude Code ignores the variable and auto-detects Git Bash as if it were unset, logging a warning visible with `--debug`. Before v2.1.219, Claude Code exited at startup when the path didn't exist, and used any existing file as the shell without checking that it was bash or sh. (env-vars.md L292)

Git Bash shell-form hooks source your profile, which can prepend text to hook JSON:

> When Claude Code runs a shell-form command hook, one without `args`, it spawns `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed by default. This shell is non-interactive, but Git Bash and some configurations, such as `BASH_ENV` pointing at `~/.bashrc`, still source your profile. If that profile contains unconditional `echo` statements, the output gets prepended to your hook's JSON: (hooks-guide.md L1027) ... The combined output no longer starts with `{`, so Claude Code treats all of stdout as plain text and ignores the JSON. (hooks-guide.md L1034)

### 1.6 When the Bash tool is not registered; the PowerShell tool

> Match `Bash|PowerShell` in hooks that inspect shell commands, so they cover both tools: (hooks.md L1671)
> * On Windows, wherever the PowerShell tool is enabled, Claude treats PowerShell as the primary shell and routes shell commands through it.
> * On Windows without Git Bash, the tool is enabled automatically and Claude Code doesn't register the Bash tool at all.
> * A hook that matches only `Bash` never fires there. (hooks.md L1673-L1675)

PowerShell tool availability (tools-reference.md L391-L393):

> * **Windows without Git Bash**: the tool is enabled automatically.
> * **Windows with Git Bash installed**: the tool is on by default for claude.ai and Console accounts; set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` to enable it in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions, or `0` to turn it off.
> * **Linux, macOS, and WSL**: the tool is opt-in.

> On Windows, Claude Code auto-detects `pwsh.exe` for PowerShell 7+ with a fallback to `powershell.exe` for PowerShell 5.1. When the tool is enabled, Claude treats PowerShell as the primary shell. The Bash tool remains available for POSIX scripts when Git Bash is installed. (tools-reference.md L413)

> Claude Code spawns PowerShell with `-ExecutionPolicy Bypass` at process scope only, so `.ps1` scripts and module imports work on default Windows installs without changing the machine's policy. (tools-reference.md L415)

PowerShell tool preview limitations: "PowerShell profiles are not loaded" and "On Windows, sandboxing is not supported" (tools-reference.md L445-L446). The PowerShell hook input has the same fields as Bash: `command`, `description`, `timeout`, `run_in_background` (hooks.md L1662-L1669). Windows encoding/exit-code fixes require v2.1.214 or later, including UTF-8 `>` redirection on PowerShell 5.1 and UTF-8 piped stdin; "Before v2.1.214, `>` on PowerShell 5.1 wrote UTF-16LE files, non-ASCII piped input arrived as `?`" (tools-reference.md L431-L439). PowerShell *tool* commands (not Bash) on Windows start "through the `cmd.exe` launcher" by default so a backgrounded PowerShell command can carry over to the session's next process; `CLAUDE_CODE_DISABLE_WINDOWS_SHELL_LAUNCHER=1` starts them directly instead. "Bash commands aren't affected. Requires Claude Code v2.1.269 or later" (env-vars.md L268). Nothing in env-vars.md L268 says hooks or the Bash tool go through `cmd.exe`.

The env var that controls the tool: "`CLAUDE_CODE_USE_POWERSHELL_TOOL` ... On Windows without Git Bash, the tool is enabled automatically; set to `0` to disable it. On Windows with Git Bash installed, the tool is on by default for claude.ai and Console accounts; set to `1` to enable it in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions, or `0` to turn it off. On Linux, macOS, and WSL, set to `1` to enable it, which requires `pwsh` on your `PATH`." (env-vars.md L394). The with-Git-Bash default depends on feature-flag fetching: with flag fetching off, "Claude Code routes shell commands through Git Bash unless you set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. On Windows without Git Bash, the tool stays on" (env-vars.md L523). The `defaultShell` setting (which shell runs the user's `!` commands) defaults to "`\"bash\"`, or `\"powershell\"` on Windows when Bash isn't available" (settings-reference.md L2994).

Glob and Grep are in the default tool set on Windows but absent by default on macOS/Linux/WSL, where `find`/`grep` run through Bash instead (tools-reference.md L263). On macOS/Linux/WSL they come back only when named in `--tools`/`--allowedTools`, when `Bash` is removed from the session, or for a subagent that lists them without `Bash` (tools-reference.md L265-L269). A `PreToolUse` matcher for `Glob`/`Grep` therefore fires on native Windows but, absent those cases, not elsewhere.

### 1.7 Terminal, tty, and other Windows-relevant hook notes

- "Windows has no `/dev/tty`." (hooks.md L744). Use `terminalSequence`; it "works on Windows where there is no `/dev/tty`" and supports OSC 9 for Windows Terminal notifications (hooks.md L967, L972).
- `ConfigChange` hooks do not run for Windows registry policy changes, and on WSL with `wslInheritsWindowsSettings` a changed Windows-side managed settings file is applied without running them (hooks.md L2713).
- Sub-agent hook examples: "On Windows, write hook scripts in PowerShell and add `shell: powershell` to the hook entry" (sub-agents.md L685, L1372).
- `processWrapper`: "Claude Code ignores the launcher on Windows and starts every process unwrapped. Requires Claude Code v2.1.210 or later." (settings-reference.md L4884)
- Plugin troubleshooting still lists "Hooks not firing | Script not executable | Run `chmod +x script.sh`" and a shebang check (plugins-reference.md L1394, L1415-L1418); no Windows equivalent is given.
- The hooks guide's Windows `Notification` example is shell form calling `powershell.exe -Command "..."` with a `[System.Windows.Forms.MessageBox]` (hooks-guide.md L157-L170); its caveat: "If you run Claude Code inside WSL, `powershell.exe` must be available on your `PATH` through Windows interop." (hooks-guide.md L177).

---

## 2. How the status line runs on Windows

> On Windows, Claude Code runs status line commands through Git Bash when Git Bash is installed, or through PowerShell when Git Bash is absent. (statusline.md L1033)

> Git Bash treats unquoted backslashes as escape characters, so a Windows-style path such as `C:\Users\username\script.mjs` reaches the script runner with its separators removed and the command fails without a visible error. Write file paths in the `command` string with forward slashes, as shown in the examples below. The `~` shorthand also works and expands to your Windows home directory. (statusline.md L1035)

> To run a PowerShell script as your status line, invoke it via `powershell`. This works whether Claude Code routes the command through Git Bash or PowerShell: (statusline.md L1037)

```json
{
  "statusLine": {
    "type": "command",
    "command": "powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1"
  }
}
```
(statusline.md L1040-L1047)

```powershell
$input_json = $input | Out-String | ConvertFrom-Json
$cwd = $input_json.cwd
$model = $input_json.model.display_name
$used = $input_json.context_window.used_percentage
$dirname = Split-Path $cwd -Leaf

if ($used) {
    Write-Host "$dirname [$model] ctx: $used%"
} else {
    Write-Host "$dirname [$model]"
}
```
(statusline.md L1049-L1061)

Git Bash alternative: `"command": "~/.claude/statusline.sh"` with a bash script that strips the dirname via `dirname="${cwd##*[/\\]}"`, handling both separators (statusline.md L1064-L1084). Troubleshooting repeats: "On Windows with Git Bash installed, backslashes in the `command` path are likely being consumed as escape characters before the script runs. Use forward slashes in the path." (statusline.md L1124). The `statusLine` setting type is "object with `type` set to `"command"` and a `command` string, plus optional `padding` ... `refreshInterval` ... and `hideVimModeIndicator`" (settings-reference.md L3379); no `args`/exec form is documented for status lines (searched statusline.md for `args`: no hits).

**Can a plugin drive the status line?** Plugin `settings.json`: "Only the [`agent`](/docs/en/sub-agents) and [`subagentStatusLine`](/docs/en/statusline#subagent-status-lines) keys are supported" (plugins-reference.md L955; same at plugins.md L269). "Plugins can ship a default `subagentStatusLine` in their [`settings.json`] ..., but unlike hooks, plugin values don't run under `allowManagedHooksOnly`" (statusline.md L1107). The main `statusLine` key is not listed as a plugin-settable key.

---

## 3. How monitors and MCP stdio servers run on Windows

**Monitors.** "Each monitor runs a shell command for the lifetime of the session" and monitors "run only in interactive CLI sessions, run unsandboxed at the same trust level as [hooks](#hooks), and are skipped on hosts where the Monitor tool is unavailable" (plugins-reference.md L293-L295). "The command runs through a shell" and cannot reference `${user_config.*}`; "Monitor processes don't receive `CLAUDE_PLUGIN_OPTION_<KEY>` environment variables" (plugins-reference.md L337). The `command` field is "Shell command run as a persistent background process in the session working directory" (plugins-reference.md L325). Monitor `command` supports `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and any `${ENV_VAR}` (plugins-reference.md L335). Monitors have no exec form/`args` field (required fields are `name`, `command`, `description`; optional `when`, plugins-reference.md L321-L331). Which shell runs a monitor on Windows: **Not found in docs** (searched plugins-reference.md Monitors section and tools-reference.md Monitor tool section for windows, powershell, git bash, cmd). Monitor tool is unavailable when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (tools-reference.md L343). "If you disable a plugin mid-session, Claude Code doesn't stop monitors that are already running" (plugins-reference.md L339); after a copied plugin updates mid-session, "`/reload-plugins`" switches hooks/MCP/LSP to the new path but "monitors require a session restart" (plugins-reference.md L752).

**MCP stdio servers.** Plugin `.mcp.json` placeholders resolve in `command`, `args`, `env` (plugins-reference.md L727). The docs' plugin example uses `"command": "npx", "args": ["@company/mcp-server", "--plugin-mode"]` (plugins-reference.md L187-L190) and the data-directory example uses `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]` with `NODE_PATH` set to `${CLAUDE_PLUGIN_DATA}/node_modules` (plugins-reference.md L791-L801). `CLAUDE_CODE_SHELL_PREFIX` wraps "stdio [MCP server] startup commands" and "Treating `$1` as a bare executable path breaks stdio MCP servers that pass arguments such as `npx -y <package>`" (env-vars.md L358), which implies stdio startup commands are run through a shell wrapper on at least Unix. Windows-specific stdio launch shell, `cmd /c` wrapper guidance, or `.cmd` shim notes for MCP: **Not found in docs** (searched mcp.md for windows, powershell, cmd, .cmd, git bash; only hit is Claude Desktop import "only works on macOS and Windows Subsystem for Linux (WSL)" at mcp.md L1093). `CLAUDECODE=1` is set in stdio MCP server subprocesses; `CLAUDE_CODE_CHILD_SESSION` is not (env-vars.md L190, L223). `${CLAUDE_PROJECT_DIR}` is also set in the environment of stdio MCP servers (hooks.md L621).

**Shell-out helpers.** `apiKeyHelper` runs "through the system shell, `/bin/sh` on macOS and Linux and `cmd` on Windows" (settings-reference.md L5265). Marketplace `headersHelper` runs "through `sh`, or `cmd.exe` on Windows, from the configuration directory, `~/.claude` or `CLAUDE_CONFIG_DIR`" (plugin-marketplaces.md L554). Plugin `command` sources run "through the platform shell, `sh` on macOS and Linux or `cmd.exe` on Windows, from the user's home directory" (plugin-marketplaces.md L620).

---

## 4. Marketplace/plugin install on Windows

- Install commands are the same on every platform: `/plugin marketplace add anthropics/claude-code` (discover-plugins.md L229), `/plugin install plugin-name@marketplace-name` (discover-plugins.md L313), and non-interactive `claude plugin install formatter@your-org --scope project` (discover-plugins.md L433). No Windows-specific install syntax was found.
- Git-hosted marketplaces and plugins are cloned: "When users add a marketplace hosted in a git repository, or install a git-based plugin it lists, Claude Code clones that marketplace or plugin repository onto their machine. The clone never downloads Git LFS content" (plugin-marketplaces.md L760). Only the `archive` source "Works without git or npm on the user's machine. Requires Claude Code v2.1.224 or later" (plugin-marketplaces.md L266); the `npm` source is "fetched with your npm client" (L265). Inference: a `github`/`url`/`git-subdir` source, or a relative-path entry inside a git-hosted marketplace, needs git on the user's machine.
- Cache path: "Claude Code copies each installed plugin into the local versioned plugin cache at `~/.claude/plugins/cache`" (plugin-marketplaces.md L257); marketplace state in `~/.claude/plugins/known_marketplaces.json` (plugin-marketplaces.md L899); `${CLAUDE_PLUGIN_DATA}` is `~/.claude/plugins/data/{id}/` with the `@` replaced, e.g. `formatter-my-marketplace` (plugins-reference.md L760). On Windows, "`~/.claude` means `%USERPROFILE%\.claude`. To keep the home-directory files somewhere else, set `CLAUDE_CONFIG_DIR`; Claude Code then stores your settings, session history, and plugins there instead." (settings.md L440)
- Separators in manifests: "On macOS and Linux, Claude Code refuses an entry path with a backslash anywhere past the leading `./`, so write the separators as `/` on every platform." (plugin-marketplaces.md L295). "On macOS and Linux, Claude Code also rejects a component path that contains a backslash anywhere in it, even when the path stays inside the plugin. Components declared with backslash paths therefore load on Windows only." (plugins-reference.md L862; same statement at errors.md L3108, fix at L3122); error text: `commands path escapes plugin directory: ./commands\deploy.md — its path contains a backslash, which is not resolved reliably on this platform` (errors.md L3111). The marketplace-entry refusal also names "network-shaped, backslash-containing" entries (errors.md L3166).
- `command` sources: "On Windows, the path is a UNC path" is a refusal case (plugin-marketplaces.md L626); "Claude Code doesn't support link mode on Windows and refuses to install a link-mode plugin there. Declare `"mode": "copy"` instead." (plugin-marketplaces.md L644).
- Symlinks inside a marketplace: "On Windows, use `mklink /D` from an elevated Command Prompt or enable Developer Mode" (plugins-reference.md L878).
- `CLAUDE_CODE_PLUGIN_SEED_DIR` separates entries with "`:` on Unix or `;` on Windows" (plugin-marketplaces.md L906; env-vars.md L335).
- Node dependencies install automatically only with `package.json` plus `bun.lock`/`bun.lockb`/`npm-shrinkwrap.json`/`package-lock.json`, via `npm ci --ignore-scripts` or `bun install --frozen-lockfile --ignore-scripts`, run "from the user's PATH", with a 60-second timeout, and "A failed or skipped install never blocks the plugin" (plugins-reference.md L831-L853). "The filename match ignores letter case." for `bunfig.toml` (plugins-reference.md L841).
- BOM: "Before v2.1.246, Claude Code also produced this error for a `plugin.json` saved as UTF-8 with a leading byte-order mark (BOM)" (plugins-reference.md L1405).
- Settings location differs on Windows: `.claude/settings.local.json` stays with `.claude/settings.json` (not the repo root) "outside a git repository, when the repository root is your home directory, on Windows, or when the repository root or its `.git` or `.claude` entry isn't owned by your user" (settings.md L481).
- Plugin evals: "Native Windows has no backend, so run shell-granting suites under WSL2" (plugin-evals.md L322).

---

## 5. Cross-session messaging and agent teams on native Windows vs WSL 2

- Version gates: "Cross-session messaging requires Claude Code v2.1.224 or later on macOS and Linux, including Linux inside WSL 2. On native Windows, it requires Claude Code v2.1.234 or later." (cross-session-messaging.md L10; repeated L334). On Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, Microsoft Foundry, or with feature-flag fetching off, same-machine messaging requires v2.1.248+ (L338).
- Transport: "Over a per-session socket on macOS and Linux, or a per-session named pipe on native Windows, never through Anthropic servers" (L158). "The socket is a Unix domain socket on macOS and Linux, including Linux inside WSL 2, and a named pipe on native Windows." (L266)
- Isolation: "A session inside WSL 2 and a native Windows session on the same computer can't reach each other either, because they register under different home directories and listen on different socket types." (L168). "Each session registers itself in files on disk ... two sessions can reach each other only when they can see the same files." (L166)
- Auth: "On native Windows, it instead requires each connection to authenticate first with a key that only your operating-system user can read." (L275). Auth line `{"type":"auth","token":"<token>"}` from `CLAUDE_CODE_MESSAGING_TOKEN`: "**macOS and Linux, including WSL 2**: the line is optional." / "**Native Windows**: the line is required. Claude Code closes any connection whose first line isn't a valid auth line and delivers nothing from that connection." (L279-L282). "On native Windows, that token is the only way Claude Code verifies an own-child message." (L292). The `/tmp/cc-socks-<uid>` fallback directory is macOS/Linux only (L277). A connection must send a complete line within 30 seconds (L284).
- Socket path export: `CLAUDE_CODE_MESSAGING_SOCKET` is exported to hooks and Bash commands "before any hook runs, including `SessionStart`" (L271-L273); `/status` shows it "prefixed with `uds:`" (L270).
- Bare mode sessions don't bind the socket; `claude -p` sessions do (L247).
- Agent teams: "Split-pane mode isn't supported in VS Code's integrated terminal, Windows Terminal, or Ghostty." (agent-teams.md L481). No other native-Windows or WSL note for agent teams was found in agent-teams.md (grep for windows/wsl/powershell/git bash: single hit).
- WSL 2 reaching Windows binaries: under the Bash sandbox, `sandbox.network.allowAllUnixSockets: true` "On WSL2 ... also reopens the interop socket that launches Windows binaries such as `cmd.exe` and `powershell.exe`" (settings-reference.md L2429); a WSL hook that calls `powershell.exe` needs it "on your `PATH` through Windows interop" (hooks-guide.md L177). Sandboxing itself is macOS/Linux/WSL2 only; "On Windows, sandboxing is not supported" (settings-reference.md L732; tools-reference.md L446).

---

## 6. Skills and agents on Windows

- Skill frontmatter `shell`: "Accepts `bash` (default) or `powershell`. Setting `powershell` runs inline shell commands via PowerShell when the PowerShell tool is enabled: it's on by default on Windows without Git Bash, on by default with Git Bash for claude.ai and Console accounts, and needs `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions and on macOS, Linux, and WSL." (skills.md L349).
- Plugin relevance `cli` signal: "Applies on every platform: commands run on Windows through PowerShell or Git Bash are recorded the same way." (plugin-relevance.md L74).
- "`shell: bash` when bash isn't available: the invocation fails before any command runs. This happens on Windows without Git Bash. Claude Code shows ``Skill <name> requires bash (`shell: bash` in frontmatter) but Git Bash was not found``" (skills.md L648; errors.md L2644 says "Install Git for Windows or change the frontmatter to `shell: powershell`"). "Any other combination: the commands run through the Bash tool when bash is available. When it isn't, they run through the PowerShell tool." (skills.md L649)
- `shell: powershell` "Requires the PowerShell tool to be enabled." (tools-reference.md L423), unlike hooks, where `"shell": "powershell"` works regardless (tools-reference.md L422).
- Agents: no Windows-specific agent note beyond the PowerShell `--agents @'...'@` here-string example (sub-agents.md L205-L215) and the hook advice at sub-agents.md L685.
- Line endings, executable bits, or CRLF for skill/agent files: **Not found in docs** (searched skills.md and sub-agents.md for CRLF, line ending, chmod, executable; the only `chmod +x` hits are for Unix hook scripts at sub-agents.md L680/L1369).

---

## 7. Long paths, case-insensitivity, CRLF, file names

- Path length: the only mentions are `CLAUDE_CODE_TMPDIR` ("some tools fail when temp paths get too long", macOS/Linux sandbox context, env-vars.md L384) and transcript write failures on "a path over the filesystem's length limit" (errors.md L3953). No 260-character/MAX_PATH guidance: **Not found in docs** (searched all files for "260", "path length", "long path").
- Case-insensitivity: `plugin-relevance` `cwd` and `filesRead` globs are "Forward-slash normalized and case-insensitive" (plugin-relevance.md L73, L76); `manifestDeps.file` regexes are not separator-normalized, so use `[/\\\\]package\\.json$` in JSON form (plugin-relevance.md L77, L83). PowerShell permission matching is case-insensitive (permissions.md L326). Bun `bunfig.toml` "filename match ignores letter case" (plugins-reference.md L841). General filesystem case-insensitivity guidance: **Not found in docs**.
- CRLF: the only CRLF mention is a `FileChanged` example that strips `\r` with `perl -pi -e 's/\r$//'` and is tested by asking Claude to "append a CRLF line to `data.csv`" (hooks.md L2892-L2900). No statement about how Claude Code handles CRLF in hook JSON, `SKILL.md`, or `hooks.json`: **Not found in docs**.
- File names: `plugin.json` `name` is "Unique identifier in kebab-case, with no spaces, control characters, or bidirectional-formatting characters" (plugins-reference.md L498). Separately, the `claude plugin init <name>` argument "Becomes the skill namespace and the directory name under `~/.claude/skills/`, so it cannot contain spaces or path separators" (L975; this is the CLI scaffold argument, not the `plugin.json` field). `${CLAUDE_PLUGIN_DATA}` id replaces characters outside `a-z A-Z 0-9 _ -` with `-` (L760). UTF-8 BOM in `plugin.json` broke before v2.1.246 (L1405).
- UNC/network paths: refused as working directories; "Mapped drive letters and `\\wsl$` paths don't count as network paths." (errors.md L4084). Bash/PowerShell commands with UNC arguments always prompt (permissions.md L272).
- Antivirus: transcript write warnings are delayed for "permission errors on Windows, where an antivirus scan can fail a single write that then succeeds on retry" (errors.md L3954).
- WSL file-discovery timeout: `CLAUDE_CODE_GLOB_TIMEOUT_SECONDS` "Defaults to 20 seconds on most platforms and 60 seconds on WSL" (env-vars.md L295).

---

## 8. What Synchrobuilder must test on a Windows CI runner

Each item derives from a cited fact above.

1. Exec-form hooks: `"command": "node"` + `args` with `${CLAUDE_PLUGIN_ROOT}/...mjs` resolve and run without a shell on Windows (hooks.md L470, L475, L480-L486). Verify `process.env.CLAUDE_PLUGIN_ROOT`/`CLAUDE_PROJECT_DIR`/`CLAUDE_PLUGIN_DATA` are populated (hooks.md L497).
2. Never ship a hook or monitor that names a `.cmd`/`.bat` shim in exec form (hooks.md L475).
3. `tool_input.file_path` arrives as `C:\project\src\index.ts`; the guard hook must normalize `\` to `/` before matching and must not anchor with `^` (hooks.md L1604-L1620, L1998).
4. Test both Windows configurations: Git Bash installed (Bash tool present, PowerShell tool on by default for claude.ai/Console accounts) and Git Bash absent (no Bash tool registered, PowerShell tool auto-enabled) (tools-reference.md L391-L392; hooks.md L1673-L1675). Any matcher that inspects shell commands must be `Bash|PowerShell` (hooks.md L1671). Also run the Git-Bash-present case with `CLAUDE_CODE_USE_POWERSHELL_TOOL=0` and with feature-flag fetching off, where shell commands route through Git Bash instead (env-vars.md L394, L523).
5. Any status line the plugin documents must use forward slashes in `command` and must work when routed through Git Bash and through PowerShell (statusline.md L1033-L1047).
6. Monitors run through a shell whose Windows identity is undocumented; test a `monitors.json` `command` on both Git Bash-present and Git Bash-absent runners (plugins-reference.md L293, L325; Section 3 "Not found").
7. Marketplace entry and `plugin.json` component paths use `/` only; run `claude plugin validate` on Linux/macOS as well, since backslash paths load on Windows only (plugin-marketplaces.md L295; plugins-reference.md L862).
8. Install via git clone on a runner with git on PATH; confirm cache lands under `%USERPROFILE%\.claude\plugins\cache` (plugin-marketplaces.md L257, L760; settings.md L440). Ship `package-lock.json` if any dependency is needed; confirm `npm ci --ignore-scripts` completes within 60 s (plugins-reference.md L831-L849).
9. Cross-session messaging on native Windows: requires v2.1.234+; the named pipe requires the auth line first; WSL 2 and native sessions cannot see each other (cross-session-messaging.md L10, L168, L282). If Synchrobuilder ever posts to the inbox, test the auth line on Windows.
10. Skills that inject `` !`command` `` output must not rely on `shell: bash` on a Git Bash-less runner (skills.md L648).
11. Save all JSON/Markdown as UTF-8 without BOM to stay safe on versions before v2.1.246 (plugins-reference.md L1405).
12. Verify hook output JSON is not polluted by a Git Bash profile `echo` on the runner (hooks-guide.md L1027-L1034).
13. Don't rely on `chmod +x` or shebangs for Windows; the docs' troubleshooting for hooks assumes Unix (plugins-reference.md L1394, L1415-L1418).
14. Link-mode plugins are refused on Windows; use copy mode only (plugin-marketplaces.md L644).

---

## Implications for Synchrobuilder

- The brief's "all hooks are Node ESM invoked as `node <path>`" maps directly onto the documented cross-platform pattern: exec form with `"command": "node"` and `"args": ["${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"]` (hooks.md L475, L480-L486). This avoids Git Bash vs PowerShell differences, profile pollution (hooks-guide.md L1027), the PowerShell placeholder-rewrite version gate (hooks.md L3813-L3817), and `CLAUDE_CODE_SHELL_PREFIX` wrapping (env-vars.md L358).
- The guard hook (after Write/Edit) must normalize backslashes in `tool_input.file_path` before comparing to claim/audit records; claims stored with forward slashes will never match raw Windows paths otherwise (hooks.md L1604-L1606). Store paths in a canonical form (forward slashes, drive letter case decided by experiment) in `state/<handle>/`.
- Presence on the main status line cannot be shipped by a plugin: plugin `settings.json` supports only `agent` and `subagentStatusLine` (plugins-reference.md L955). `/synchrobuilder:setup` could offer, with consent, to write a `statusLine` into the user's `settings.json` with a forward-slash path and `node` invocation; that path must be tested through Git Bash and PowerShell (statusline.md L1033-L1035).
- Monitors are shell-form only and the Windows shell is undocumented; if the background sync loop is a plugin monitor, write the `command` as `node "${CLAUDE_PLUGIN_ROOT}/scripts/sync.mjs"` and verify on both Windows configurations. Note monitors are skipped where the Monitor tool is unavailable, including when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (tools-reference.md L343), so the SessionStart/UserPromptSubmit hooks must remain the fallback for reading the snapshot cache.
- `/synchrobuilder:notify` delivery "sooner if plugin monitors allow" cannot use cross-session messaging as a transport between teammates' machines (it is same-machine or via Anthropic servers, L158) and a native-Windows inbox requires the auth line (L282); the git-branch transport remains the only cross-machine path.
- Team identity: `.claude/settings.local.json` on Windows stays in the starting directory's `.claude/`, not the repo root (settings.md L481); do not assume the repo-root location when the audit inspects settings.
- Website install page: the verified commands are `/plugin marketplace add <owner>/<repo>` (discover-plugins.md L229 form) and `/plugin install <name>@<marketplace>` (discover-plugins.md L313); no Windows variant exists. State that git must be on PATH for a GitHub-hosted marketplace (plugin-marketplaces.md L760, L266).
- Naming: a plugin skill is always namespaced `/plugin-name:skill`, but "The bare `/fancy` also invokes the skill unless another command already uses that name" (skills.md L389), so `/audit` may work as a de facto short form when unclaimed; there is no documented alias or short-prefix mechanism for plugins (plugins.md L116-L118).

## Conflicts with the brief

| Brief claim | What the docs say | Citation |
| :-- | :-- | :-- |
| "Status line should show presence IF the docs confirm plugins can drive the status line." | Plugin `settings.json` supports only `agent` and `subagentStatusLine`; the main `statusLine` is not a plugin-settable key. | plugins-reference.md L955; plugins.md L269; statusline.md L1107 |
| "NO bash/PowerShell/cmd anywhere in shipped code" | Monitors have no exec form; the `command` "runs through a shell" (identity on Windows undocumented). Also `apiKeyHelper`, `headersHelper`, and `command` sources run via `cmd`/`cmd.exe` on Windows. A Node monitor command still passes through a shell line. | plugins-reference.md L325, L337; settings-reference.md L5265; plugin-marketplaces.md L554, L620 |
| "hooks before edits and on every prompt must be ... under 50 ms" | No latency figure or budget for hooks is documented; the only Windows-specific speed note is that `-NoProfile` makes PowerShell hooks "start fast". | hooks.md L163 |
| "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)" | Monitors "run only in interactive CLI sessions" and are skipped where the Monitor tool is unavailable (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`). | plugins-reference.md L295; tools-reference.md L343 |
| "Identity from git config user.email" / team install via GitHub marketplace | Git-based marketplaces are cloned, so git must be present; only `archive` sources work "without git or npm on the user's machine" (v2.1.224+). Nothing prevents the design, but the install page must say git is required. | plugin-marketplaces.md L760, L266 |
| Expected install `/plugin install synchrobuilder@<marketplace>` | Confirmed form `/plugin install plugin-name@marketplace-name`; no conflict. | discover-plugins.md L313 |

## Open questions

1. Which shell runs a plugin monitor `command` on Windows (Git Bash vs PowerShell vs cmd), and whether `node "${CLAUDE_PLUGIN_ROOT}/x.mjs"` survives Git Bash backslash handling when `CLAUDE_PLUGIN_ROOT` contains `C:\...` (no doc; statusline.md L1035 shows Git Bash eats unquoted backslashes).
2. Exact `tool_input.file_path` drive-letter casing on Windows (`C:` vs `c:`) and whether `cwd` in hook input uses backslashes too; needed for canonical claim keys (hooks.md L1604 covers separators only).
3. Whether `${CLAUDE_PLUGIN_ROOT}` substituted into exec-form `args` on Windows uses backslashes or forward slashes, and whether Node accepts either for `import()` of `.mjs` files.
4. Whether a `node`-based status line command written as `node C:/Users/.../statusline.mjs` works under both Git Bash and PowerShell routing (docs only show `powershell -File` and a `.sh`).
5. Hook wall-clock startup time for `node` on Windows CI (Defender scanning, first-run JIT) relative to the brief's 50 ms target; no doc figure exists.
6. Which stdio MCP launch shell is used on Windows, and whether `"command": "node"` in `.mcp.json` needs any wrapper (mcp.md has no Windows note).
7. Whether CRLF line endings in `hooks.json`, `SKILL.md` frontmatter, or `plugin.json` (from `core.autocrlf=true` checkouts) parse correctly on the local v2.1.218 build and on whatever release the docs' v2.1.275 markers correspond to.
8. Behavior on Windows when `%USERPROFILE%` path contains spaces or non-ASCII characters for `~/.claude/plugins/cache` and `${CLAUDE_PLUGIN_DATA}` (docs give no guidance).
9. Whether the "bare `/fancy`" shortcut (skills.md L389) makes `/audit`, `/fix`, etc. reachable without the `synchrobuilder:` prefix in practice, and which bundled command names collide.
