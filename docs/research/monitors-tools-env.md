# Monitors, tool names, PowerShell, and environment variables

Research note for Synchrobuilder (key: `monitors-tools-env`).

## Source

- https://code.claude.com/docs/en/tools-reference (raw: `tools-reference.md`, 630 lines)
- https://code.claude.com/docs/en/env-vars (raw: `env-vars.md`, 538 lines; the variable table is one row per line, L136-L498)
- https://code.claude.com/docs/en/agent-view (raw: `agent-view.md`; only L9, L134, and L413 used)
- Cross-check only: https://code.claude.com/docs/en/plugins-reference (raw: `plugins-reference.md` L291-L295, L337, L713-L731)

Fetch date: 2026-09-18 (raw Markdown downloaded from code.claude.com/docs/en/<page>.md). The highest version marker that appears in the four raw files is v2.1.274 (`grep -o 'v2\.1\.[0-9]*'`); no source states which npm release is current. The local CLI used for experiments reports `2.1.218 (Claude Code)` from `claude --version`.

In each raw file the first 4 lines are an index preamble; content starts at the `# ` title on line 5.

---

## 1. Exact built-in tool names (for hook matchers)

The tool table is `tools-reference.md` L19-L66. The page states the names are the exact strings used in hook matchers (tools-reference.md L9):

> Claude Code has access to a set of built-in tools that help it understand and modify your codebase. The tool names are the exact strings you use in [permission rules](...), [subagent tool lists](...), and [hook matchers](...).

Names confirmed present in the table (one row each, with line number):

| Tool name | Line | Permission required (Manual mode) |
| :-- | :-- | :-- |
| `Agent` | L21 | No |
| `Artifact` | L22 | Yes |
| `AskUserQuestion` | L23 | No |
| `Bash` | L24 | Yes |
| `CronCreate` / `CronDelete` / `CronList` | L25-L27 | No |
| `Edit` | L28 | Yes |
| `EndConversation` | L29 | No |
| `EnterPlanMode` / `ExitPlanMode` | L30, L32 | No / Yes |
| `EnterWorktree` / `ExitWorktree` | L31, L33 | Yes / No |
| `Glob` | L34 | No ("Absent by default on macOS, Linux, and WSL") |
| `Grep` | L35 | No ("Absent by default on macOS, Linux, and WSL") |
| `ListAgents` | L36 | No |
| `ListMcpResourcesTool` | L37 | No |
| `LSP` | L38 | No |
| `Monitor` | L39 | Yes |
| `NotebookEdit` | L40 | Yes |
| `PowerShell` | L41 | Yes |
| `PushNotification` | L42 | No |
| `Read` | L43 | No |
| `ReadMcpResourceTool` | L44 | No |
| `RemoteTrigger` | L45 | No |
| `ReportFindings` | L46 | No |
| `ScheduleWakeup` | L47 | No |
| `SendFeedback` | L48 | No |
| `SendMessage` | L49 | No |
| `SendUserFile` | L50 | No |
| `ShareOnboardingGuide` | L51 | Yes |
| `Skill` | L52 | Yes |
| `SubagentHandback` | L53 | No |
| `TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate` | L54-L56, L59 | No |
| `TaskOutput` | L57 | No (deprecated in favor of `Read` on the output file path) |
| `TaskStop` | L58 | No |
| `TodoWrite` | L60 | No |
| `ToolSearch` | L61 | No |
| `WaitForMcpServers` | L62 | No |
| `WebFetch` | L63 | Yes |
| `WebSearch` | L64 | Yes |
| `Workflow` | L65 | Yes |
| `Write` | L66 | Yes |

**MultiEdit**: Not found in docs. `grep -n -F MultiEdit tools-reference.md env-vars.md` returns nothing; the tool table (L19-L66) has no `MultiEdit` row. Treat it as no longer a documented tool name.

The `Monitor` row verbatim (tools-reference.md L39):

