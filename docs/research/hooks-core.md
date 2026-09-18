# Research note: Claude Code hooks core (schema, forms, I/O, exit codes, JSON output)

## Source

- https://code.claude.com/docs/en/hooks — raw Markdown downloaded 2026-09-18 from code.claude.com/docs/en/hooks.md, saved locally as `docs-raw/hooks.md`. This note covers lines 1-1119 (through the end of "Decision control"; per-event sections start at L1116).
- Doc version: not stated in hooks.md. The highest version marker anywhere in the file is v2.1.274, and the highest inside L1-L1119 is v2.1.267 (L334), so the page is at least that recent. The claim that it covers v2.1.276 and that the local CLI is v2.1.218 came from the researcher's environment, not the source, and is unverified.
- Citation form: (hooks.md Lnnn). Table padding whitespace is collapsed in copied tables; cell text is verbatim.

## 1. Configuration schema

Three nesting levels: event, matcher group, handler (hooks.md L237-L241). Terminology: "**hook event** for the lifecycle point, **matcher group** for the filter, and **hook handler** for the shell command, HTTP endpoint, MCP tool, prompt, or agent that runs" (hooks.md L246).

Canonical shape (hooks.md L77-L93):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/block-rm.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```

Five handler types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (hooks.md L408-L414). Agent hooks "are experimental and may change" (L414).

### Matcher groups (hooks.md L285-L355)

| Matcher value | Evaluated as | Example |
| :-- | :-- | :-- |
| `"*"`, `""`, or omitted | Match all | fires on every occurrence of the event |
| Only letters, digits, `_`, `-`, spaces, `,`, and `\|` | Exact string, or list of exact strings separated by `\|` or `,` with optional surrounding whitespace | `Bash` matches only the Bash tool; `Edit\|Write` and `Edit, Write` each match either tool exactly; `code-reviewer` matches only that agent type |
| Contains any other character | JavaScript regular expression, unanchored | `^Notebook` matches any tool whose name starts with `Notebook`; `mcp__memory__.*` matches every tool from the `memory` server |

(hooks.md L289-L293)

> A matcher on the regular-expression path is tested with JavaScript's `RegExp.prototype.test`, which succeeds on a match anywhere in the value. `Edit.*` matches both `Edit` and `NotebookEdit`; wrap the pattern in `^` and `$`, as in `^Edit$`, when you need a whole-string match. (hooks.md L295)

> Comma separators and the surrounding whitespace tolerance require Claude Code v2.1.191 or later. (L297)

> Hyphens in the exact-match set require Claude Code v2.1.195 or later. On earlier versions a hyphenated name like `code-reviewer` is evaluated as an unanchored regular expression, so it also fires for `senior-code-reviewer`; anchor it as `^code-reviewer$` on those versions to match only that name. (L299)

> `FileChanged` and `StopFailure` use a narrower exact-match set of letters, digits, `_`, and `|` only. A hyphen, space, or comma in a matcher for those two events keeps it on the regular-expression path, and only `|` separates alternatives. Every other event with matcher support in the table that follows accepts `|` or `,`. (L301)

What the matcher filters, per event (hooks.md L307-L327), relevant rows: tool events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`) match on tool name, e.g. `Bash`, `Edit|Write`, `mcp__.*` (L309); `SessionStart` matches `startup`, `resume`, `clear`, `compact`, `fork` (L310); `SessionEnd` matches `clear`, `resume`, `logout`, `prompt_input_exit`, `other` (L312); `UserPromptExpansion` matches command name ("your skill or command names") (L324); `UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `MessageDisplay` have "no matcher support" (L327); `CwdChanged` has no matcher support (L319). "If you add a `matcher` field to an event without matcher support, it is silently ignored." (L353)

### Common handler fields (hooks.md L422-L432)

| Field | Required | Description |
| :-- | :-- | :-- |
| `type` | yes | `"command"`, `"http"`, `"mcp_tool"`, `"prompt"`, or `"agent"` |
| `if` | no | Permission rule syntax to filter when this hook runs, such as `"Bash(git *)"` or `"Edit(*.ts)"`. The hook command only runs if the tool call matches the pattern. See the Bash matching table below for how Bash patterns evaluate against subcommands, `$()`, and backticks. Only evaluated on tool events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, and `PermissionDenied`. On other events, a hook with `if` set never runs. Uses the same syntax as permission rules |
| `timeout` | no | (verbatim below) |
| `statusMessage` | no | Custom spinner message displayed while the hook runs |
| `once` | no | If `true`, Claude Code removes the hook after its first successful run. A run that fails, blocks with exit code 2, or times out leaves the hook in place, so it runs again on the next matching event. Only honored for hooks declared in skill frontmatter; ignored in settings files and agent frontmatter |

Timeout defaults, verbatim (hooks.md L430):

> Seconds before canceling. Claude Code doesn't enforce it on a command hook you run with `async: true`. Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`. Claude Code lowers the `command`, `http`, and `mcp_tool` default to 30 on `UserPromptSubmit`, `PreModelSwitch`, and `PostModelSwitch`, and to 10 on `MessageDisplay`. `SessionEnd` hooks share a 1.5-second budget; if your settings set a longer per-hook `timeout`, Claude Code raises the budget to match, up to 60 seconds

