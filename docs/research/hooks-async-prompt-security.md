# Hooks: async execution, prompt/agent hooks, security, Windows PowerShell, debugging

## Source

- https://code.claude.com/docs/en/hooks (raw: `hooks.md`, assigned range L3478-L3842 plus supporting lines cited explicitly)
- https://code.claude.com/docs/en/hooks-guide (raw: `hooks-guide.md`, whole file, 1064 lines)
- Fetch date: 2026-09-18 (raw Markdown downloaded from code.claude.com/docs/en/<page>.md)
- The highest version marker inside the raw docs is v2.1.274 (hooks.md); `npm view @anthropic-ai/claude-code version` on 2026-09-18 returns 2.1.276; the local CLI used for experiments is 2.1.218 (`claude --version`).

Citations are `(file L<start>-L<end>)`. Line numbers refer to the raw files; the first 4 lines are an index preamble.

## 1. Async hooks (`async: true`)

**Where it applies.** `async` is a command-hook-only field (hooks.md L460, L3665):

> Add `"async": true` to a command hook's configuration to run it in the background without blocking Claude. This field is only available on `type: "command"` hooks. (hooks.md L3665)

**Does the tool call wait?** No. Claude continues immediately; the hook cannot influence the action (hooks.md L3661, L3697):

> By default, hooks block Claude's execution until they complete. For long-running tasks like deployments, test suites, or external API calls, set `"async": true` to run the hook in the background while Claude continues working. Async hooks can't block or control Claude's behavior: response fields like `decision`, `permissionDecision`, and `continue` have no effect, because the action they would have controlled has already completed. (hooks.md L3661)

> When an async hook fires, Claude Code starts the hook process and immediately continues without waiting for it to finish. The hook receives the same JSON input via stdin as a synchronous hook. (hooks.md L3697)

**When is output delivered, and can it return additionalContext?** Yes, `additionalContext` and `systemMessage` are delivered, but only on the next conversation turn, and neither is shown to the user (hooks.md L3667, L3699):

> After the background process exits, Claude Code delivers the `additionalContext` and `systemMessage` fields from the hook's JSON response to Claude on the next conversation turn. Unlike a synchronous hook's `systemMessage`, neither field is shown to you. (hooks.md L3699)

Output validation for async hooks (hooks.md L3701):