> | `Monitor` | Runs a command in the background and feeds each output line back to Claude, so it can react to log entries, file changes, or polled status mid-conversation. Can also open a WebSocket and treat each incoming message as an event. See [Monitor tool](#monitor-tool) | Yes |

Hook matcher format (tools-reference.md L95):

> Hook `matcher` fields use bare tool names, not the parenthesized rule format. See [matcher patterns](/docs/en/hooks#matcher-patterns) for the matching rules. For the field names each tool passes to `tool_input` in hooks, see the [PreToolUse input reference](/docs/en/hooks#pretooluse-input).

Permission-rule family groupings relevant to a guard hook (tools-reference.md L82-L85): `Bash(npm run *)` applies to "Bash, Monitor"; `PowerShell(Get-ChildItem *)` applies to PowerShell; `Read(~/secrets/**)` applies to "Read, Grep, Glob, LSP"; `Edit(/src/**)` applies to "Edit, Write, NotebookEdit". NotebookEdit also documented at L385: "Permission rules use the `Edit(...)` path format."

Glob/Grep absence on macOS/Linux/WSL matters for hook matchers (tools-reference.md L263):

> On macOS, Linux, and WSL, Claude Code leaves Glob and [Grep](#grep-tool-behavior) out of the default tool set, and Claude searches with `find` and `grep` through the Bash tool instead. In Claude's shell those two commands run embedded versions of `bfs` and `ugrep`, and the searches reach your hooks and permission rules as `Bash` calls.

Bash-viewing of files counts as a read for edit eligibility (tools-reference.md L227):

> Viewing a file with Bash also satisfies the read-before-edit requirement when the command is `cat`, `nl`, `bat`, `batcat`, `head`, `tail`, `sed -n 'X,Yp'`, `grep`, `egrep`, `fgrep`, or `rg` on a single file with no pipes or redirects.

---

## 2. Monitor tool section (tools-reference.md L321-L373)

Purpose and mechanism (L323, L331, L333):

> The Monitor tool lets Claude watch something in the background and react when it changes, without pausing the conversation.

> For most watches, Claude writes a small script, runs it in the background, and receives each output line as it arrives. For a server that already pushes events, Claude can open a [WebSocket](#websocket-source) instead of running a script.

> You keep working in the same session and Claude interjects when an event arrives.

Deadlines (L335, L337):

> Every watch Claude starts has a deadline: 5 minutes by default, at most 30 minutes, and at most 10 minutes in a [non-interactive](/docs/en/headless) run given a single prompt with `-p`.

> At the deadline the watch ends. Claude gets one notice, so it can start the watch again if it's still needed.

Stopping (L339):

> Stop a monitor by asking Claude to cancel it or by ending the session. When you stop a [subagent](/docs/en/sub-agents) that started monitors, for example from `/tasks`, those monitors stop with it.

Permission rules (L341, L343):

> When Monitor runs a command, it uses the same [permission rules as Bash](/docs/en/permissions#tool-specific-permission-rules), so `allow` and `deny` patterns you have set for Bash apply here too. While [auto mode](...) is active, Claude Code sets aside allow rules that name `Monitor` itself, along with the other [broad allow rules it drops](...), so the classifier reviews Monitor commands the same way it reviews Bash commands.

> The [WebSocket source](#websocket-source) has its own approval prompt, which the classifier also decides in auto mode.

Availability exclusions (L345):

> The tool is not available on Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry. It is also not available when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.

Link to plugin monitors (L347):

> Plugins can declare monitors that start automatically when the plugin is active, instead of asking Claude to start them. See [plugin monitors](/docs/en/plugins-reference#monitors).

How output lines reach Claude: the doc says only that Claude "receives each output line as it arrives" (L331) and the table row says the tool "feeds each output line back to Claude" (L39). The exact wire format of the injected line (block label, truncation) is not described in tools-reference.md. Not found in docs: any per-line size cap, a rate limit, or a description of how a Monitor line appears in the transcript.

WebSocket source (L349-L373): requires v2.1.195 or later (L352). Input is `ws` with `url` (required, `ws://` or `wss://`, ASCII only, no embedded credentials) and `protocols` (optional) (L364-L367). "A WebSocket watch takes a `ws` input in place of `command`, and a single Monitor call can't combine the two." (L362). The `timeout_ms` input name appears at L369:

> The `timeout_ms` deadline applies to a WebSocket watch too: the watch ends at the deadline, and `TaskStop` cancels it early.

L373 verbatim: "Claude Code denies URLs that point at a private, link-local, or cloud-metadata address, including hostnames that resolve to one. It also denies hosts in `sandbox.network.deniedDomains`, and when `allowManagedDomainsOnly` is set in managed settings, any host outside the managed allowlist." Loopback (`ws://127.0.0.1`, `localhost`) is not named; whether a local WebSocket bridge is refused is an inference, not a documented fact. Not relevant to Synchrobuilder's git transport either way.

Memory cap interaction (L191, L194): on Linux and WSL, `CLAUDE_CODE_TOOL_MEMORY_LIMIT` caps Bash, PowerShell, and Monitor commands together; "Before v2.1.246, Monitor tool commands ran outside the cap." (L191).

### Plugin monitors: deadline vs session lifetime

tools-reference.md itself says nothing about plugin monitor duration. The cross-check (plugins-reference.md L293, L295):

> Plugins can declare background monitors that Claude Code starts automatically when the plugin is active. Each monitor runs a shell command for the lifetime of the session and delivers every stdout line to Claude as a notification, so Claude can react to log entries, status changes, or polled events without being asked to start the watch itself.

> Plugin monitors use the same mechanism as the [Monitor tool](/docs/en/tools-reference#monitor-tool) and share its availability constraints. They run only in interactive CLI sessions, run unsandboxed at the same trust level as [hooks](#hooks), and are skipped on hosts where the Monitor tool is unavailable.

So: the 5/30/10-minute deadline (tools-reference.md L335) is stated for "Every watch Claude starts"; plugin monitors are declared to run "for the lifetime of the session" (plugins-reference.md L293). The two docs do not contradict each other, but neither explicitly says whether the deadline is waived for plugin-declared monitors. They do share the availability exclusions (providers, `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) and plugin monitors are additionally limited to interactive CLI sessions (L295).

Related: a running monitor is stopped when a session is backgrounded via agent view (agent-view.md L413: "Claude Code stops work that can't carry over, such as a running [monitor]").

---

## 3. PowerShell tool section (tools-reference.md L387-L446)

When Windows uses PowerShell vs Git Bash (L389-L393):

> The PowerShell tool lets Claude run PowerShell commands natively. On Windows, this means commands run in PowerShell instead of routing through Git Bash. How the tool becomes available depends on your platform:
>
> * **Windows without Git Bash**: the tool is enabled automatically.
> * **Windows with Git Bash installed**: the tool is on by default for claude.ai and Console accounts; set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` to enable it in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions, or `0` to turn it off.
> * **Linux, macOS, and WSL**: the tool is opt-in.

Hook input for PowerShell (L395, L397):

> Your [PreToolUse hooks](/docs/en/hooks#powershell) receive the tool's command string in `tool_input.command`, with the same fields as the Bash tool.

> Match `Bash|PowerShell` in hooks that inspect shell commands; the [PowerShell hook input section](/docs/en/hooks#powershell) explains why matching `Bash` alone is not enough.

Enabling (L401-L415):

```json
{
  "env": {
    "CLAUDE_CODE_USE_POWERSHELL_TOOL": "1"
  }
}
```

> On Windows, set the variable to `0` to turn the tool off. On Linux, macOS, and WSL, the tool requires PowerShell 7 or later: install `pwsh` and ensure it is on your `PATH`. (L411)

> On Windows, Claude Code auto-detects `pwsh.exe` for PowerShell 7+ with a fallback to `powershell.exe` for PowerShell 5.1. When the tool is enabled, Claude treats PowerShell as the primary shell. The Bash tool remains available for POSIX scripts when Git Bash is installed. (L413)

> Claude Code spawns PowerShell with `-ExecutionPolicy Bypass` at process scope only, so `.ps1` scripts and module imports work on default Windows installs without changing the machine's policy. Process-scope bypass doesn't override Group Policy `MachinePolicy` or `UserPolicy`, so enterprise policies still apply. To respect the machine's effective execution policy instead, set `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY=1`. (L415)

Shell selection for hooks (L419-L423):

> * `"defaultShell": "powershell"` in [`settings.json`](...): routes interactive `!` commands through PowerShell. Requires the PowerShell tool to be enabled.
> * `"shell": "powershell"` on individual [command hooks](/docs/en/hooks#command-hook-fields): runs that hook in PowerShell. Hooks spawn PowerShell directly, so this works regardless of `CLAUDE_CODE_USE_POWERSHELL_TOOL`.
> * `shell: powershell` in [skill frontmatter](...): runs `` !`command` `` blocks in PowerShell. Requires the PowerShell tool to be enabled.

Preview limitations (L443-L446): "PowerShell profiles are not loaded" and "On Windows, sandboxing is not supported". Windows encoding fixes require v2.1.214 or later (L431-L439).

The feature-flag dependency (env-vars.md L523): with feature-flag fetching off, you cannot

> Get the [PowerShell tool](...) by default for claude.ai and Console accounts on Windows with Git Bash installed; Claude Code routes shell commands through Git Bash unless you set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1`. On Windows without Git Bash, the tool stays on

`CLAUDE_CODE_GIT_BASH_PATH` (env-vars.md L292):

> | `CLAUDE_CODE_GIT_BASH_PATH` | Windows only: path to the Git Bash executable (`bash.exe`). Use when Git Bash is installed but not in your PATH. If the path doesn't exist or the file isn't named `bash.exe`, `sh.exe`, `bash`, or `sh`, Claude Code ignores the variable and auto-detects Git Bash as if it were unset, logging a warning visible with `--debug`. Before v2.1.219, Claude Code exited at startup when the path didn't exist, and used any existing file as the shell without checking that it was bash or sh. See [Windows setup](/docs/en/setup#set-up-on-windows) |

`CLAUDE_CODE_USE_POWERSHELL_TOOL` (env-vars.md L394):

> | `CLAUDE_CODE_USE_POWERSHELL_TOOL` | Controls the PowerShell tool. On Windows without Git Bash, the tool is enabled automatically; set to `0` to disable it. On Windows with Git Bash installed, the tool is on by default for claude.ai and Console accounts; set to `1` to enable it in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions, or `0` to turn it off. On Linux, macOS, and WSL, set to `1` to enable it, which requires `pwsh` on your `PATH`. When enabled on Windows, Claude can run PowerShell commands natively instead of routing through Git Bash. See [PowerShell tool](/docs/en/tools-reference#powershell-tool) |

`CLAUDE_CODE_DISABLE_WINDOWS_SHELL_LAUNCHER` (env-vars.md L268): by default Windows PowerShell tool commands start through a `cmd.exe` launcher so backgrounded commands can carry over to the session's next process; set to `1` to start them directly. Requires v2.1.269 or later.

---

## 4. Edit/Write `tool_input` fields and `tool_response` shape

Not found in tools-reference.md. The page defers explicitly (L95): "For the field names each tool passes to `tool_input` in hooks, see the [PreToolUse input reference](/docs/en/hooks#pretooluse-input)." `grep -n -F tool_response tools-reference.md` returns nothing; `tool_input` appears only at L95 (the deferral above) and L395 (`tool_input.command` for PowerShell/Bash). The only Edit parameter names documented here are `old_string`, `new_string`, and `replace_all` (L217, L223). What tools-reference.md does say about Edit/Write behavior:

- Edit is exact string replacement, no regex or fuzzy match (L217). Three checks: read-before-edit, match, uniqueness (L219-L223). A `Read` deny rule refuses the edit, including creating a new file there (requires v2.1.208 on edits, v2.1.228 on writes) (L93, L219).
- Write "creates a new file or overwrites an existing one with the full content provided. It doesn't append or merge." (L597). Read-before-overwrite depends on model; new files never need a prior read (L599-L605).
- Read returns contents with line numbers; "Claude is instructed to always pass absolute paths." (L450).

---

## 5. env-vars entries (verbatim rows)

Rules for on/off values (env-vars.md L120-L131): most variables accept `1`/`true` on and `0`/`false` off; but `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_TMUX_TRUECOLOR`, `FALLBACK_FOR_ALL_PRIMARY_MODELS`, `IS_DEMO` "read only whether you set them at all, so any non-empty value including `0` turns the behavior on" (L122-L129).

Settings-file `env` precedence (L105): "When the same variable is set in both your shell and a settings file `env` block, the settings file value applies. Claude Code writes each `env` entry into the process environment, replacing the value inherited from the shell." Also L107: "Subprocesses still inherit the empty value." And L113: "Claude Code reads shell environment variables at startup, so changes to them take effect the next time you launch `claude`. Variables set under the `env` key in settings files are reapplied to a running session when the file changes".

### Requested variables

**`CLAUDE_CODE_ENTRYPOINT`**: Not found in docs. `grep -n -F CLAUDE_CODE_ENTRYPOINT env-vars.md tools-reference.md` returns nothing; the only "entrypoint" mention is `OTEL_METRICS_INCLUDE_ENTRYPOINT` (L474: "Set to `true` to include the session entrypoint in metrics attributes (default: excluded). Added in v2.1.152."). Values such as `cli` or `sdk-cli` are not documented (`grep -F sdk-cli` returns nothing).

**`CLAUDE_CODE_REMOTE`** (L344):

> | `CLAUDE_CODE_REMOTE` | Set automatically to `true` when Claude Code is running as a [cloud session](/docs/en/claude-code-on-the-web). Read this from a hook or setup script to detect whether you are in a cloud session |

**`CLAUDE_CODE_REMOTE_SESSION_ID`** (L345): "Set automatically in [cloud sessions] to the current session's ID."

**`CLAUDE_ENV_FILE`** (L406):

> | `CLAUDE_ENV_FILE` | Path to a shell script whose contents Claude Code runs before each Bash command in the same shell process, so exports in the file are visible to the command. Use to persist virtualenv or conda activation across commands. Also populated dynamically by [SessionStart](/docs/en/hooks#persist-environment-variables), [Setup](/docs/en/hooks#setup), [CwdChanged](/docs/en/hooks#cwdchanged), and [FileChanged](/docs/en/hooks#filechanged) hooks |

**`CLAUDE_PLUGIN_ROOT`**, **`CLAUDE_PLUGIN_DATA`**, **`CLAUDE_PROJECT_DIR`**: Not found in env-vars.md or tools-reference.md (`grep -n -F` for each returns nothing in these two files). The only related env-vars row is `CLAUDE_CODE_PROJECT_DIR_NAME` (L339), which names the `projects/` transcript directory when `CLAUDE_CONFIG_DIR` is set; it is not the project path. They ARE defined on the cross-check page, plugins-reference.md L713-L721: `${CLAUDE_PLUGIN_ROOT}` is the "Absolute path to the plugin's installation directory" (L717), `${CLAUDE_PLUGIN_DATA}` a "Persistent directory that survives plugin updates, created on first reference" (L718), `${CLAUDE_PROJECT_DIR}` "The project root" (L719), and L721 verbatim:

> All three are exported as environment variables to hook processes and to MCP and LSP server subprocesses. They aren't present in the environment of commands Claude runs through the Bash tool, in the main session or in a subagent. In plugin content, write the placeholder instead, and Claude Code substitutes the path inline when it loads the content.

The substitution table (L723-L729) lists "Hook and monitor commands: Anywhere the placeholder appears" (L726); L731 shows `"${CLAUDE_PROJECT_DIR}/scripts/server.sh"` as a shell-form example. Whether the three are exported to plugin *monitor* processes (as opposed to substituted in their command string) is not stated at L721, which names only hook, MCP, and LSP processes.

**`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`** (L258):

> | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Set to any non-empty value, such as `1`, to disable nonessential network traffic: auto-updates, telemetry, error reporting, the `/feedback` command, [Claude-drafted feedback](...), release notes, the [PR and MR status badge](...) checks, and availability checks such as the [fast mode](...) check. It also stops the [background runs of plugin `command` sources](/docs/en/plugin-marketplaces#when-claude-code-re-runs-the-command), which are local commands rather than network traffic, because they can trigger dependency installs. **Setting it to `0` or `false` still disables this traffic**, unlike most on/off variables; unset the variable to allow it again. Also disables feature-flag fetching, which makes [Remote Control](...) and the other [features that need feature-flag fetching](#features-that-need-feature-flag-fetching) unavailable. Official plugin marketplace auto-install isn't covered; disable it with `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL`. Doesn't affect [gateway model discovery](...), which has its own opt-in |

**`DISABLE_TELEMETRY`** (L433):

> | `DISABLE_TELEMETRY` | Set to any non-empty value, such as `1`, to opt out of telemetry. **Setting it to `0` or `false` still opts out**, unlike most on/off variables; unset the variable to turn telemetry back on. Telemetry events don't include user data like code, file paths, or bash commands. Also disables feature-flag fetching with the same effect as `DISABLE_GROWTHBOOK`, which makes [Remote Control](...) and the other [features that need feature-flag fetching](...) unavailable. See [Turn telemetry off for your organization](...) |

Related: `DO_NOT_TRACK` (L436) has "the same effect as `DISABLE_TELEMETRY`" but is read as a standard boolean (`0` leaves telemetry on). `DISABLE_GROWTHBOOK` (L422) disables flag fetching only; "Telemetry event logging stays on unless `DISABLE_TELEMETRY` is also set".

**`CLAUDE_CODE_SIMPLE`** (L359):

> | `CLAUDE_CODE_SIMPLE` | Set to `1` to run with a minimal system prompt and only the Bash, file read, and file edit tools. MCP tools from `--mcp-config` are still available. Disables auto-discovery of hooks, skills, custom commands, subagents, plugins, MCP servers, auto memory, and CLAUDE.md. Skills in a directory you pass with `--add-dir` still load. OAuth tokens and keychain credentials are not read, so Anthropic authentication must come from `ANTHROPIC_API_KEY` or an `apiKeyHelper` in `--settings`. Equivalent to passing [`--bare`](/docs/en/headless#start-faster-with-bare-mode) |

`CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT` (L360) is different: shorter system prompt, but "The full tool set, hooks, MCP servers, and CLAUDE.md discovery remain enabled".

**`CLAUDE_CODE_SAFE_MODE`** (L351): "Set to `1` to start in safe mode: CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, custom keybindings, status line and file-suggestion commands, LSP servers, and auto memory do not load ... Directly spawned child processes inherit the variable".

**`NODE_USE_SYSTEM_CA`** and **`NODE_EXTRA_CA_CERTS`**: Not found in docs. `grep -n -F` for both returns nothing in env-vars.md and tools-reference.md. The only CA-related row is `CLAUDE_CODE_CERT_STORE` (L222):

> | `CLAUDE_CODE_CERT_STORE` | Comma-separated list of CA certificate sources for TLS connections. `bundled` is the Mozilla CA set shipped with Claude Code. `system` is the operating system trust store, read only on runtimes with `tls.getCACertificates`: the native binary, or Node 22.15 or later for npm installs. See [CA certificate store](/docs/en/network-config#ca-certificate-store). Default is `bundled,system` |

Whether either NODE_* variable is set for child processes is therefore Not found in docs (the network-config page was not in this assignment).

### Variables that describe what a hook/monitor subprocess receives

**`CLAUDECODE`** (L190):

> | `CLAUDECODE` | Set to `1` in subprocesses Claude Code spawns (Bash and PowerShell tools, tmux sessions, [hook](/docs/en/hooks) commands, [status line](/docs/en/statusline) commands, stdio [MCP server](/docs/en/mcp) subprocesses). IDE extensions also set this in their integrated terminals. Use to detect when a script is running inside a subprocess spawned by Claude Code. To check whether the current process was spawned directly by a tool call or hook, rather than inside a stdio MCP server that Claude Code started, use `CLAUDE_CODE_CHILD_SESSION` instead |

**`CLAUDE_CODE_CHILD_SESSION`** (L223):

> | `CLAUDE_CODE_CHILD_SESSION` | Set to `1` in subprocesses Claude Code spawns via the Bash, PowerShell, and Monitor tools, [hook](/docs/en/hooks) commands, and [status line](/docs/en/statusline) commands. Not set for stdio [MCP server](/docs/en/mcp) subprocesses, which are long-lived and outlive the session that spawned them. Unlike `CLAUDECODE`, this is only set by Claude Code itself when it launches a subprocess and not by IDE extensions, so it reliably distinguishes a nested session from a top-level `claude` launched in an IDE-integrated terminal. A nested interactive `claude` TUI started this way is automatically excluded from `--resume`, `--continue`, up-arrow history, and the `claude agents` list. Non-interactive `claude -p` sessions still persist. Set `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` to override this exclusion. Requires Claude Code v2.1.172 or later |

**`CLAUDE_CODE_SESSION_ID`** (L356):

> | `CLAUDE_CODE_SESSION_ID` | Set automatically to the current session ID in Bash and PowerShell tool subprocesses, [hook command](/docs/en/hooks) subprocesses, and stdio [MCP server](/docs/en/mcp) subprocesses. For Bash, PowerShell, and hooks this matches the `session_id` field in the hook JSON input and is updated on `/clear`. An MCP server subprocess retains the ID it was spawned with. On `--resume <session-id>` it receives the resumed ID, matching hooks and Bash. On `--continue` or `--resume` without an explicit ID it may receive the initial startup ID instead. Use to correlate scripts and external tools with the Claude Code session that launched them |

**`CLAUDE_PID`** (L408): "Claude Code sets this to its own process ID in the subprocesses it spawns: Bash and PowerShell tool commands and hook commands. ... Requires Claude Code v2.1.214 or later".

**`CLAUDE_EFFORT`** (L402): "Set automatically in Bash tool subprocesses and hook commands to the effort level in effect when the subprocess starts: `low`, `medium`, `high`, `xhigh`, or `max`. ... Matches the `effort.level` field passed to hooks. Only set when the current model supports the effort parameter".

**`CLAUDE_CODE_BRIDGE_SESSION_ID`** (L220): "Set automatically in Bash tool and hook command subprocesses while the session has an active Remote Control connection, and removed when the connection ends. The value is the session's ID in `session_` form ... Requires Claude Code v2.1.199 or later. In cloud sessions, read `CLAUDE_CODE_REMOTE_SESSION_ID` instead".

**`CLAUDE_CODE_MESSAGING_SOCKET`** (L314) and **`CLAUDE_CODE_MESSAGING_TOKEN`** (L315): "Set by Claude Code, not by you: in sessions that bind an inbox socket, Claude Code exports that socket's path to hooks and Bash commands when it binds the socket. In a session that starts with messaging on, Claude Code binds the socket before any hook runs." The token row: "A script posting to the socket can send `{"type":"auth","token":"<token>"}` as its first line to prove it belongs to the session. On native Windows, Claude Code requires this line". Socket requires v2.1.224, token v2.1.228.

**`CLAUDE_JOB_DIR`** (L407): "Set by Claude Code in each [background session](/docs/en/agent-view) to that session's `~/.claude/jobs/<id>` directory. Shell commands that the session runs inherit it." Presence of this variable identifies an agent-view background session.

**`CLAUDE_CODE_SHELL_PREFIX`** (L358): "Command prefix that wraps shell commands Claude Code spawns: Bash tool calls, hook commands, status line commands, and stdio MCP server startup commands. PowerShell hooks and exec-form hooks run without the prefix."

**`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`** (L375): "Set to `1` to strip credentials from subprocess environments (Bash tool, hooks, MCP stdio servers) ... On v2.1.251 or later, the scrub also removes Claude Code's own configuration-store pointer variables (such as `CLAUDE_CONFIG_DIR`), so a child process cannot locate a relocated configuration directory. ... On Linux, this also runs Bash subprocesses in an isolated PID namespace".

**`CLAUDE_CONFIG_DIR`** (L400): "Override the configuration directory (default: `~/.claude`). All settings, session history, and plugins are stored under this path. ... Ignored in project and local settings".

**`CLAUDE_CODE_TMPDIR`** (L384): temp dir override; "Unsandboxed Bash commands inherit your shell's `$TMPDIR` unchanged."

### Hook-specific variables

- `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` (L355): "By default the budget is 1.5 seconds, automatically raised to the highest per-hook `timeout` configured in settings files, up to 60 seconds. Timeouts on plugin-provided hooks do not raise the budget".
- `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (L371): Stop/SubagentStop hooks may block at most 8 consecutive times by default.
- `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS` (L262): Desktop/VS Code only; "Has no effect in terminal sessions."
- `CLAUDE_CODE_BASH_EDIT_DIFF` (L218): `0` turns off "the diff of the files a Bash command changed" in hook input; requires v2.1.269.
- `CLAUDE_CODE_POWERSHELL_RESPECT_EXECUTION_POLICY` (L336): applies to "tool calls, hooks, and status line commands".

### Plugin-specific variables

- `CLAUDE_CODE_PLUGIN_CACHE_DIR` (L331): "Override the plugins root directory. ... Defaults to `~/.claude/plugins`".
- `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` (L334): "Set to `1` to clone GitHub `owner/repo` shorthand sources over HTTPS instead of SSH. Applies to plugin install and update, and to `/plugin marketplace add` and `update`."
- `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS` (L332): default 120000.
- `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` (L333), `CLAUDE_CODE_PLUGIN_SEED_DIR` (L335), `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` (L376: "Set to `1` in non-interactive mode (the `-p` flag) to wait for plugin installation to complete before the first query. Without this, plugins install in the background and may not be available on the first turn"), `CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS` (L377), `CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH` (L273), `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` (L261), `FORCE_AUTOUPDATE_PLUGINS` (L443).

### Monitor-related variables

- `CLAUDE_CODE_TOOL_MEMORY_LIMIT` (L387) and `CLAUDE_CODE_TOOL_MEMORY_CGROUP_EXCLUDE` (L386): Linux/WSL memory cap covering Bash, PowerShell, and Monitor; `hooks` and `plugin` are named kinds that can be excluded (tools-reference.md L203-L204). "Permission-gating hooks: even with every kind capped, Claude Code excludes from the cap a hook that can block or change the outcome of an action" (tools-reference.md L213).
- `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` (L239): "Set to `1` to disable all background task functionality, including the `run_in_background` parameter on Bash and subagent tools, auto-backgrounding, and the Ctrl+B shortcut". Whether this also disables Monitor is not stated.

### Features that need feature-flag fetching (env-vars.md L502-L531)

> Claude Code turns some features on through feature flags it fetches from Anthropic. Claude Code skips that fetch in these sessions:
>
> * A session where you set `DISABLE_GROWTHBOOK`, `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`; ...
> * A session on a [third-party provider](...), such as Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, or Microsoft Foundry, unless a host platform that embeds Claude Code sets `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`
> * A [Claude apps gateway](...) session

(L504-L508.) With fetching off, the list at L510-L525 includes: default auto mode, Remote Control, cross-machine session messaging (L516: "messaging between sessions on this machine works with fetching off"), `claude import`, `/skill-doctor`, syncing claude.ai skills/plugins into terminal sessions (L519), the advisor tool, artifact comments, the PowerShell tool by default on Windows with Git Bash (L523), Claude-drafted feedback (L524). L529: after an install or upgrade, "a flag-gated feature can be missing" in the first session.

---

## 6. Environment a hook or monitor inherits

What tools-reference.md says about Bash-tool subprocesses (hooks are not described separately here):

- L141: "The Bash tool runs each command in a separate process."
- L149: "Environment variables don't persist. An `export` in one command won't be available in the next."
- L150: "Aliases and shell functions defined in your shell startup file are available. At session start, Claude Code sources `~/.zshrc`, `~/.bashrc`, or `~/.profile` depending on your shell, captures the resulting aliases, functions, and shell options, and applies them to every Bash command."
- L152: "To make environment variables persist across Bash commands, set [`CLAUDE_ENV_FILE`](/docs/en/env-vars) to a shell script before launching Claude Code, or use a [SessionStart hook](/docs/en/hooks#persist-environment-variables) to populate it dynamically."
- Shell choice: `CLAUDE_CODE_SHELL` (env-vars.md L357) accepts a `bash` or `zsh` path; "Auto-detection uses your `$SHELL` when it points to `bash` or `zsh`, otherwise it picks the first working `zsh` then `bash` found on your `PATH` and standard install locations". Fish is not supported.
- Hook commands specifically get: `CLAUDECODE=1` (L190), `CLAUDE_CODE_CHILD_SESSION=1` (L223), `CLAUDE_CODE_SESSION_ID` (L356), `CLAUDE_PID` (L408, v2.1.214+), `CLAUDE_EFFORT` when the model supports effort (L402), `CLAUDE_CODE_BRIDGE_SESSION_ID` while Remote Control is connected (L220), `CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN` when the inbox socket is bound (L314-L315), `CLAUDE_CODE_REMOTE=true` in cloud sessions (L344), `CLAUDE_JOB_DIR` in agent-view background sessions (L407). Monitor tool subprocesses get `CLAUDE_CODE_CHILD_SESSION=1` (L223); the other rows do not list Monitor.
- Hook commands are wrapped by `CLAUDE_CODE_SHELL_PREFIX` unless they are PowerShell or exec-form hooks (L358), and are subject to `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (L375).
- PowerShell: "PowerShell profiles are not loaded" is stated as a PowerShell *tool* preview limitation (tools-reference.md L443-L445); whether it also applies to `"shell": "powershell"` hooks is not stated. `-ExecutionPolicy Bypass` at process scope IS stated for "tool calls, hooks, and status line commands" (env-vars.md L336; tools-reference.md L415).
- Settings `env` values are written into the parent process environment (env-vars.md L105), so hooks inherit them; an empty-string override is inherited as empty (L107).
- Plugin hooks additionally receive `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, and `CLAUDE_PROJECT_DIR` as environment variables; Bash tool commands do not (plugins-reference.md L721, quoted in section 5).
- Plugin monitor processes: "The command runs through a shell" and "Monitor processes don't receive `CLAUDE_PLUGIN_OPTION_<KEY>` environment variables, so have the monitor script read the value from a config file it owns" (plugins-reference.md L337).
- Inherited `CLAUDE_CODE_CHILD_SESSION=1` can misclassify a genuine top-level session as nested when it is launched from "a background launcher first started by Claude Code's Bash tool"; `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` overrides that (env-vars.md L286). Relevant if Synchrobuilder ever launches `claude` from a hook or background loop.

Background Bash commands (tools-reference.md L176-L182), relevant if the sync loop runs as a `run_in_background` command rather than a hook or monitor: a command started by the main conversation or a background subagent "keeps running after a final response"; one started by a foreground subagent "stops when that subagent gives its final response"; "In non-interactive mode with the `-p` flag, background commands end shortly after the run's final result" (L180). A command that hits its timeout is moved to the background instead of stopped, "unless the command starts with `sleep`" (L182). On macOS and Linux, a background shell started in the main session is terminated on a memory-pressure signal "once the session has been idle for 30 minutes and no turn or subagent is running"; `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` turns that off; "Windows has no memory-pressure signal" (env-vars.md L243, v2.1.193+).

Not found in docs: whether `PATH` is modified for hook subprocesses, whether hooks inherit the `CLAUDE_ENV_FILE` exports (the row says the file runs "before each Bash command", L406, not before hooks), and any statement about the hook working directory (that belongs to hooks.md, outside this assignment).

### Background sessions (agent-view.md)

> Each background session is a full Claude Code conversation that keeps running without a terminal attached, so you can open it, reply, and leave whenever you want. (agent-view.md L9)

> Background sessions don't need any terminal open to keep working. A separate [supervisor process](#the-supervisor-process) runs them, so you can close agent view, close your shell, or start a new interactive session and your dispatched work keeps going. (agent-view.md L134)

tools-reference.md L537 notes that background sessions and cloud sessions get the Task tools on every model.

---

## Implications for Synchrobuilder

1. Guard-hook matcher: use bare names `Edit|Write|NotebookEdit` (tools-reference.md L95, L40, L85). Any edit Claude makes through a shell command (`sed -i`, redirects) is by construction a `Bash` (or `PowerShell`) tool call and never matches `Edit|Write`; L263 documents this explicitly only for `find`/`grep` searches on macOS/Linux/WSL, and L229 says which Bash commands `Edit` deny rules cover is on the permissions page (not in this source). A Bash-side guard would need `Bash|PowerShell` (L397) and would be a separate, heavier design. `MultiEdit` should not appear in any matcher (Not found).
2. Plugin monitors are the push mechanism documented in these two pages for delivering teammate events "sooner" than the next prompt: they deliver "every stdout line to Claude as a notification" (plugins-reference.md L293). Cross-session messaging (`SendMessage`/`ListAgents`, tools-reference.md L36, L49) is another documented push channel but is outside this note's sources. Monitors are unavailable on Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry and whenever `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (tools-reference.md L345), and plugin monitors run only in interactive CLI sessions (plugins-reference.md L295). Synchrobuilder must treat monitors as an optional accelerator and keep the UserPromptSubmit path as the baseline.
3. Monitor availability is coupled to telemetry opt-out, which conflicts with privacy-conscious teams; `/synchrobuilder:doctor` should detect `DISABLE_TELEMETRY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and third-party providers and report "monitors unavailable, falling back to prompt-time delivery".
4. Interactive-vs-headless detection: `CLAUDE_CODE_ENTRYPOINT` is not documented. Documented signals a hook can read: `CLAUDE_CODE_REMOTE=true` (cloud), `CLAUDE_JOB_DIR` (agent-view background session), `CLAUDE_CODE_CHILD_SESSION=1` (spawned by Claude Code itself), `CLAUDE_CODE_SESSION_ID`. Whether `-p` sessions are distinguishable from the environment alone is not stated here; the SessionStart hook input (hooks.md) is the better source.
5. `CLAUDE_CODE_SIMPLE=1` / `--bare` and `CLAUDE_CODE_SAFE_MODE=1` disable plugin and hook discovery (env-vars.md L359, L351), so Synchrobuilder silently does nothing there; `doctor` docs should mention it.
6. Node child processes: `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` are available to a `node "<path>"` hook (L190, L223, L356, L408). The background sync loop, if spawned by a hook, inherits these; it must not rely on `CLAUDE_CODE_MESSAGING_SOCKET` since that is only exported when the inbox socket is bound (L314).
7. Windows: with the PowerShell tool on (default for claude.ai accounts with Git Bash, automatic without Git Bash), Claude's primary shell is PowerShell (L413). Because hooks are invoked as `node "<path>"`, shell choice mostly affects Bash-path detection in `doctor`; `CLAUDE_CODE_GIT_BASH_PATH` (L292) tells whether Git Bash was located manually.
8. Credentials scrub (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, L375) can remove `CLAUDE_CONFIG_DIR` from hook environments on v2.1.251+, so state paths must not depend on it; use `CLAUDE_PLUGIN_DATA` (exported to hook processes per plugins-reference.md L718, L721) or project paths from hook input instead. Whether the scrub also strips `CLAUDE_PLUGIN_*` is not stated (L375 names "configuration-store pointer variables (such as `CLAUDE_CONFIG_DIR`)").
9. Plugin install commands: `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` (L334) affects `owner/repo` shorthand cloning; the install page should mention it for CI/containers without SSH keys.
10. Monitor deadline behaviour for plugin-declared monitors is not settled by these docs (see Open questions); design the monitor script to be restart-safe and idempotent regardless.

## Conflicts with the brief

| Brief says | Docs say | Source |
| :-- | :-- | :-- |
| `/synchrobuilder:notify` lands "sooner if plugin monitors allow" as a general capability | Monitors are unavailable on Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, and whenever `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set; plugin monitors also run "only in interactive CLI sessions" | tools-reference.md L345; plugins-reference.md L295 |
| Hooks/scripts run as `node "<path>"` with no shell anywhere | Plugin monitor commands "run through a shell" per the cross-check page, and the Monitor tool "writes a small script, runs it in the background" (a shell command). A monitor entry's `command` string is inevitably shell-interpreted; the brief's "no shell" rule can hold for the script body but not for the launcher line | tools-reference.md L331; plugins-reference.md L293, L337 |
| Hooks before edits must be local-file-read only and under 50 ms; "guard" is a PostToolUse-style hook after Write/Edit | Not contradicted here. An `Edit|Write` guard will by construction miss edits Claude makes through shell commands, which arrive as `Bash`/`PowerShell` calls; tools-reference.md L263 documents the analogous case for `find`/`grep` searches on macOS/Linux/WSL, and L229 defers "which Bash commands your `Read` and `Edit` deny rules cover" to the permissions page | tools-reference.md L229, L263 |
| `CLAUDE_CODE_ENTRYPOINT` values tell a hook whether the session is interactive | Not found in env-vars.md; no such variable is documented | env-vars.md (grep, no hits) |
| Privacy principle: never send telemetry-like traffic | Turning telemetry off via `DISABLE_TELEMETRY` or nonessential-traffic off removes the Monitor tool and plugin monitors, so the faster notify path and the privacy-maximal configuration are mutually exclusive | tools-reference.md L345; env-vars.md L258, L433 |

## Open questions

1. Do plugin-declared monitors really run "for the lifetime of the session" (plugins-reference.md L293), or do they hit the 5-minute default / 30-minute cap that applies to "Every watch Claude starts" (tools-reference.md L335)? Needs an experiment: declare a monitor that prints a heartbeat every 60 s and observe whether it stops at 5 or 30 minutes on v2.1.218.
2. What does a Monitor stdout line look like when it reaches Claude (label, truncation, batching)? Not described in tools-reference.md. Needs a transcript capture.
3. Does `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (env-vars.md L239) also disable the Monitor tool and plugin monitors? Not stated.
4. Which of `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` actually reach a plugin monitor process? The env-vars rows name the Monitor tool only for `CLAUDE_CODE_CHILD_SESSION` (L223); plugins-reference.md L721 names hook, MCP, and LSP processes but not monitors for the three plugin path variables; L337 states only that monitors do NOT receive `CLAUDE_PLUGIN_OPTION_<KEY>`. Needs an `env` dump from a monitor script.
5. Is there any environment variable that distinguishes `claude -p` from an interactive TUI session? `CLAUDE_CODE_ENTRYPOINT` is not documented; check the SessionStart hook JSON input on a real machine.
6. Does a hook subprocess get the exports from `CLAUDE_ENV_FILE`? The row (L406) says the file runs "before each Bash command"; hooks are not mentioned.
7. Is `PATH` altered for hook subprocesses on Windows when Claude Code locates Git Bash via `CLAUDE_CODE_GIT_BASH_PATH` (L292)? Needs a `node -e "console.log(process.env.PATH)"` hook on Windows.
8. On v2.1.218 (older than v2.1.246), do Monitor commands run outside the Linux memory cap (tools-reference.md L191)? Relevant only if the sync loop is a monitor on Linux with a cap configured.