`if` details: "The `if` field holds exactly one permission rule. There is no `&&`, `||`, or list syntax for combining rules; to apply multiple conditions, define a separate hook handler for each." (L434). `"Edit(src/**)"` matches only the top-level `src`; use `"Edit(**/src/**)"` for any depth; "Before v2.1.214, `"Edit(src/**)"` matched a directory named `src` at any depth" (L436). Bash `if` matching is best-effort: "When Claude Code can't determine which commands the Bash input runs, it runs your hook regardless of the pattern. Because the `if` filter is best-effort, use the permission system rather than a hook to enforce a hard allow or deny." (L450)

### Command hook fields (hooks.md L452-L462)

| Field | Required | Description |
| :-- | :-- | :-- |
| `command` | yes | Shell command to execute. With `args`, the executable to spawn directly. See Exec form and shell form |
| `args` | no | Argument list. When present, `command` is resolved as an executable and spawned directly with `args` as the argument vector, with no shell involved. See Exec form and shell form |
| `async` | no | If `true`, runs in the background without blocking. See Run hooks in the background |
| `asyncRewake` | no | If `true`, runs in the background and wakes Claude on exit code 2. The hook's stderr, or stdout if stderr is empty, is shown to Claude as a system reminder so it can react to a long-running background failure |
| `shell` | no | Shell to use for this hook. Accepts `"bash"` or `"powershell"`. Defaults to `"bash"`, or to `"powershell"` on Windows when Git Bash isn't installed. Setting `"powershell"` runs the command via PowerShell on Windows. Does not require `CLAUDE_CODE_USE_POWERSHELL_TOOL` since hooks spawn PowerShell directly. Ignored when `args` is set |

Defaults for `async`, `asyncRewake`: no explicit default stated; described as "If `true`" (L460-L461). HTTP hook fields (`url`, `headers`, `allowedEnvVars`) at L507-L515; MCP tool hook fields (`server`, `tool`, `input`) at L546-L554; prompt/agent fields (`prompt`, `model`) at L608-L615. Plugin `hooks/hooks.json` accepts an optional top-level `description` (L659).

## 2. Exec form vs shell form (hooks.md L466-L505)

> A command hook runs as exec form when `args` is set, and shell form when `args` is omitted. Set `args` whenever the hook references a path placeholder, since each element is passed as one argument with no quoting. Omit `args` when you need shell features like pipes or `&&`, or when neither concern applies. (L468)

> **Exec form** runs when `args` is present. Claude Code resolves `command` as an executable on `PATH` and spawns it directly with `args` as the argument vector. There is no shell, so each `args` element is one argument exactly as written, and path placeholders like `${CLAUDE_PLUGIN_ROOT}` are substituted into `command` and into each `args` element as plain strings. Special characters such as apostrophes, `$`, and backticks pass through verbatim because there is no shell to interpret them. No shell tokenization happens on any platform. (L470)

> **Shell form** runs when `args` is absent. The `command` string is passed to a shell: `sh -c` on macOS and Linux, Git Bash on Windows, or PowerShell when Git Bash isn't installed. Set the `shell` field to choose explicitly. The shell tokenizes the string, expands variables, and interprets pipes, `&&`, redirects, and globs. (L472)

Windows caveat, verbatim (L475):

> On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`. The `.cmd` and `.bat` shims that npm, npx, eslint, and other tools install in `node_modules/.bin` are not executables and can't be spawned without a shell. To run them in exec form, invoke the underlying script with `node` directly, for example `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/node_modules/eslint/bin/eslint.js"]`. The `node` plus script-path pattern works on every platform because `node.exe` is a real binary. To run a `.cmd` or `.bat` shim by name, use shell form.

The `node` + args example, verbatim (L478-L486):

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js", "--fix"]
}
```

Shell-form equivalent (L488-L495):

```json
{
  "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}\"/scripts/format.js --fix"
}
```

> Both forms support the same path placeholders, and both export them as the environment variables `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA` on the spawned process, so a script can read `process.env.CLAUDE_PLUGIN_ROOT` regardless of how it was launched. (L497)

Plugin `${user_config.*}`: substituted "in exec form only" (L499); a shell-form plugin hook referencing `${user_config.*}` "fails with an error instead of running"; use `$CLAUDE_PLUGIN_OPTION_<KEY>` env var or switch to exec form; "Before v2.1.207, shell-form plugin hook commands also substituted `${user_config.*}`" (L501).

> In exec form, `command` is the executable name or path only. If `command` is a bare name with no path separator and contains whitespace alongside `args`, Claude Code logs a warning because the spawn will fail: there is no executable named `node script.js`. Move the extra tokens into `args`. Absolute paths with spaces, such as `C:\Program Files\nodejs\node.exe`, are a single valid executable and don't trigger the warning. (L504)

Placeholders (hooks.md L619-L623): `${CLAUDE_PROJECT_DIR}` "the project root where the session started" (also set for stdio MCP servers and plugin LSP servers); `${CLAUDE_PLUGIN_ROOT}` "the plugin's installation directory"; `${CLAUDE_PLUGIN_DATA}` "the plugin's persistent data directory, for dependencies and state that should survive plugin updates". Worktrees: `${CLAUDE_PROJECT_DIR}` "stays put"; the `cwd` input field "is the worktree root after Claude enters a worktree, and the new directory after Claude runs `cd`" (L626-L630). "Prefer exec form for any hook that references a path placeholder. In shell form, wrap each placeholder in double quotes." (L632)

## 3. Where hooks live; merging (hooks.md L249-L280, L659-L714)

| Location | Scope | Shareable |
| :-- | :-- | :-- |
| `~/.claude/settings.json` | All your projects | No, local to your machine |
| `.claude/settings.json` | Single project | Yes, can be committed to the repo |
| `.claude/settings.local.json` | Single project | No, gitignored when Claude Code saves a setting to it |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin is enabled | Yes, bundled with the plugin |
| Skill frontmatter | The rest of the session once the skill is invoked. See Hooks in skills and agents | Yes, defined in the skill file |
| Subagent frontmatter | While that subagent is running | Yes, defined in the subagent file |

(hooks.md L253-L261)

- Cloud sessions "don't read your local `~/.claude/settings.json`; hooks there come from the repo, meaning its `.claude/settings.json` in a session with one repository and the plugins it declares in any session, and from your organization's server-managed settings" (L263).
- Hooks from settings, managed policy, and plugins "also run inside subagents"; input carries `agent_id` and `agent_type` (L267).
- `allowManagedHooksOnly`: "Your user, project, local, and plugin hooks are blocked. Hooks from plugins force-enabled in managed settings `enabledPlugins` are exempt" (L271); it also narrows `statusLine` to managed settings (L272).
- > Hook entries merge across settings levels rather than replacing each other: user, project, and local settings add their own hooks without removing managed ones, and the `disableAllHooks` setting can't disable managed hooks from outside managed settings. (L278)
- HTTP hook allowlists "apply to hooks from every source, including managed policy settings": `allowedHttpHookUrls` (when defined at any level, an HTTP handler runs only if its URL matches the merged allowlist) and `httpHookAllowedEnvVars` (only listed env vars are interpolated into hook headers) (L280-L283).
- Dedup: > All matching hooks run in parallel. If you define the same handler in more than one settings file, it runs once. A plugin's or skill's copy of the same handler stays separate. (L416)
- Plugin: "Define plugin hooks in `hooks/hooks.json` with an optional top-level `description` field. When a plugin is enabled, its hooks merge with your user and project hooks." (L659). Example at L663-L681 uses `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh", "args": [], "timeout": 30`.
- Skills/agents (L690-L714): subagent hooks run "only while that subagent is running"; `Stop` converts to `SubagentStop` (L692). Skill hooks are registered on invocation and "keeps running them for the rest of the session"; `once: true` removes after first success (L693). Frontmatter format example at L697-L708 (YAML `hooks:` key with same structure). Project-skill frontmatter hooks follow the settings-file workspace-trust rule (L712). Project-subagent frontmatter hooks "run only after you accept the workspace trust dialog ... Before v2.1.218, these hooks could run from folders you hadn't trusted." (L714)
- `/hooks` menu is read-only; sources labeled `User Settings`, `Project Settings`, `Local Settings`, `Plugin Hooks`, `Session Hooks` (L718-L728).
- Disable/remove (L732-L738): delete the entry; `"disableAllHooks": true` disables all after settings precedence; `--settings '{"disableAllHooks": true}'` for one run; "There is no way to disable an individual hook while keeping it in the configuration." (L734). "Direct edits to hooks in settings files are normally picked up automatically by the file watcher." (L738)

## 4. Common input fields (hooks.md L748-L798)

| Field | Description (abridged; verbatim where quoted) |
| :-- | :-- |
| `session_id` | Current session identifier (L754) |
| `prompt_id` | UUID for the current user prompt; "Absent until the first user input. Requires Claude Code v2.1.196 or later" (L755) |
| `transcript_path` | Path to conversation JSON; "written asynchronously and may lag the in-memory conversation" (L756) |
| `cwd` | Current working directory when the hook is invoked (L757) |
| `scratchpad_dir` | Session scratchpad path; "Absent when the session has no scratchpad or the temp directory is unavailable. Requires Claude Code v2.1.257 or later" (L758) |
| `permission_mode` | `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, or `"bypassPermissions"`; "The mode labeled **Manual** arrives as `"default"`, never as `"manual"`"; "Not all events receive this field" (L759) |
| `effort` | Object with `level` (`"low"`, `"medium"`, `"high"`, `"xhigh"`, or `"max"`); "Present for events that fire within a tool-use context, such as `PreToolUse`, `PostToolUse`, `Stop`, and `SubagentStop`, when the current model supports the effort parameter"; also `$CLAUDE_EFFORT` env var (L760) |
| `hook_event_name` | Name of the event that fired (L761) |

With `--agent` or inside a subagent: `agent_id` and `agent_type` (L763-L768). Only `SessionStart` can receive `model`, and not always (L770). "There is no `$CLAUDE_MODEL` environment variable." (L772)

> A hook process inherits the parent environment, apart from the `OTEL_*` exporter variables that Claude Code removes from every subprocess it spawns and, when `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is set to `1`, the variables it strips. (L774)

Example stdin (hooks.md L778-L796):

```json
{
  "session_id": "abc123",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "scratchpad_dir": "/tmp/claude-1000/-home-user-my-project/abc123/scratchpad",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

## 5. Exit codes and stdout (hooks.md L800-L874)

> The exit code doesn't act alone. Claude Code reads JSON output fields from stdout on every exit code, not just 0, and for events that use the standard decision model, a parsed object that passes schema validation takes effect alongside the code. Exit 2's block is the one outcome JSON can't override. (L802)

Exit 0 (L806-L822):
- "Exit 0 means success, and is the intended exit code when you print JSON for structured control." (L808)
- > For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, where Claude Code adds plain-text stdout as context that Claude can see and act on. (L810)
- JSON-vs-plain-text rule (L812-L816), verbatim:
  > * **Starts with `{` and ends with `}`**: Claude Code parses it as JSON. When the output is two or more lines that each parse as JSON on their own, and no line is a JSON output object that sets a field, Claude Code treats the whole output as plain text. When one of those lines does set a field, the whole output is a parse failure, described below.
  > * **Starts with `{` but doesn't end with `}`**: Claude Code treats it as plain text.
  > * **Starts with anything else**: Claude Code treats it as plain text, a JSON array or a quoted JSON string included.
- Schema-validation failure on exit 0 (standard-decision events): "a non-blocking error: the action proceeds, and the transcript shows a `<hook name> hook error` notice with the validation message. The same happens on any exit code other than 2" (L818).
- Unparseable JSON: non-blocking error on every code but 2; "On the events that add plain-text stdout as context, Claude Code doesn't add the text. Before v2.1.248, Claude Code treated that stdout as plain text." (L820)
- > Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it. ... To surface a warning to Claude from a `PostToolUse` or `PostToolUseFailure` hook, exit 2 instead so Claude sees the stderr even though the tool already ran. (L822)

Exit 2 (L824-L830):
- > Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print JSON: even a JSON `permissionDecision` of `"allow"` can't override it. Claude Code still reads any valid JSON output on stdout. On `Elicitation` and `ElicitationResult`, an exit-2 hook's `hookSpecificOutput` is ignored. (L826)
- "The blocking message is the reason from your JSON's blocking decision when it makes one, and your stderr text otherwise." (L828)
- Exit 2 + invalid JSON "still blocks: Claude Code uses stderr as the blocking reason ... Before v2.1.214, Claude Code treated that combination as a non-blocking error and the action proceeded." (L830)

Other exit codes (L848-L864):
- "Any other exit code doesn't block on its own for most hook events." (L850)
- Valid JSON: "Claude Code ignores the exit code and the JSON alone decides the outcome" and "the hook isn't reported as an error" (L852-L854).
- Plain text or empty stdout: > it's a non-blocking error for most hook events: the action proceeds, and the transcript shows a `<hook name> hook error` notice followed by the first line of stderr, prefixed with `Failed with non-blocking status code:`. (L857)
- `StopFailure` "ignore[s] your JSON on every exit code, apart from side-effect fields like `terminalSequence`" (L859).
- Cannot start: > A hook that can't start lands in the same non-blocking bucket. When the script path doesn't exist or isn't executable, the shell exits with a code like 127 and you see the same notice with the interpreter's message, for example `Failed with non-blocking status code: /bin/sh: /path/to/hook.sh: No such file or directory`. For most hook events, the action proceeds. When you set up a policy hook, watch for this notice on its first run: a mistyped path in `settings.json` leaves the gate silently disabled. (L861)
- Warning: "Without valid JSON on stdout, Claude Code treats exit code 1 as a non-blocking error and proceeds with the action" (L864).

Timeouts (L867-L874):
> Apart from a command hook you run with `async: true`, Claude Code cancels a `command`, `http`, or `mcp_tool` hook that reaches its `timeout`, discarding the hook's output, so on most events a timed-out hook renders no decision. (L869)

`PreModelSwitch` timeout blocks the switch (L871). On `PreToolUse`: "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call ... don't count on a stalled hook to act as a gate." (L873) The other family differs: "An Agent SDK callback hook that exceeds its timeout blocks the tool call." (L874)

## 6. Exit code 2 behavior per event (hooks.md L876-L916), verbatim

| Hook event | Can block? | What happens on exit 2 |
| :-- | :-- | :-- |
| `PreToolUse` | Yes | Blocks the tool call |
| `PermissionRequest` | No | Exit code 2 isn't honored for this event and the permission flow proceeds unchanged. Deny through the `decision` object instead |
| `UserPromptSubmit` | Yes | Blocks prompt processing and erases the prompt |
| `UserPromptExpansion` | Yes | Blocks the expansion |
| `Stop` | Yes | Prevents Claude from stopping, continues the conversation |
| `SubagentStop` | Yes | Prevents the subagent from stopping |
| `TeammateIdle` | Yes | Prevents the teammate from going idle, so it continues working |
| `TaskCreated` | Yes | Rolls back the task creation |
| `TaskCompleted` | Yes | Prevents the task from being marked as completed |
| `ConfigChange` | Yes | Blocks the configuration change from taking effect (except `policy_settings`) |
| `StopFailure` | No | Output and exit code are ignored, except `terminalSequence` |
| `PostToolUse` | No | Shows stderr to Claude; the tool already ran |
| `PostToolUseFailure` | No | Shows stderr to Claude; the tool already failed |
| `PostToolBatch` | Yes | Stops the agentic loop before the next model call |
| `PermissionDenied` | No | Exit code and stderr are ignored because the denial already occurred. Use JSON `hookSpecificOutput.retry: true` to tell the model it may retry; Claude Code ignores `retry: true` for no-verdict denials |
| `Notification` | No | Exit code and stderr are ignored |
| `SubagentStart` | No | Shows stderr to user only |
| `SessionStart` | No | Shows stderr to user only |
| `Setup` | No | Exit code and stderr are ignored |
| `SessionEnd` | No | Shows stderr to user only |
| `CwdChanged` | No | Shows stderr to user only |
| `DirectoryAdded` | No | Stderr goes to the debug log; the directory is already added |
| `FileChanged` | No | Shows stderr to user only |
| `PreCompact` | Yes | Blocks compaction |
| `PostCompact` | No | Shows stderr to user only |
| `PreModelSwitch` | Yes | Blocks the model switch and shows stderr to the user |
| `PostModelSwitch` | No | Shows stderr to user only; the model already switched |
| `Elicitation` | Yes | Denies the elicitation |
| `ElicitationResult` | Yes | Blocks the response (action becomes decline) |
| `WorktreeCreate` | Yes | Any non-zero exit code causes worktree creation to fail |
| `WorktreeRemove` | Yes | Any non-zero exit code causes worktree removal to fail if the directory still exists afterward. See WorktreeRemove for what happens to the directory |
| `InstructionsLoaded` | No | Exit code is ignored |
| `MessageDisplay` | No | The original text is displayed |

(hooks.md L880-L914)

> For `SessionStart`, `SubagentStart`, and `PostModelSwitch`, Claude Code renders the exit code 2 stderr in the transcript as a `<hook name> hook error` notice, the same way it renders a non-blocking error. Claude doesn't see it, and the session or subagent proceeds. For `SubagentStart`, the notice appears in the subagent's own transcript, not in the parent conversation. (L916)

HTTP response handling (L918-L929): 2xx empty body = exit 0 no output; 2xx JSON object parsed with same schema; 2xx plain text = non-blocking error and text not added to context; non-2xx, connection failure = non-blocking, continues; "HTTP hooks can't signal a blocking error through status codes alone" (L929).

## 7. JSON output universal fields (hooks.md L931-L963)

> Choose one approach per hook: either use exit codes alone for signaling, or exit 0 and print JSON for structured control. If you mix them, exit 2 keeps its blocking effect, and Claude Code still reads the JSON fields, with the one elicitation exception noted under Exit code 2. (L936)

> Your hook's stdout must contain only the JSON object. If your shell profile prints text on startup, it can interfere with JSON parsing. (L939)

> Hook output strings, including `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000 characters. Output that exceeds this limit is saved to a file and replaced with a preview and file path, the same way a large valid Bash result is handled under Output limits. (L941)

Three kinds of fields (L943-L947): universal fields ("Every event accepts them, but some events discard them or deliver `systemMessage` somewhere other than the transcript"); top-level `decision`/`reason`; `hookSpecificOutput` ("requires a `hookEventName` field set to the event name").

| Field | Default | Description |
| :-- | :-- | :-- |
| `continue` | `true` | If `false`, Claude stops processing entirely after the hook runs. Takes precedence over any event-specific decision fields |
| `stopReason` | none | Message shown to the user when `continue` is `false`. It stays in the conversation, so Claude sees it if the conversation continues |
| `suppressOutput` | `false` | Has no effect: Claude Code accepts the field but doesn't act on it. A successful hook's stdout is never shown in the transcript and is recorded in the debug log |
| `systemMessage` | none | Warning message shown to the user. In Agent SDK and `--output-format stream-json` output, it can arrive as an `SDKInformationalMessage` |
| `terminalSequence` | none | A terminal escape sequence for Claude Code to emit on your behalf, such as a desktop notification, window title, or bell. Restricted to OSC `0`/`1`/`2`/`9`/`99`/`777` and BEL. If the value contains anything outside the allowlist, the field is ignored. Use this instead of writing to `/dev/tty`, which is unavailable to hooks |

(hooks.md L949-L955)

`{ "continue": false, "stopReason": "Build failed, fix errors before continuing" }` (L960). "For `PreToolUse` and `PostToolUse` hooks, the stop applies even when the tool call fails or completes while Claude is still streaming a response." (L963)

`terminalSequence` (L965-L985): allowlist OSC 0/1/2 (titles), OSC 9 (iTerm2, ConEmu, Windows Terminal, WezTerm, incl. `9;4` taskbar progress), OSC 99 (Kitty), OSC 777 (urxvt, Ghostty, Warp), bare BEL (L971-L975). Works on events that discard `systemMessage`/`continue` such as `Notification`, `StopFailure` (L979). "Claude Code writes the sequence only in an interactive session, and only while its interface is on screen. In non-interactive mode with the `-p` flag and in the Agent SDK, it ignores the field." (L981). Not for `WorktreeCreate` command hooks (L982).

## 8. Decision control table (hooks.md L1037-L1056), verbatim

| Events | Decision pattern | Key fields |
| :-- | :-- | :-- |
| UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact | Top-level `decision` | `decision: "block"`, `reason`. Stop and SubagentStop also accept `hookSpecificOutput.additionalContext` for non-error feedback that continues the conversation |
| TeammateIdle, TaskCompleted | Exit code or `continue: false` | Exit code 2 blocks the action with stderr feedback. JSON `{"continue": false, "stopReason": "..."}` also stops the teammate entirely, matching `Stop` hook behavior; TaskCompleted ignores it when the `TaskUpdate` tool triggered the event |
| TaskCreated | Exit code or top-level `decision` | Exit code 2 or `decision: "block"` cancels the task and returns the message to Claude. `continue: false` is ignored |
| PreToolUse | `hookSpecificOutput` | `permissionDecision` (allow/deny/ask/defer), `permissionDecisionReason` |
| PreModelSwitch | `hookSpecificOutput` or top-level `decision` | `permissionDecision` (allow/deny/ask), `permissionDecisionReason`. `decision: "block"` also cancels the switch |
| PermissionRequest | `hookSpecificOutput` | `decision.behavior` (allow/deny) |
| PermissionDenied | `hookSpecificOutput` | `retry: true` tells the model it may retry the denied tool call; Claude Code ignores it for no-verdict denials |
| WorktreeCreate | path return | Command hook prints path on stdout; HTTP hook returns `hookSpecificOutput.worktreePath`. Hook failure or missing path fails creation |
| WorktreeRemove | Exit code | Any non-zero exit code makes the removal fail if the directory still exists afterward. JSON output is discarded |
| Elicitation | `hookSpecificOutput` | `action` (accept/decline/cancel), `content` (form field values for accept) |
| ElicitationResult | `hookSpecificOutput` | `action` (accept/decline/cancel), `content` (form field values override) |
| MessageDisplay | `hookSpecificOutput` | `displayContent` replaces the displayed text on screen. Display-only: the transcript and what Claude sees keep the original |
| SessionStart, SubagentStart, PostModelSwitch | Context only | `hookSpecificOutput.additionalContext` adds context for Claude. SessionStart also accepts `initialUserMessage`, `watchPaths`, `sessionTitle`, and `reloadSkills`. No blocking or decision control |
| Setup, Notification, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, CwdChanged, DirectoryAdded, FileChanged | None | No decision control. Used for side effects like logging or cleanup |

(hooks.md L1041-L1056)

Rewrite capabilities (L1058-L1063): `PreToolUse` `updatedInput` under `hookSpecificOutput`; `PermissionRequest` `updatedInput` inside `decision`; `PostToolUse` `updatedToolOutput`; "`UserPromptSubmit`: can't replace the prompt; it only injects `additionalContext` alongside it" (L1063). "The only value for `decision` is `"block"`. To allow the action to proceed, omit `decision` from your JSON, or exit 0 without any JSON at all" (L1071).

## 9. Add context for Claude (hooks.md L998-L1035)

> The `additionalContext` field passes a string from your hook into Claude's context window. Claude Code wraps the string in a system reminder and inserts it into the conversation at the point where the hook fired. Claude reads the reminder on the next model request, but it doesn't appear as a chat message in the interface. (L1000)

Shape (L1004-L1011):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "This file is generated. Edit src/schema.ts and run `bun generate` instead."
  }
}
```

Placement by event (L1013-L1019): SessionStart/SubagentStart "at the start of the conversation, before the first prompt"; UserPromptSubmit/UserPromptExpansion "alongside the submitted prompt"; PreToolUse/PostToolUse/PostToolUseFailure/PostToolBatch "next to the tool result"; Stop/SubagentStop "at the end of the turn. The conversation continues so Claude can act on the feedback"; PostModelSwitch "with the next request after the switch".

> When several hooks return `additionalContext` for the same event, Claude receives all of the values. (L1021)

> If a value exceeds 10,000 characters, Claude Code writes the text to a file in the session directory and passes Claude the file path with a short preview instead. (L1023)

Ordering among multiple hooks' values: Not found in docs (searched "order", "ordering", "concatenat" in L998-L1035; only "receives all of the values").

> Write the text as factual statements rather than imperative system instructions. ... Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as context. (L1033)

> Claude Code saves the injected text in the session transcript. For mid-session events like `PostToolUse` or `UserPromptSubmit`, when you resume with `--continue` or `--resume`, Claude Code replays the saved text rather than re-running the hook for past turns, so values like timestamps or commit SHAs become stale. `SessionStart` hooks run again on resume with `source` set to `"resume"`, or `"fork"` if you added `--fork-session`, so they can refresh their context. (L1035)

## 10. Hook environment

- > All matching hooks run in parallel. (L416)
- > Handlers run in the current directory with Claude Code's environment. If the current directory no longer exists, ... Claude Code runs command hooks from the first of these that still exists: the directory the session started in, the project root, your home directory, or the system temp directory. (L418)
- > The `$CLAUDE_CODE_REMOTE` environment variable is `"true"` in remote web environments and not set in the local CLI. Claude Code v2.1.199 and later sets `$CLAUDE_CODE_BRIDGE_SESSION_ID` to the Remote Control session ID while the local session has an active Remote Control connection. (L420)
- PATH: exec form "resolves `command` as an executable on `PATH`" (L470). No statement about PATH modification for hooks in this range.
- > On macOS and Linux, command hooks run in their own session without a controlling terminal. The hook process and any child processes can't open `/dev/tty` or send escape sequences directly to the Claude Code interface. Windows has no `/dev/tty`. (L744)
- Environment inheritance and `OTEL_*` / `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` (L774, quoted in section 4). `$CLAUDE_EFFORT` env var (L758). Exported placeholders `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` (L497); `$CLAUDE_PLUGIN_OPTION_<KEY>` (L501).
- `CLAUDE_CODE_ENTRYPOINT`: Not found in docs (grep for "ENTRYPOINT" across the whole hooks.md returned nothing).
- Where hooks fire: "Claude Code fires the same hook events wherever it runs: sessions in the terminal, IDE extensions, the Desktop app, and cloud sessions." (L13)

## 11. Windows-specific statements (L1-L1119)

- Windows example uses matcher `Bash|PowerShell` and `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...` (L122-L162); "`-NoProfile` flag skips loading your PowerShell profile so the hook starts fast, and `-ExecutionPolicy Bypass` lets PowerShell run the local script file" (L163).
- `shell` field defaults "to `"powershell"` on Windows when Git Bash isn't installed" (L462).
- Shell form: "Git Bash on Windows, or PowerShell when Git Bash isn't installed" (L472).
- Exec form on Windows requires a real executable; `.cmd`/`.bat` shims cannot be spawned; `node` + script path works everywhere (L475).
- Absolute paths with spaces like `C:\Program Files\nodejs\node.exe` are valid exec-form `command` (L504).
- "Windows has no `/dev/tty`." (L744); `terminalSequence` "works on Windows where there is no `/dev/tty`" (L967); OSC 9 covers Windows Terminal/ConEmu (L972).

## Implications for Synchrobuilder

1. Ship every hook as exec form: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs"]`. This is the documented cross-platform pattern (L475, L478-L486), avoids any shell (L470), and satisfies the brief's "no bash/PowerShell" rule. Scripts can read `process.env.CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` / `CLAUDE_PROJECT_DIR` (L497). Use `CLAUDE_PLUGIN_DATA` for the snapshot cache and logs so they survive plugin updates (L623).
2. Guard hook: `PostToolUse` with `matcher: "Edit|Write"` (L333-L351 example) and return `hookSpecificOutput.additionalContext` (L1004-L1011), which is placed "next to the tool result" (L1017) so Claude sees it the same turn. Exit 0 with JSON; do not rely on stderr (L822). Optionally use `if: "Edit(*.ts)"`-style narrowing (L429), one rule per handler (L434).
3. Fail-open is the platform default for non-blocking paths: exit 0 with no output is "no decision" (L225); but any nonzero exit other than 2 (including a missing script, L861) produces a visible `<hook name> hook error` notice (L857), so the .mjs must catch everything and exit 0. Timeouts discard output silently (L869); set explicit short `timeout` values on the fast hooks.
4. Collision warnings: `PreToolUse` on `Write|Edit` can return `permissionDecision: "ask"` with `permissionDecisionReason` (L1046) to implement "ask" mode, or `additionalContext` only for "warn" mode. Note the default `PreToolUse` timeout is 600 s and a timed-out hook does not block (L873), consistent with advisory design.
5. Session digest: `SessionStart` supports `additionalContext` plus `initialUserMessage`, `watchPaths`, `sessionTitle`, `reloadSkills` (L1055); it runs again on resume/fork (L1035). Plain-text stdout also becomes context on SessionStart (L810). The brief's ~6 KB cap is below the 10,000-character cap after which text is spilled to a file with a preview (L941, L1023).
6. Notify landing "in the teammate's next prompt": `UserPromptSubmit` `additionalContext` lands "alongside the submitted prompt" (L1016); default timeout lowered to 30 s there (L430). Must return JSON starting with `{` and ending with `}` with no other stdout (L814, L939).
7. Handoff at session end: `SessionEnd` hooks "share a 1.5-second budget", raisable up to 60 s via per-hook `timeout` (L430). Exit code 2 stderr shown to user only (L901). The handoff writer must be fast or spawn a detached child.
8. Untrusted teammate text: docs warn that text "framed as out-of-band system commands can trigger Claude's prompt-injection defenses" (L1033); write context as factual statements and wrap teammate text in a labeled block.
9. Plugin hooks merge with user/project hooks and are not deduplicated against a user's identical copy (L416, L659); `once` is ignored outside skill frontmatter (L432), so do not rely on it in `hooks/hooks.json`.
10. `/synchrobuilder:mute` cannot disable a single hook via settings ("There is no way to disable an individual hook", L734); mute must be implemented inside the scripts (e.g. a local flag file checked first).
11. Windows: `node` exec form works; never reference `.cmd` shims (L475). Paths under `cwd` may use backslashes; normalize (L1606 is outside range; noted for the events note).
12. `cwd` follows worktrees and `cd`, while `CLAUDE_PROJECT_DIR` stays at the session's project root (L626-L630); the snapshot cache lookup should key on the repo root derived from `cwd`.
13. `$CLAUDE_CODE_REMOTE` is `"true"` in remote web environments (L420); cloud sessions do not read `~/.claude/settings.json` but do load repo-declared plugins (L263).
14. `terminalSequence` (OSC 9/99/777) can produce desktop notifications for `notify` without `/dev/tty` (L967-L975), interactive sessions only (L981).

## Conflicts with the brief

- Brief: guard hook "tells Claude in the same turn". Docs: `additionalContext` from `PostToolUse` is inserted "next to the tool result" and "Claude reads the reminder on the next model request" (L1000, L1017). This is within the same turn, so no conflict, but it is delivered on the next model request, not instantly.
- Brief: hooks on every prompt "under 50 ms". Docs impose no such limit; the only relevant defaults are 30 s on `UserPromptSubmit` (L430). The 50 ms budget is self-imposed. No conflict, but note that every hook is a fresh `node` process spawn (L470); Node startup alone may exceed 50 ms on some machines (open question).
- Brief: "fail open (exit 0, no output ...)". Docs: exit 0 with no output is "no decision" (L225), which matches. But a script that crashes before catching (e.g. syntax error) exits nonzero and surfaces a `<hook name> hook error` notice to the user (L857, L861). No conflict, but the fail-open promise depends on the script's own top-level try/catch and on the file path existing.
- Brief: `/synchrobuilder:mute`. Docs: no per-hook disable exists (L734). Mute must be implemented in-script, not via settings.
- Brief: "consent before changing a machine". Docs: `SessionStart` hooks run automatically on every start once the plugin is enabled (L253-L261, L659). Any machine-changing action must be gated behind an explicit command, not a hook.
- Brief: "at most once per file per 30 min" warnings. Docs: `once: true` is ignored in settings files and agent frontmatter (L432); rate limiting must be done by the script with local state.
- Brief: Status line presence. Not covered in this range (only L272 mentions `statusLine` under `allowManagedHooksOnly`); see the statusline research note.

## Open questions

1. Cold-start latency of `node <script>.mjs` spawned per hook on macOS/Linux/Windows; whether the 50 ms budget is achievable (docs give no numbers).
2. Whether the `PostToolUse` `additionalContext` for `Write|Edit` appears before Claude's next tool call in the same assistant turn when tools are batched (`PostToolBatch` semantics at L46, L2154+ are outside this range).
3. Exact rendering of `systemMessage` for `PostToolUse` and `UserPromptSubmit` in the terminal UI (docs say "Warning message shown to the user", L954, and that some events deliver it elsewhere, L945).
4. Ordering of multiple hooks' `additionalContext` values for the same event (docs only say "Claude receives all of the values", L1021).
5. Whether the `SessionEnd` 1.5 s budget is enforced by killing the process (and thus a detached child survives) on all three OSes (L430).
6. On the local v2.1.218 CLI: exit-2-with-invalid-JSON handling (changed in v2.1.214, L830), plain-text-vs-JSON parse failure (changed in v2.1.248, L820), `scratchpad_dir` presence (v2.1.257, L758). If the local CLI is v2.1.218 (unverified, see Source), the last two post-date it and will behave differently locally.
7. How `${CLAUDE_PLUGIN_DATA}` is created and whether it exists before the first hook runs (details are in plugins-reference, not this range).
8. Whether Windows exec form finds `node` when only a `node.exe` under a version manager (nvm-windows, Volta shims) is on PATH; docs say `node.exe` is a real binary (L475) but say nothing about shim-based installs.