> Claude Code validates that JSON response against the same [output schema](#json-output) as synchronous hooks, and drops any field whose value has the wrong type, such as a `systemMessage` that isn't a string, instead of delivering it. Run with `--debug` to see a warning naming each dropped field. Before v2.1.202, malformed JSON output from an async hook could crash the session, and the crash recurred each time the session was resumed.

Completion notifications are hidden by default (hooks.md L3703):

> Async hook completion notifications are suppressed by default. To see them, enable verbose mode with `Ctrl+O` or start Claude Code with `--verbose`.

**Is timeout enforced?** Not for `async`; yes for `asyncRewake` (hooks.md L3688):

> Once an async hook is running in the background, Claude Code doesn't enforce `timeout` on it. Claude Code still enforces `timeout` on a hook you run with `asyncRewake`.

The `timeout` field definition repeats this: "Claude Code doesn't enforce it on a command hook you run with `async: true`" (hooks.md L430), and the general rule "Apart from a command hook you run with `async: true`, Claude Code cancels a `command`, `http`, or `mcp_tool` hook that reaches its `timeout`, discarding the hook's output" (hooks.md L869).

**Session teardown / cancellation** (hooks.md L3690-L3693):

> Claude Code delivers an async hook's results only while the session runs:
>
> * In [non-interactive mode](/docs/en/headless) with the `-p` flag, Claude Code kills any async hook still running at teardown and finalizes it with outcome `cancelled`
> * If your hook's work must outlive a `claude -p` session, start a fully detached process from it

The docs state teardown behavior explicitly only for `-p` mode; interactive-session teardown behavior for a still-running async hook is not stated (searched "teardown", "cancel", "SessionEnd" within L3659-L3762).

**`asyncRewake`** (hooks.md L461, table of command hook fields):

> | `asyncRewake` | no | If `true`, runs in the background and wakes Claude on exit code 2. The hook's stderr, or stdout if stderr is empty, is shown to Claude as a system reminder so it can react to a long-running background failure |

**`rewakeMessage` / `rewakeSummary`:** Not found in docs. Searched both raw files for `rewakeMessage`, `rewakeSummary`, and `rewake`; the only hits are `asyncRewake` at hooks.md L461, L3688 and L3760.

**Limitations list, verbatim** (hooks.md L3756-L3761):

> ### Limitations
>
> Async hooks have additional constraints compared to synchronous hooks:
>
> * Hook output is delivered on the next conversation turn. If the session is idle, the response waits until the next user interaction. Exception: an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle.
> * Each execution creates a separate background process. There is no deduplication across multiple firings of the same async hook.

**Async and `classifierContext`:** the auto-mode classifier note field is ignored from background hooks (hooks.md L2084):

> * **Synchronous responses only**: Claude Code ignores the field in the response of a hook that [runs in the background](#run-hooks-in-the-background), because that response arrives after Claude Code records the tool result

**Reference config** (hooks.md L3669-L3686):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/run-tests.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

The worked example (hooks.md L3705-L3754) is a bash script using `jq` that emits `{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $msg}}` (hooks.md L3731) and registers it with `"args": []` plus `"async": true` on matcher `Write|Edit` (hooks.md L3741-L3748).

## 2. Detached / background child processes that outlive the hook

The docs do not describe a mechanism, but they do explicitly endorse the pattern for `-p` sessions (hooks.md L3693):

> * If your hook's work must outlive a `claude -p` session, start a fully detached process from it

This is the only mention of "detached"/"outlive". Searched both files for `detach`, `nohup`, `outlive`, `orphan`, `child process`, `background`. Other hits:

- hooks.md L744: hook child processes have no controlling terminal:

> On macOS and Linux, command hooks run in their own session without a controlling terminal. The hook process and any child processes can't open `/dev/tty` or send escape sequences directly to the Claude Code interface. Windows has no `/dev/tty`.

- hooks.md L3761: each async firing is a separate background process with no deduplication (quoted above).

Not found in docs: whether a detached child is killed with the hook in interactive mode, whether stdio must be closed for the parent hook to be considered finished, or any Windows-specific detach guidance.

## 3. Workspace trust

Verbatim (hooks.md L3771-L3778):

> ### Workspace trust
>
> Claude Code checks workspace trust before it runs any hook from a settings file. What counts as trusted depends on the session type:
>
> * **Interactive session**: Claude Code holds back hooks from every settings file, including your own `~/.claude/settings.json`, until you accept the [workspace trust dialog](/docs/en/permissions#project-allow-rules-and-workspace-trust) for the folder, or for a parent directory whose trust extends to it
> * **`-p` or SDK session**: Claude Code never shows the dialog and treats the folder as trusted, so hooks committed in a repository's `.claude/settings.json` run in a folder you've never trusted
>
> Before you script `claude -p` over a repository you didn't write, review its `.claude/` settings files, start with [`--bare`](/docs/en/headless#start-faster-with-bare-mode), or [turn hooks off for that run](#disable-or-remove-hooks) with `--settings '{"disableAllHooks": true}'`. Frontmatter hooks in a project subagent follow a stricter rule than settings-file hooks. [What runs before you trust a folder](/docs/en/permissions#what-runs-before-you-trust-a-folder) lists each kind of repository content by session type.

Related rules for skill and subagent frontmatter hooks (hooks.md L712-L714):

> Frontmatter hooks in a project skill follow the same [workspace trust rule as hooks in settings files](#workspace-trust). Claude Code registers them when you or Claude invoke the skill, including in a `-p` run in a folder you haven't trusted.

> Frontmatter hooks in a project subagent run only after you accept the [workspace trust dialog](/docs/en/permissions#project-allow-rules-and-workspace-trust) for the folder the agent file came from. A `-p` session doesn't count as accepting it. [...] Before v2.1.218, these hooks could run from folders you hadn't trusted.

**Plugin hooks specifically:** The hooks pages say plugin hooks live in `hooks/hooks.json` and apply "When plugin is enabled" (hooks.md L259; hooks-guide.md L833), and "When a plugin is enabled, its hooks merge with your user and project hooks" (hooks.md L659). Under `allowManagedHooksOnly`, "Your user, project, local, and plugin hooks are blocked. Hooks from plugins force-enabled in managed settings `enabledPlugins` are exempt" (hooks.md L271). Not found in docs (these two pages): any statement about when a project-scope plugin's hooks first run relative to the trust dialog, or a plugin-specific trust prompt. Searched `plugin` with `trust`, `first run`, `enable` in hooks.md and hooks-guide.md. The trust text above is framed around "any hook from a settings file"; whether plugin `hooks/hooks.json` is covered by the same gate is not stated here and belongs to the plugins/permissions pages.

## 4. Security considerations (verbatim)

Disclaimer (hooks.md L3765-L3769):

> Command hooks execute shell commands with your full user permissions. They can modify, delete, or access any files your user account can access. Review and test all hook commands before adding them to your configuration.

Best practices (hooks.md L3780-L3788):

> ### Security best practices
>
> Keep these practices in mind when writing hooks:
>
> * **Validate and sanitize inputs**: never trust input data blindly
> * **Always quote shell variables**: use `"$VAR"` not `$VAR`
> * **Block path traversal**: check for `..` in file paths
> * **Use absolute paths**: specify full paths for scripts. In exec form, use `${CLAUDE_PROJECT_DIR}` and the path needs no quoting. In shell form, wrap it in double quotes
> * **Skip sensitive files**: avoid `.env`, `.git/`, keys, etc.

## 5. Windows PowerShell tool (verbatim)

Section intro (hooks.md L3792):

> On Windows, you can run individual hooks in PowerShell by setting `"shell": "powershell"` on a command hook. Claude Code auto-detects `pwsh.exe`, the PowerShell 7 and later executable, and falls back to `powershell.exe` for Windows PowerShell 5.1.

Example (hooks.md L3794-L3811):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "command": "Write-Host 'File written'"
          }
        ]
      }
    ]
  }
}
```

Placeholder-rewrite rules and version markers (hooks.md L3813-L3817):

> To reference the project root from a PowerShell shell-form command, write `${CLAUDE_PROJECT_DIR}` or `$env:CLAUDE_PROJECT_DIR`. As of v2.1.198, Claude Code rewrites the `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, and `${CLAUDE_PLUGIN_DATA}` placeholders in a PowerShell shell-form command to PowerShell's `${env:NAME}` form, whether the hook is defined in `settings.json`, a plugin, or a skill. PowerShell then resolves the value from the exported environment after parsing, so the placeholder works inside double-quoted strings but not inside single-quoted strings, where PowerShell never expands variables.
>
> Before v2.1.198, this rewrite applied only to plugin hooks. On earlier versions, a `settings.json` hook needs the `$env:` form or [exec form](#exec-form-and-shell-form), where `${CLAUDE_PROJECT_DIR}` is substituted in each `args` element regardless of where the hook is defined.
>
> Don't write the bare `$CLAUDE_PROJECT_DIR` spelling in a PowerShell hook. PowerShell parses it as an undefined local variable and resolves it to `$null`, which leaves the script path without its project-root prefix. Claude Code doesn't rewrite that form; it logs a warning in the [debug log](#debug-hooks) instead.

Version-independent example (hooks.md L3819-L3827):

```json
{
  "type": "command",
  "shell": "powershell",
  "command": "& \"$env:CLAUDE_PROJECT_DIR\\.claude\\hooks\\check.ps1\""
}
```

The `shell` field definition (hooks.md L462):

> | `shell` | no | Shell to use for this hook. Accepts `"bash"` or `"powershell"`. Defaults to `"bash"`, or to `"powershell"` on Windows when Git Bash isn't installed. Setting `"powershell"` runs the command via PowerShell on Windows. Does not require `CLAUDE_CODE_USE_POWERSHELL_TOOL` since hooks spawn PowerShell directly. Ignored when `args` is set |

Exec form avoids shells entirely (hooks.md L468, L470):

> A command hook runs as exec form when `args` is set, and shell form when `args` is omitted. Set `args` whenever the hook references a [path placeholder](#reference-scripts-by-path), since each element is passed as one argument with no quoting. [...]

> **Exec form** runs when `args` is present. Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell, so each `args` element is one argument exactly as written, and path placeholders like `${CLAUDE_PLUGIN_ROOT}` are substituted into `command` and into each `args` element as plain strings. Special characters such as apostrophes, `$`, and backticks pass through verbatim because there is no shell to interpret them. No shell tokenization happens on any platform.

Which shell runs shell-form hooks (hooks-guide.md L1027):

> When Claude Code runs a shell-form command hook, one without `args`, it spawns `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed by default. This shell is non-interactive, but Git Bash and some configurations, such as `BASH_ENV` pointing at `~/.bashrc`, still source your profile.

## 6. Debug hooks

Verbatim (hooks.md L3831):

> Hook execution details are written to the debug log file. Start Claude Code with `claude --debug-file <path>` to write the log to a known location, or run `claude --debug` and read the log at `~/.claude/debug/<session-id>.txt`. The `--debug` flag doesn't print to the terminal.

Sample log entries (hooks.md L3835-L3838):

```text
2026-07-19T02:03:24.382Z [DEBUG] Hook output does not start with {, treating as plain text
2026-07-19T02:03:24.382Z [DEBUG] "Hook PostToolUse:Write (PostToolUse) success:\nhook-ran"
```

> For more granular hook matching details, set `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` to see additional log lines such as hook matcher counts and query matching. (hooks.md L3840)

Other commands:

- `/hooks` opens a read-only browser listing events with counts; selecting a hook shows "the event, matcher, type, source file, and command" (hooks-guide.md L70, L79, L837).
- `/debug` mid-session enables logging and shows the log path (hooks-guide.md L611, L1058): "Start Claude Code with `claude --debug-file /tmp/claude.log` to write to a known path, then `tail -f /tmp/claude.log` in another terminal. If you started without that flag, run `/debug` mid-session to enable logging and find the log path." (hooks-guide.md L1058)
- `Ctrl+O` opens the transcript view to see hook outcomes (hooks-guide.md L1049); ignored misplaced JSON keys are logged as `Hook JSON output had unrecognized keys` (hooks-guide.md L1045).
- Manual test: `echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | ./my-hook.sh` then `echo $?` (hooks-guide.md L984-L987).

## 7. hooks-guide.md: Node, Windows, how context appears, output limits

**Node examples:** none. The only Node reference is troubleshooting advice (hooks-guide.md L989):

> * If you see "jq: command not found", install `jq` or use Python/Node.js for JSON parsing

Every script example in the guide is bash + `jq` (e.g. L255-L275, L589-L600, L1009-L1016; the guide's fenced blocks are 9 `json`, 5 `bash`, 1 `text`). Searched `node`, `node.js`, `.mjs`, `.js`. The guide's shell-free route is exec form: "To avoid shell quoting entirely, add `"args": []` to switch to [exec form], which spawns the script directly without a shell" (hooks-guide.md L988).

The reference (hooks.md, outside the assigned range) does have a Node example. Exec form with `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]` (hooks.md L478-L486), plus a Windows note (hooks.md L475):

> On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`. The `.cmd` and `.bat` shims that npm, npx, eslint, and other tools install in `node_modules/.bin` are not executables and can't be spawned without a shell. To run them in exec form, invoke the underlying script with `node` directly, for example `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`. The `node` plus script-path pattern works on every platform because `node.exe` is a real binary. To run a `.cmd` or `.bat` shim by name, use shell form.

Both forms also export the placeholders as environment variables: "both export them as the environment variables `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA` on the spawned process, so a script can read `process.env.CLAUDE_PLUGIN_ROOT` regardless of how it was launched" (hooks.md L497).

**Windows references:**

- Notification hook via `powershell.exe -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('Claude Code needs your attention', 'Claude Code')"` (hooks-guide.md L157-L174); caveat: "This command opens a dialog box rather than a notification [...] If you run Claude Code inside WSL, `powershell.exe` must be available on your `PATH` through Windows interop." (L177)
- Path normalization in protect-files.sh: `# Normalize Windows backslash separators so the patterns below match` / `FILE_PATH="${FILE_PATH//\\//}"` (hooks-guide.md L262-L263).
- `chmod +x` step is titled "Make the script executable on macOS and Linux" (L278-L283).
- To catch every file change also match `Bash|PowerShell` and use `git status --porcelain` (L684).
- Shell-form hooks on Windows use Git Bash, or PowerShell when Git Bash isn't installed (L1027, quoted in section 5).

**How hook context appears to the user / to Claude:**

> Command hooks communicate through stdout, stderr, and exit codes only. They can't trigger `/` commands or tool calls. Text returned via `additionalContext` is injected as a system reminder that Claude reads as plain text. HTTP hooks communicate through the response body instead. (hooks-guide.md L952)

> When the hook succeeds, Claude Code shows nothing in the conversation. (hooks-guide.md L237)

> * **Successful run**: you see nothing, unless the hook's JSON surfaces something, such as `systemMessage` or Stop hook feedback. (hooks-guide.md L1051)

> * **Non-blocking error**: the action proceeded, and you see a `<hook name> hook error` notice with a short explanation, such as the first line of stderr prefixed with `Failed with non-blocking status code:`, or a JSON validation or parse message. (hooks-guide.md L1054)

Exit 0 plain-stdout goes to Claude's context only on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch` (hooks-guide.md L606; hooks.md L810: "For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript. The exceptions are [those four]"). Stderr from a hook that exits 0 "goes to the debug log only, never the transcript, and Claude never sees it" (hooks.md L822). `additionalContext` must be nested in `hookSpecificOutput` or it is silently ignored (hooks-guide.md L647, L1045). Multiple hooks' `additionalContext` are all kept (hooks-guide.md L529; hooks.md L1021). Placement per event (hooks.md L1013-L1019): SessionStart before the first prompt; UserPromptSubmit alongside the prompt; PreToolUse/PostToolUse "next to the tool result"; Stop at end of turn.

**Output length limits / truncation:** hooks-guide.md contains no length limit statement (searched `truncat`, `limit`, `characters`). hooks.md does:

> Hook output strings, including `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000 characters. Output that exceeds this limit is saved to a file and replaced with a preview and file path, the same way a large valid Bash result is handled under [Output limits](/docs/en/tools-reference#output-limits). (hooks.md L941)

> If a value exceeds 10,000 characters, Claude Code writes the text to a file in the session directory and passes Claude the file path with a short preview instead. (hooks.md L1023)

Guide timeouts (hooks-guide.md L953-L957): command/http/mcp_tool default 10 minutes, lowered to 30 s for `UserPromptSubmit`, `PreModelSwitch`, `PostModelSwitch` and 10 s for `MessageDisplay`; prompt 30 s; agent 60 s; "`SessionEnd` hooks of any type share a 1.5-second budget. If your settings set a longer per-hook `timeout`, Claude Code raises the budget to match, up to 60 seconds." (L957). Hooks run in parallel and all run to completion before results merge (hooks-guide.md L480, L527). Stop hooks are overridden after eight consecutive blocks; raise with `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (L1007, L1018).

## 8. Prompt and agent hooks

**Prompt hooks.** `type: "prompt"` sends the hook input plus your prompt to a Claude model ("Haiku by default", hooks.md L3525; hooks-guide.md L845) and expects `{ "ok": true|false, "reason": "...", "impossible": true|false }` (hooks.md L3564-L3570). Fields: `type`, `prompt` (with `$ARGUMENTS`), `model` ("Defaults to a fast model"), `timeout` ("Default: 30"), `continueOnBlock` ("Default: `false`") (hooks.md L3552-L3558). On `PreToolUse`, `ok: false` denies and "by default the turn ends and the deny reason appears in the chat as a warning line" (hooks.md L3581, changed in v2.1.210); on `PostToolUse` the turn also ends by default (L3582); on `UserPromptSubmit` the turn ends regardless of `continue` (L3583). Supported only on the 13 events listed at hooks.md L3484-L3496; not on `SessionStart`, `SessionEnd`, `Notification`, `FileChanged`, etc. (L3498-L3519). Why Synchrobuilder will not use them: every firing is an LLM call with a 30 s default timeout, which violates the brief's sub-50 ms, local-file-read-only rule for pre-edit and per-prompt hooks, and the default outcome on `ok: false` ends the turn, which is blocking rather than advisory. The documented response schema is only `ok`, `reason`, `impossible` (hooks.md L3564-L3570); no `additionalContext` or other output field is documented for prompt hooks, so they cannot be used to inject context. Where they might help: an optional, user-enabled `Stop` hook that judges whether a handoff note should be written, since Stop feeds `reason` back as the next instruction (hooks.md L3580).

**Agent hooks.** `type: "agent"` is marked experimental: "Behavior and configuration may change in future releases. For production workflows, prefer [command hooks]" (hooks.md L3616-L3618; hooks-guide.md L879-L881). It spawns a subagent with Read/Grep/Glob for "up to 50 turns", default timeout 60 s, same events as prompt hooks, no `continueOnBlock` and no `impossible`; `ok: false` is handled like a prompt hook with `continueOnBlock: true` (hooks.md L3624-L3637; hooks-guide.md L885). Why Synchrobuilder will not use them: multi-turn LLM cost and latency, experimental status, and the documented response is only `{ "ok": true }` / `{ "ok": false, "reason": "..." }` (hooks.md L3637; no `additionalContext` documented), so they add nothing to presence, claims, or notify delivery. The guide's own rule: "Use prompt hooks when the hook input data alone is enough to make a decision. Use agent hooks when you need to verify something against the actual state of the codebase." (hooks-guide.md L907).

## Implications for Synchrobuilder

1. **Guard hook (PostToolUse Write|Edit, synchronous, advisory):** use exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"]`) so no shell is involved on any platform (hooks.md L468-L470), and return `hookSpecificOutput.additionalContext` nested correctly (hooks-guide.md L647). Synchronous output appears "next to the tool result" in the same turn (hooks.md L1017), which satisfies "tells Claude in the same turn". Keep each message well under the 10,000-character cap (hooks.md L941).
2. **Notify delivery:** async hook output is delivered "on the next conversation turn" and waits while idle (hooks.md L3760), so a background watcher cannot deliver mid-turn except via `asyncRewake` exit 2, which is described for failures and wakes Claude "immediately even when the session is idle" (hooks.md L461, L3760). The brief's "lands in the teammate's next prompt" maps cleanly to a synchronous `UserPromptSubmit` hook reading the local snapshot; "sooner if plugin monitors allow" would have to be `asyncRewake`, which is untested for this use.
3. **Background sync loop (30-60 s):** there is no long-lived hook type; each async firing is a fresh process with no deduplication (hooks.md L3761). Options are (a) spawn a detached daemon from `SessionStart` (the docs sanction detaching only in the `-p` context, hooks.md L3693; note that at interactive launch, `--continue`/`--resume`, and `/clear`, "SessionStart hooks run in the background" and "Claude's first response still waits for the hooks to finish", hooks.md L1138), or (b) do a bounded sync inside an `async: true` PostToolUse/UserPromptSubmit hook. `-p` sessions kill async hooks at teardown with outcome `cancelled` (hooks.md L3692), so CI (`/synchrobuilder:ci`) must not rely on async hooks finishing.
4. **Fail-open contract:** exit 0 with empty stdout is "no objection" (hooks-guide.md L604). Exit 2 blocks the action on events that can block (hooks-guide.md L607; hooks.md L826). Any exit code other than 0 or 2 with plain/empty stdout surfaces a `<hook name> hook error` notice to the user (hooks-guide.md L608-L611; hooks.md L857), so internal errors must be caught and exit 0. Malformed JSON is reported even on exit 0 (hooks-guide.md L990), and on a parse failure the stdout is not added as context either (hooks.md L820, changed in v2.1.248); use `JSON.stringify`, never string concatenation. Stderr on exit 0 never reaches Claude or the transcript (hooks.md L822), so it is safe for diagnostics only.
5. **Windows:** exec form sidesteps Git Bash/PowerShell profile issues (hooks-guide.md L1027) and PowerShell placeholder rewriting (hooks.md L3813-L3817). Never rely on `$CLAUDE_PROJECT_DIR` bare spelling. Normalize backslashes in `file_path` (hooks-guide.md L263).
6. **Privacy/untrusted teammate text:** "Validate and sanitize inputs: never trust input data blindly" and "Block path traversal" (hooks.md L3784-L3786) apply to anything read from the orphan branch snapshot. `additionalContext` "is injected as a system reminder that Claude reads as plain text" (hooks-guide.md L952), so wrapping teammate text in a labeled block is the only defense available at the hook layer.
7. **Timeouts:** `SessionEnd` hooks share a 1.5 s budget by default, raisable to 60 s per-hook (hooks-guide.md L957; hooks.md L430); the handoff writer must be fast or set `timeout`. `UserPromptSubmit` defaults to 30 s (L954). A synchronous `UserPromptSubmit` hook that times out has its output, "including any `additionalContext`", discarded and a notice appears in the transcript (hooks.md L1343).
8. **Doctor/debug guidance:** point users to `claude --debug-file <path>`, `~/.claude/debug/<session-id>.txt`, `/hooks`, `/debug`, `Ctrl+O`, and `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` (hooks.md L3831-L3840; hooks-guide.md L1049-L1058).
9. **Trust:** in interactive sessions no settings-file hook runs before the trust dialog is accepted (hooks.md L3775); `-p` treats the folder as trusted (L3776). The `:ci` command should document `--bare` / `disableAllHooks` for untrusted repos (L3778).

## Conflicts with the brief

| Brief claim | What the docs say | Source |
| :-- | :-- | :-- |
| "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)" | The only "sooner" mechanism is `asyncRewake` exit code 2, which shows stderr/stdout "as a system reminder so it can react to a long-running background failure"; regular async output "waits until the next user interaction" | hooks.md L461, L3760 |
| "background sync loop every 30-60 s" run by the plugin | No persistent hook type exists; async hooks are one process per firing with no deduplication, and `-p` kills them at teardown; detaching is only mentioned for `-p` | hooks.md L3692-L3693, L3761 |
| "NO bash/PowerShell/cmd anywhere in shipped code" | Docs support this via exec form (`args`), but every doc example is bash + jq; shell-form hooks always spawn `sh -c`, Git Bash, or PowerShell | hooks.md L468-L470; hooks-guide.md L1027 |
| "hooks before edits and on every prompt must be ... under 50 ms" | No hook latency guidance exists; `UserPromptSubmit` default timeout is 30 s and hooks run in parallel. 50 ms is a self-imposed budget, not a doc constraint | hooks-guide.md L954, L480 |
| "handoff written at session end" | `SessionEnd` hooks share a 1.5-second budget unless per-hook `timeout` is raised (max 60 s) | hooks-guide.md L957 |
| "session digest ... (~6 KB cap)" | 6 KB is under the 10,000-character hook output cap, so it is compatible; above 10,000 characters the text is replaced by a file path and preview | hooks.md L941, L1023 |

## Open questions

1. In an interactive session, is a still-running `async: true` hook (or a detached child it spawned) killed at `SessionEnd`/exit? Docs only specify `-p` teardown (hooks.md L3692).
2. Does Node `child_process.spawn` with `detached: true`, `stdio: 'ignore'`, and `unref()` satisfy "start a fully detached process" on macOS, Linux, and Windows, and does the parent hook count as finished immediately?
3. Can `asyncRewake` exit 2 be used for benign notifications (not failures) without surfacing an error notice to the user? Docs describe it only for "a long-running background failure" (hooks.md L461).
4. Does `asyncRewake` accept `additionalContext` JSON, or only stderr/stdout text (hooks.md L461)?
5. When exactly do project-scope plugin hooks first run relative to the workspace trust dialog, and is `hooks/hooks.json` gated the same way as settings-file hooks (hooks.md L3773-L3776 speak of "settings file")? Needs the plugins/permissions pages and an experiment.
6. On the local v2.1.218 CLI, does the async malformed-JSON crash fix (v2.1.202) and the `PreToolUse` prompt-hook turn-ending change (v2.1.210) behave as documented?
7. Measured wall-clock overhead of `node <path>` exec-form startup on each platform, to check the 50 ms budget.
8. Is `${CLAUDE_PLUGIN_ROOT}` substituted in exec-form `args` on Windows when Git Bash is absent? Docs say exec-form substitution is shell-independent (hooks.md L470), that "the `node` plus script-path pattern works on every platform" (hooks.md L475), and that the placeholders are also exported as environment variables in both forms (hooks.md L497), so `process.env.CLAUDE_PLUGIN_ROOT` is a fallback. Still unverified by experiment on Windows.
