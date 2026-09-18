# Hook events: SessionStart through PermissionRequest

Research note for Synchrobuilder covering the first half of the "Hook events" section of the Claude Code hooks reference: SessionStart, Setup, InstructionsLoaded, UserPromptSubmit, UserPromptExpansion, MessageDisplay, PreToolUse (with per-tool `tool_input` schemas and defer), and PermissionRequest.

## Source

- https://code.claude.com/docs/en/hooks (raw Markdown `hooks.md`, assigned range L1116-L1984; cross-referenced sections L285-L299, L422-L432, L546-L606, L748-L798, L800-L916, L931-L1063, L3659-L3699 read for definitions the range relies on)
- Fetch date: 2026-09-18 (raw Markdown downloaded from code.claude.com/docs/en/hooks.md)
- The highest version marker in this copy of `hooks.md` is v2.1.274 (L1599, `mcp_server`); the doc itself states no "current" version, and the npm latest version was not verifiable at fact-check time. The local CLI used for experiments is v2.1.218 (`claude --version`, 2026-09-18).

All citations below are to `hooks.md` line numbers in that raw file.

## Cross-cutting facts the events depend on

**Plain stdout on exit 0.** Only four events turn plain stdout into context Claude sees (hooks.md L810):

> For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, where Claude Code adds plain-text stdout as context that Claude can see and act on.

**JSON vs plain text detection** (hooks.md L812-L816): stdout that starts with `{` and ends with `}` (ignoring surrounding whitespace) is parsed as JSON; anything else is plain text. Multi-line output where each line parses as JSON and none sets a field is treated as plain text; if one line sets a field, the whole output is a parse failure (L814). A parse failure on a standard-decision-model event is a non-blocking error and, on the events that add plain-text stdout as context, "Claude Code doesn't add the text. Before v2.1.248, Claude Code treated that stdout as plain text." (L820).

**Stderr on exit 0** (hooks.md L822): "Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it."

**Exit 2** (hooks.md L826-L828): blocks on events that can block regardless of JSON; "even a JSON `permissionDecision` of `"allow"` can't override it." The blocking message is the JSON reason if one is given, otherwise stderr.

**Other exit codes** (hooks.md L850-L864): with valid JSON, the JSON alone decides; with plain/empty stdout it is a non-blocking error shown as `<hook name> hook error` plus first line of stderr prefixed `Failed with non-blocking status code:`. Exit 1 does not block (L864). A missing/non-executable script path lands in the same bucket (L861).

**Default timeouts** (hooks.md L430):

> Defaults: 600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`. Claude Code lowers the `command`, `http`, and `mcp_tool` default to 30 on [`UserPromptSubmit`](#userpromptsubmit), [`PreModelSwitch`](#premodelswitch), and [`PostModelSwitch`](#postmodelswitch), and to 10 on [`MessageDisplay`](#messagedisplay).

**Timeout behavior** (hooks.md L869-L874): a timed-out `command`/`http`/`mcp_tool` hook is canceled with output discarded, so it renders no decision; on PreToolUse "A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call. The call continues through the normal permission flow, so don't count on a stalled hook to act as a gate." (L873).

**Output size cap** (hooks.md L941): "Hook output strings, including `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000 characters. Output that exceeds this limit is saved to a file and replaced with a preview and file path". Restated for `additionalContext` at L1023.

**additionalContext delivery** (hooks.md L1000): wrapped in a system reminder, inserted where the hook fired, read on the next model request, "but it doesn't appear as a chat message in the interface." Placement per event (L1015-L1017): SessionStart at conversation start before the first prompt; UserPromptSubmit/UserPromptExpansion alongside the submitted prompt; PreToolUse next to the tool result. Multiple hooks' values are all delivered (L1021). Phrasing guidance (L1033): "Write the text as factual statements rather than imperative system instructions... Text framed as out-of-band system commands can trigger Claude's prompt-injection defenses, which causes Claude to surface the text to you instead of treating it as context." Replay on resume (L1035): mid-session injected text is replayed, not re-run; "`SessionStart` hooks run again on resume with `source` set to `"resume"`, or `"fork"` if you added `--fork-session`, so they can refresh their context."

**Common input fields** (hooks.md L754-L761): `session_id`, `prompt_id` (v2.1.196+, absent until first user input), `transcript_path` (written asynchronously, may lag), `cwd`, `scratchpad_dir` (v2.1.257+), `permission_mode` (`"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, `"bypassPermissions"`; Manual arrives as `"default"`; "Not all events receive this field"), `effort`, `hook_event_name`. Under `--agent` or inside a subagent: `agent_id`, `agent_type` (L763-L768).

**Universal JSON output fields** (hooks.md L951-L955): `continue` (default `true`), `stopReason`, `suppressOutput` ("Has no effect"), `systemMessage` ("Warning message shown to the user"), `terminalSequence`. `hookSpecificOutput` "requires a `hookEventName` field set to the event name" (L947).

**Async hooks** (hooks.md L3661-L3699): `"async": true` is command-hook only; async hooks cannot block or control; timeout not enforced once running; results (`additionalContext`, `systemMessage`) delivered on the next conversation turn and "neither field is shown to you" (L3699); in `-p` mode still-running async hooks are killed at teardown (L3692).

## SessionStart

**When it fires** (hooks.md L1122): "Runs when Claude Code starts a new session or resumes an existing session." Supported types (L1124): "Only `type: "command"` and `type: "mcp_tool"` hooks are supported."

**Matcher values** (hooks.md L1128-L1136), table copied verbatim:

| Matcher   | When it fires |
| :-------- | :------------ |
| `startup` | New session |
| `resume`  | `--resume`, `--continue`, or `/resume` |
| `clear`   | `/clear` |
| `compact` | Auto or manual compaction |
| `fork`    | A new session forked from an existing one: `--fork-session` with `--resume` or `--continue`, the `/fork` background copy, or `/branch` |

> Before v2.1.214, forked sessions reported source `"resume"`. (L1136)

**Background at launch and what waits** (hooks.md L1138-L1144), verbatim:

> When you start an interactive session, resume a conversation at launch with `--continue` or `--resume`, or run `/clear`, SessionStart hooks run in the background. You can type right away, and a conversation you resumed appears without waiting for the hooks. Claude's first response still waits for the hooks to finish, so their context reaches Claude.

> When you switch conversations with `/resume` inside a session, the switch waits for the hooks to finish instead. If you run `/clear` or switch to another conversation while background hooks are still running, nothing they return applies to the session.

> The same wait applies at launch, including a resumed session: a prompt you send while SessionStart hooks are still running doesn't reach Claude until they finish.

> During either wait, press `Esc` to take the prompt back into the input without sending it. The hooks keep running.

**mcp_tool hooks on SessionStart** (hooks.md L580-L584): at launch (including `--continue`/`--resume`) SessionStart fires before MCP servers are available, so `mcp_tool` hooks are skipped and the debug log records `mcp_tool hooks are not available for the 'SessionStart' hook event (no MCP client context)`; after `/clear` or compaction they run. "A `type: "command"` hook on `SessionStart` runs at launch, so use one for anything the session needs from its first turn." (L606)

**Input** (hooks.md L1148-L1155): `source`, optional `model` ("It can be omitted, for example after `/clear` or when a session is restored through conversation recovery, so check for the field before reading it", L1153; L770: "Only `SessionStart` hooks can receive a `model` field, and Claude Code doesn't always include it"), `agent_type` (with `claude --agent <name>`), `session_title` ("A hook that emits `sessionTitle` can check `session_title` first to avoid overwriting a title the user set explicitly", L1155). On `resume`/`fork` with at least one Claude response, four extra fields, "These fields require Claude Code v2.1.251 or later." (L1157): `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` (L1161-L1164). Example verbatim (L1168-L1181):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionStart",
  "source": "resume",
  "model": "claude-opus-5",
  "seconds_since_last_response": 5400,
  "context_tokens": 182340,
  "prompt_cache_likely_expired": true,
  "estimated_cache_write_usd": 1.1396
}
```

Note: the example carries no `permission_mode`; the common-fields table says not all events receive it (L759).

**Decision control** (hooks.md L1185-L1193). "Claude Code adds stdout it [treats as plain text](#exit-code-0) to Claude's context." Event-specific fields, verbatim:

| Field | Description |
| :---- | :---------- |
| `additionalContext` | String added to Claude's context at the start of the conversation, before the first prompt. See [Add context for Claude](#add-context-for-claude) for how the text is delivered and what to put in it |
| `initialUserMessage` | String used as the first user message of the session. Applies in [non-interactive mode](/docs/en/headless) with the `-p` flag, where it becomes the first turn even if no prompt is provided. If a prompt is provided, it follows as the next turn. Unlike `additionalContext`, which attaches to an existing turn, this creates the turn |
| `sessionTitle` | Sets the session title, with the same effect as `/rename`. Use to name sessions automatically from the launch folder, git branch, or worktree name. Applies when `source` is `"startup"`, `"resume"`, or `"fork"`; ignored on `"clear"` and `"compact"` |
| `watchPaths` | Array of absolute paths to watch for [FileChanged](#filechanged) events during this session |
| `reloadSkills` | Boolean. When `true`, Claude Code re-scans the [skill](/docs/en/skills) and command directories after the SessionStart hooks complete, so skills the hook installed are available in the same session, starting with the first prompt |

Example verbatim (L1195-L1203):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth-refactor\nUncommitted changes: src/auth.ts, src/login.tsx\nActive issue: #4211 Migrate to OAuth2",
    "sessionTitle": "auth-refactor"
  }
}
```

> Since plain stdout already reaches Claude for this event, a hook that only loads context can print to stdout directly without building JSON. Use the JSON form when you need to combine context with other fields such as `sessionTitle`. (L1205)

`-p` prompt requirement (L1274): "When you start or continue a conversation with `-p`, you also need to supply a prompt, as an argument or piped on stdin. You can skip the prompt when a `SessionStart` hook supplies `initialUserMessage` or when you resume a session with a deferred tool call."

`reloadSkills` rationale (L1207): "Skill discovery normally runs before SessionStart hooks finish, so files the hook writes into `~/.claude/skills/` or `.claude/skills/` would otherwise only appear in the next session." Stderr from a SessionStart hook that exits 0 is informational only (L1218).

**Exit 2** (hooks.md L899): SessionStart "Can block? No", "Shows stderr to user only". L916: rendered as a `<hook name> hook error` notice; "Claude doesn't see it, and the session or subagent proceeds."

**CLAUDE_ENV_FILE** (hooks.md L1222-L1224): "SessionStart hooks have access to the `CLAUDE_ENV_FILE` environment variable, which provides a file path where you can persist environment variables for subsequent Bash commands." Write `export` statements, append with `>>` to preserve other hooks' variables. Note at L1258: "`CLAUDE_ENV_FILE` is available for SessionStart, [Setup](#setup), [CwdChanged](#cwdchanged), and [FileChanged](#filechanged) hooks. Other hook types don't have access to this variable."

**Decision-control summary row** (hooks.md L1055): SessionStart is "Context only ... No blocking or decision control".

## Setup

**When it fires** (hooks.md L1263): "Fires only when you launch Claude Code with `--init-only`, or with `--init` or `--maintenance` in [non-interactive mode](/docs/en/headless) with the `-p` flag. It doesn't fire on normal startup." Matchers (L1267-L1270): `init` (`claude --init-only` or `claude -p --init`), `maintenance` (`claude -p --maintenance`). `--init-only` runs Setup hooks and SessionStart `startup` hooks then exits (L1272); prints nothing on success, use `claude --debug-file <path> --init-only` to confirm (L1276).

Plugin dependency guidance (hooks.md L1278), verbatim:

> Because Setup doesn't fire on every launch, a plugin that needs a dependency installed can't rely on Setup alone. The practical pattern is to check for the dependency on first use and install on miss, for example a hook or skill that tests for `${CLAUDE_PLUGIN_DATA}/node_modules` and runs `npm install` if absent. See the [persistent data directory](/docs/en/plugins-reference#persistent-data-directory) for where to store installed dependencies. If you distribute your plugin through a marketplace, you may not need this pattern: Claude Code [installs eligible Node.js package dependencies automatically](/docs/en/plugins-reference#node-js-package-dependencies) when it caches the plugin.

**Input** (L1282-L1292): common fields plus `trigger` = `"init"` or `"maintenance"`.

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Setup",
  "trigger": "init"
}
```

**Decision control** (L1296-L1298): cannot block; all JSON output fields discarded on every exit code; with `-p`, stdout/stderr/exit code appear only as `hook_response` events under `--output-format stream-json --verbose`. Has `CLAUDE_ENV_FILE`. "Only `type: "command"` hooks run on `Setup`. A `type: "mcp_tool"` hook on `Setup` is always skipped". Exit 2 (L900): "Exit code and stderr are ignored".

## InstructionsLoaded

**When it fires** (hooks.md L1302): when a `CLAUDE.md` or `.claude/rules/*.md` file is loaded, at session start and on lazy loads; "The hook doesn't support blocking or decision control. It runs asynchronously for observability purposes." Matcher runs against `load_reason` (L1304), e.g. `"session_start"` or `"path_glob_match|nested_traversal"`.

**Input** (L1312-L1317): `file_path` (absolute), `memory_type` (`"User"`, `"Project"`, `"Local"`, `"Managed"`), `load_reason` (`"session_start"`, `"nested_traversal"`, `"path_glob_match"`, `"include"`, `"compact"`), `globs`, `trigger_file_path`, `parent_file_path`. The example at L1319-L1329 shows `file_path: "/Users/my-project/CLAUDE.md"`, `memory_type: "Project"`, `load_reason: "session_start"` plus common fields.

**Decision control** (L1333): none; JSON fields such as `systemMessage` and `continue` discarded. Exit 2 (L913): "Exit code is ignored".

## UserPromptSubmit

**When it fires** (hooks.md L1337-L1339): "Runs when the user submits a prompt, before Claude processes it." Supported hook types: the docs state no restriction for this event; the timeout sentence (L1341) names `command`, `http`, and `mcp_tool`, L1345 covers Agent SDK callback hooks, and L1364 says "All JSON output fields are available." The decision table lists it under top-level `decision` (L1043). Matcher: none documented for this event (searched "matcher" within L1335-L1396; not found).

**Timeout** (hooks.md L1341-L1343), verbatim:

> `UserPromptSubmit` hooks have a default timeout of 30 seconds for `command`, `http`, and `mcp_tool` types, shorter than the 600-second default for those types on most other events. Because this hook runs before every prompt and blocks model processing until it completes, a stuck hook stalls the session. If your hook needs more time, set the `timeout` field in the hook entry.

> Apart from a command hook you run with [`async: true`](#run-hooks-in-the-background), a `UserPromptSubmit` command, HTTP, or MCP tool hook that reaches its timeout is canceled and its output, including any `additionalContext`, is discarded. The prompt still reaches Claude without that context. The transcript shows a notice naming the hook, the timeout that fired, and that the output was discarded.

Agent SDK callback hooks differ: a timeout there blocks the prompt; "Before v2.1.208, a callback timeout on that event ended the turn with an execution error." (L1345)

**Input** (L1349): common fields plus `prompt`. Example verbatim (L1351-L1360):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

**Two context channels** (L1366-L1371), verbatim:

> * **Plain text stdout**: Claude Code adds stdout it [treats as plain text](#exit-code-0) to Claude's context
> * **JSON with `additionalContext`**: use the JSON format below for more control. The `additionalContext` field is added as context

> Neither channel produces a visible transcript entry. Plain stdout and the `additionalContext` value are each injected as a system reminder that starts with the hook's name; Claude reads both. To confirm delivery, check the [debug log](#debug-hooks).

**Decision fields** (L1375-L1381), verbatim:

| Field | Description |
| :---- | :---------- |
| `decision` | `"block"` prevents the prompt from being processed and erases it from context. Omit to allow the prompt to proceed |
| `reason` | Shown to the user when `decision` is `"block"`. Not added to context |
| `additionalContext` | String added to Claude's context alongside the submitted prompt. See [Add context for Claude](#add-context-for-claude) |
| `sessionTitle` | Sets the session title. Use to name sessions automatically based on the prompt content |
| `suppressOriginalPrompt` | If `true` when `decision` is `"block"`, omits the original prompt text from the block message shown to the user |

"A hook that blocks by exiting 2 routes the same way as `reason`: the block message shows the stderr text to the user, and it isn't added to context." (L1383). Exit 2 per-event table (L884): "Blocks prompt processing and erases the prompt". Cannot rewrite the prompt (L1063): "`UserPromptSubmit`: can't replace the prompt; it only injects `additionalContext` alongside it". Example (L1385-L1395):

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here",
    "sessionTitle": "My session title"
  }
}
```

## UserPromptExpansion

**When it fires** (hooks.md L1399-L1403): "Runs when a user-typed command expands into a prompt before reaching Claude." Use cases: block commands from direct invocation, inject context for a skill, log invocations. "This event covers the path `PreToolUse` doesn't: a `PreToolUse` hook matching the `Skill` tool fires only when Claude calls the tool, but typing `/skillname` directly bypasses `PreToolUse`. `UserPromptExpansion` fires on that direct path." (L1401). "Matches on `command_name`. Leave the matcher empty to fire on every prompt-type command." (L1403)

**Input** (L1407): `expansion_type` (`slash_command` for skill and custom commands, `mcp_prompt` for MCP server prompts), `command_name`, `command_args`, `command_source`, `prompt`. Example verbatim (L1409-L1422):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../00893aaf.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptExpansion",
  "expansion_type": "slash_command",
  "command_name": "example-skill",
  "command_args": "arg1 arg2",
  "command_source": "plugin",
  "prompt": "/example-skill arg1 arg2"
}
```

Note the example: a plugin command reports `command_source: "plugin"` and `command_name: "example-skill"` without a plugin prefix; the docs do not state whether `command_name` for a namespaced invocation such as `/synchrobuilder:audit` carries the `plugin:` prefix (searched "command_name", "namespace" in range; not stated).

**Decision control** (L1428-L1432), verbatim:

| Field | Description |
| :---- | :---------- |
| `decision` | `"block"` prevents the command from expanding. Omit to allow it to proceed |
| `reason` | Shown to the user when `decision` is `"block"` |
| `additionalContext` | String added to Claude's context alongside the expanded prompt. See [Add context for Claude](#add-context-for-claude) |

Exit 2 "routes the same way as `reason`" (L1434); per-event table (L885): "Blocks the expansion". Plain stdout is added as context (L810). Example (L1436-L1445):

```json
{
  "decision": "block",
  "reason": "This slash command is not available",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptExpansion",
    "additionalContext": "Additional context for this expansion"
  }
}
```

**Alias feasibility:** the documented fields are block and additionalContext only. There is no documented field to rewrite the expanded prompt or redirect one command to another (searched "updatedPrompt", "rewrite", "replace" within L1397-L1445; not found). So the docs give this event no way to implement `/sb:audit` as an alias of `/synchrobuilder:audit`; the documented outcomes are add context or block only.

## MessageDisplay

**When it fires** (hooks.md L1449): "Runs while an assistant message streams to the screen." Runs once per batch of newly completed lines; hook's replacement text is rendered in their place. Default timeout 10 seconds; on failure or timeout the original text is displayed (L1457). Display-only (L1459), verbatim:

> MessageDisplay is display-only: the replacement text changes only what is rendered on screen. The transcript and what Claude sees keep the original text, so Claude never sees the replacement, and verbose mode shows the original. The hook receives assistant message text only, so tool results and the text you type render unchanged.

No matchers; fires for every assistant message that streams text (L1461). In `claude -p` and SDK runs it fires once per message with `index` 0, `final` true, `delta` = whole message (L1463).

**Input** (L1471-L1475): `turn_id`, `message_id` (not the API `msg_…` id), `index`, `final`, `delta`. L1475: `delta` is "Always whole lines, except the final batch which may end mid-line. In interactive runs, the final batch's delta is empty when the message ends on a newline, so treat `final`, not a non-empty delta, as the end-of-message signal." Example (L1477-L1489):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "MessageDisplay",
  "turn_id": "0c9e6a2f-7d41-4f4e-9a15-3f4f7c2b8d10",
  "message_id": "5b2a9c8e-1f63-4d8a-b7c4-9e0d2a6f1c3b",
  "index": 0,
  "final": false,
  "delta": "Here is the plan:\n"
}
```

**Output** (L1495-L1499): `displayContent` "Text displayed in place of the delta. Omit it to display the original". "MessageDisplay hooks have no decision control. They can't block the message or change what is stored in the transcript or sent to Claude. Claude Code acts on `displayContent` from their JSON output and discards `systemMessage` and `continue`." Exit 2 (L914): "The original text is displayed". Script failure noted only in debug output (L1577).

**Teammate-message feasibility:** a MessageDisplay hook could append teammate text to the on-screen rendering of an assistant message (it replaces `delta`), but it only fires while Claude is streaming text, Claude never sees the replacement, and it holds every batch until the hook returns (L1449, L1457, L1459). It is not a general notification channel.

## PreToolUse

**When it fires** (hooks.md L1581): "Runs after Claude creates tool parameters and before processing the tool call. Matches on any tool name except `EndConversation`: built-in tools such as `Bash`, `PowerShell`, `Edit`, `Write`, `Read`, `Glob`, `Grep`, `Agent`, `Workflow`, `WebFetch`, `WebSearch`, `AskUserQuestion`, and `ExitPlanMode`, and any [MCP tool names](#match-mcp-tools)." `@`-referenced files fire no PreToolUse (L1586). Agent SDK callback timeout blocks the call; command-hook timeout does not (L1593, L873). L1583: "To run a hook when a specific file changes on disk, whatever wrote it, use FileChanged instead of matching file-editing tools by name. Unlike PreToolUse, Claude Code runs FileChanged hooks after the change, and they have no decision control, so they can't block the write."

**Matcher semantics** (L291-L295): `"*"`, `""`, or omitted matches all; plain names separated by `|` or `,` are exact matches; anything else is an unanchored JS regex. "`Edit.*` matches both `Edit` and `NotebookEdit`; wrap the pattern in `^` and `$`, as in `^Edit$`, when you need a whole-string match." (L295). Comma separators need v2.1.191+ (L297); hyphens in the exact-match set need v2.1.195+ (L299). The `if` field takes one permission rule such as `"Edit(*.ts)"` and is only evaluated on tool events (L429).

**Input** (L1597): common fields plus `tool_name`, `tool_input`, `tool_use_id`. For MCP tools also `mcp_server` `{name, source}`; `source` values "include `plugin`, `sdk`, and configuration scopes such as `user` and `project`"; "Base trust decisions on `source` rather than on `name` or the `mcp__<server>__` tool-name prefix. The `mcp_server` field requires Claude Code v2.1.274 or later." (L1599). Full example at L778-L795 (Bash, with `permission_mode`, `prompt_id`, `scratchpad_dir`).

**file_path is absolute; Windows backslashes** (L1601-L1606), verbatim:

> For the file tools `Write`, `Edit`, and `Read`, `tool_input.file_path` is always absolute:
>
> * Claude Code expands `~` and relative paths before hooks run, so a hook that matches on paths can't be bypassed via `~` or a relative spelling of the same path
> * On Windows, the path arrives with backslash separators, even when your hook runs under Git Bash where `$PWD` looks like `/c/project`
> * A comparison written with forward slashes, such as a `/src/` check, never matches a backslash path, and the tool call proceeds as if the hook had nothing to block
> * Normalize separators before comparing: `FILE_PATH="${FILE_PATH//\\//}"` in Bash, or `file_path.replace("\\", "/")` in Python, then match a path segment such as `/src/` rather than anchoring with `^`, since the path is absolute

Windows Write example (L1610-L1620):

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

### tool_input schemas

**Bash** (L1630-L1635): `command` string, `description` string (optional), `timeout` number ms (optional; values above the maximum are reduced), `run_in_background` boolean. Bash edit-diff recording (`tool_response.bashEditDiff` on PostToolUse) requires v2.1.269+, is best-effort public beta (L1637-L1654).

**PowerShell** (L1664-L1669): same fields as Bash (`command`, `description`, `timeout`, `run_in_background`). L1671-L1675, verbatim:

> Match `Bash|PowerShell` in hooks that inspect shell commands, so they cover both tools:
>
> * On Windows, wherever the PowerShell tool is enabled, Claude treats PowerShell as the primary shell and routes shell commands through it.
> * On Windows without Git Bash, the tool is enabled automatically and Claude Code doesn't register the Bash tool at all.
> * A hook that matches only `Bash` never fires there.

**Write** (L1681-L1684):

| Field | Type | Example | Description |
| :---- | :--- | :------ | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | Absolute path to the file to write |
| `content` | string | `"file content"` | Content to write to the file |

**Edit** (L1690-L1695):

| Field | Type | Example | Description |
| :---- | :--- | :------ | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | Absolute path to the file to edit |
| `old_string` | string | `"original text"` | Text to find and replace |
| `new_string` | string | `"replacement text"` | Replacement text |
| `replace_all` | boolean | `false` | Whether to replace all occurrences |

**Read** (L1701-L1705): `file_path` string (absolute), `offset` number (optional), `limit` number (optional).

**Glob** (L1711-L1714): `pattern`, `path`. **Grep** (L1720-L1727): `pattern`, `path`, `glob`, `output_mode`, `-i`, `multiline`. **WebFetch** (L1733-L1736): `url`, `prompt`. **WebSearch** (L1742-L1746): `query`, `allowed_domains`, `blocked_domains`.

**Agent** (L1752-L1757):

| Field | Type | Example | Description |
| :---- | :--- | :------ | :---------- |
| `prompt` | string | `"Find all API endpoints"` | The task for the agent to perform |
| `description` | string | `"Find API endpoints"` | Short description of the task |
| `subagent_type` | string | `"Explore"` | Type of specialized agent to use |
| `model` | string | `"sonnet"` | Optional model alias to override the default |

PostToolUse `tool_response` for Agent: `status` ("As of v2.1.198, subagents run in the background by default, so an omitted `run_in_background` also produces `"async_launched"`", L1763), `agentId`, `content`, `resolvedModel`, `modelsUsed` (v2.1.212+), `totalTokens`, `totalDurationMs`, `totalToolUseCount`, `usage` (L1761-L1771). SubagentHandback in auto mode, v2.1.271+ (L1773).

**AskUserQuestion** (L1785-L1788): `questions` array, `answers` object ("Claude doesn't set this field; supply it via `updatedInput` to answer programmatically"). **ExitPlanMode** (L1792-L1798): `plan`, `planFilePath` (both injected by Claude Code), `allowedPrompts` (deprecated; "Before v2.1.205, it carried prompt-based permissions").

**NotebookEdit**: no `tool_input` schema is documented in this range. The only mention in hooks.md is the matcher example at L295 (`Edit.*` also matches `NotebookEdit`). Searched "NotebookEdit" across the whole file: one hit.

**MultiEdit**: Not found in docs. `grep -n MultiEdit hooks.md` returns nothing; the PreToolUse tool list at L1581 does not include it.

### PreToolUse decision control

(L1804): decision is returned inside `hookSpecificOutput`, "four outcomes (allow, deny, ask, or defer) plus the ability to modify tool input before execution." Fields (L1806-L1811), verbatim:

| Field | Description |
| :---- | :---------- |
| `permissionDecision` | `"allow"` skips the permission prompt, except for the [actions no mode auto-approves](/docs/en/permission-modes#actions-no-mode-auto-approves) and for `AskUserQuestion` and `ExitPlanMode`, which need [`updatedInput` paired with it](#allow-with-updatedinput). `"deny"` prevents the tool call. `"ask"` prompts the user to confirm. `"defer"` exits gracefully so the tool can be resumed later. [Deny and ask rules](/docs/en/permissions#manage-permissions) are still evaluated regardless of what the hook returns |
| `permissionDecisionReason` | For `"allow"` and `"ask"`, shown to the user but not Claude. For `"deny"`, shown to Claude. For `"defer"`, ignored |
| `updatedInput` | Modifies the tool's input parameters before execution. Replaces the entire input object, so include unchanged fields alongside modified ones. Claude Code evaluates permission rules and a Bash command's [auto-background eligibility](/docs/en/tools-reference#background-commands) against the input your hook returns, not the input Claude sent. Combine with `"allow"` to auto-approve, or `"ask"` to show the modified input to the user. For `"defer"`, ignored |
| `additionalContext` | String added to Claude's context alongside the tool result. Ignored when `permissionDecision` is `"defer"`. See [Add context for Claude](#add-context-for-claude) |

> When multiple PreToolUse hooks return different decisions, precedence is `deny` > `defer` > `ask` > `allow`. (L1813)

> A hook that blocks by exiting 2 routes the same way as `"deny"`: Claude sees the stderr message as the denial reason. (L1815)

> When a hook returns `"ask"`, the permission prompt displayed to the user includes a label identifying where the hook came from: `[settings]` for a hook from any settings file or from agent frontmatter, `[plugin:<name>]` for a plugin's hook, or `[skill]` for a hook from skill frontmatter. This helps users understand which configuration source is requesting confirmation. (L1817)

> A hook's `"ask"` also forces a permission prompt in [auto mode](/docs/en/permission-modes#eliminate-prompts-with-auto-mode): the classifier can still deny the tool call, but it can't approve the call silently. Before v2.1.211, the classifier could approve a Bash command running outside the [sandbox](/docs/en/sandboxing) without showing the prompt the hook requested; the classifier still applied its own safety rules to that command, and a hook `"deny"` was always honored. (L1819)

Example (L1821-L1833):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": {
      "field_to_modify": "new value"
    },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

Headless (`-p`) (L1837): `AskUserQuestion` and `ExitPlanMode` are offered only when the run has a permission host ("such as an Agent SDK `canUseTool` callback", L1837, or "an MCP tool you pass with `--permission-prompt-tool`", L1849); `"allow"` + `updatedInput` satisfies the interaction requirement; `"allow"` alone is not sufficient for those two tools. "As of v2.1.199, an MCP tool whose server marks it with `_meta["anthropic/requiresUserInteraction"]` is stricter: a hook can't skip its approval prompt with `"allow"`" (L1839). Deprecated top-level `decision`/`reason` with `"approve"`/`"block"` map to allow/deny (L1842). Plain stdout on PreToolUse goes to the debug log only (L810). Exit 2 per-event (L882): "Blocks the tool call".

### Defer

(L1847): "`"defer"` is for integrations that run `claude -p` as a subprocess and read its JSON output ... Claude Code honors this value only in [non-interactive mode](/docs/en/headless) with the `-p` flag. In interactive sessions it logs a warning and ignores the hook result." Process exits with `stop_reason: "tool_deferred"` and `deferred_tool_use` `{id, name, input}` (L1852-L1857); resume with `claude -p --resume <session-id>` re-fires PreToolUse (L1854). No timeout or retry limit; session kept subject to `cleanupPeriodDays` 30-day default (L1873). Only works for a single tool call in the turn (L1875). `tool_deferred_unavailable` if the tool is gone on resume (L1877). Plan-mode resume needs `--permission-prompt-tool`, v2.1.246+ (L1880); `-p` resume does not restore stored permission mode (L1882).

## PermissionRequest

**When it fires** (L1887): "Runs when Claude Code is about to ask you for permission to use a tool. In sessions that can't show a prompt, such as background subagents in [non-interactive mode](/docs/en/headless), Claude Code still runs these hooks, and if no hook returns a decision, it denies the tool call." It fires the moment permission is asked; the `Notification` `permission_prompt` type fires "only after the prompt has waited about six seconds" (L1890). Not run for a sandboxed command's network request (L1892). "Matches on tool name, same values as PreToolUse." (L1894). "PreToolUse hooks run before every tool call, whether or not it needs permission. PermissionRequest hooks run only when Claude Code is about to ask you for permission, or when it would otherwise auto-deny a call that can't prompt." (L1902)

**Input** (L1898): `tool_name`, `tool_input` (no `tool_use_id`), `mcp_server` for MCP tools, optional `permission_suggestions` array of permission update entries. The array "isn't an exact list of the options you see" (L1900). Example (L1904-L1925):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules",
    "description": "Remove node_modules directory"
  },
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

**Decision control** (L1931-L1937), `decision` object fields, verbatim:

| Field | Description |
| :---- | :---------- |
| `behavior` | `"allow"` grants the permission, `"deny"` denies it. [Deny and ask rules](/docs/en/permissions#manage-permissions) are still evaluated, so a hook returning `"allow"` doesn't override a matching deny rule |
| `updatedInput` | For `"allow"` only: modifies the tool's input parameters before execution. Replaces the entire input object, so include unchanged fields alongside modified ones. The modified input is re-evaluated against deny and ask rules |
| `updatedPermissions` | For `"allow"` only: array of [permission update entries](#permission-update-entries) to apply, such as adding an allow rule or changing the session permission mode |
| `message` | For `"deny"` only: tells Claude why the permission was denied |
| `interrupt` | For `"deny"` only: if `true`, stops Claude |

> A hook that exits 2 without a `decision` object leaves the permission flow unchanged, and its stderr is discarded. Only the `decision` object can grant or deny the request. (L1939)

Per-event exit 2 (L883): "Exit code 2 isn't honored for this event and the permission flow proceeds unchanged." The output example at L1941-L1953 is `{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow", "updatedInput": {"command": "npm run lint"}}}}` (identical to the Decision control tab at L1099-L1110). L1983: "A hook can echo one of the `permission_suggestions` it received as its own `updatedPermissions` output."

**Permission update entries** (L1959-L1966): `type` is `addRules`, `replaceRules`, `removeRules` (fields `rules`, `behavior`, `destination`), `setMode` (`mode`, `destination`; `manual` alias v2.1.200+), `addDirectories`, `removeDirectories`. `destination` (L1976-L1981): `session` (in-memory), `localSettings` (`.claude/settings.local.json`), `projectSettings` (`.claude/settings.json`), `userSettings` (`~/.claude/settings.json`). `setMode` to `bypassPermissions` is a no-op unless bypass was already available at launch, and it is never persisted as `defaultMode` (L1969-L1971).

## Implications for Synchrobuilder

1. **Session digest injection**: a `type: "command"` SessionStart hook is the right vehicle; plain stdout suffices, or JSON `additionalContext` when combined with `sessionTitle` (L1185-L1205). At launch it runs in the background, and Claude's first response waits for it (L1138), so a ~6 KB digest read from the local snapshot cache fits both the timing model and the 10,000-character cap (L941). Do not use `mcp_tool` on SessionStart: it is skipped at launch (L582). Match `startup|resume|fork` for the digest; `compact` and `clear` also fire SessionStart, so decide whether to re-inject there (L1128-L1134); `sessionTitle` is ignored on `clear`/`compact` (L1191).
2. **Presence heartbeat / notify on every prompt**: UserPromptSubmit receives `prompt` (L1349). Synchrobuilder must not send that text anywhere; the brief's privacy rule is compatible because the hook only needs to inject teammate messages via stdout or `additionalContext` (L1366-L1371). Neither channel produces a visible transcript entry (L1371), so the user will see teammate messages only if Claude relays them; a `systemMessage` field is "shown to the user" (L954) and could surface a short notice. Default timeout 30 s; on timeout the context is discarded and the prompt proceeds (L1343), which matches fail-open.
3. **Claims / collision warnings**: PreToolUse matcher `Write|Edit` (exact list, L292); consider `^(Write|Edit|NotebookEdit)$` if notebooks matter (L295). `tool_input.file_path` is absolute and uses backslashes on Windows, so the Node hook must normalize separators before comparing against claim paths (L1601-L1606). Use `permissionDecision: "ask"` with `permissionDecisionReason` (shown to the user, not Claude, L1809) for the "ask" mode; the prompt will be labeled `[plugin:synchrobuilder]` (L1817). For "warn" mode, return `additionalContext` (delivered next to the tool result, L1017, L1811), or `"allow"` plus `additionalContext`. Exit 2 or `"deny"` would block, which the brief's "advisory" stance rules out except as an opt-in. Precedence `deny > defer > ask > allow` (L1813) means another hook's deny wins. In auto mode, `"ask"` still forces a prompt (L1819).
4. **Guard hook after Write/Edit**: PostToolUse is outside this range (L1985+), but the tool-input schemas here (Write `file_path`/`content`, Edit `file_path`/`old_string`/`new_string`/`replace_all`, L1681-L1695) apply to PostToolUse input as well: L1998 says PostToolUse `tool_input` is "the arguments sent to the tool", its schema "depends on the tool", and "File-tool `tool_input` paths arrive in the same format as for PreToolUse: always absolute, with the platform's native separators, so backslashes on Windows"; the example at L2007-L2010 shows Write with `file_path`/`content`.
5. **50 ms budget**: the docs set no per-hook latency guidance beyond "keep these hooks fast" (L1124) and the 30 s UserPromptSubmit default (L1341); the 50 ms goal is Synchrobuilder's own constraint. A timed-out hook fails open on both events (L873, L1343).
6. **Headless/CI (`/synchrobuilder:ci`)**: the docs show SessionStart (L1190 `initialUserMessage`, L1274) and PreToolUse (L1837, L1847) firing under `-p`; whether UserPromptSubmit fires under `-p` is not stated anywhere in hooks.md (grep for `UserPromptSubmit` near `-p`/headless: no hit); `"defer"` is honored only in `-p` (L1847); PermissionRequest auto-denies when no hook decides in sessions that can't prompt (L1887). `initialUserMessage` exists for `-p` (L1190). Setup hooks fire only with `--init-only`/`--init`/`--maintenance` (L1263); do not rely on Setup for dependency install (L1278).
7. **Shorter command prefix**: UserPromptExpansion cannot rewrite or redirect a command; it can only block or add context (L1428-L1432). A `/sb:audit` alias cannot be built with hooks from this range. (Whether plugin manifests support a separate prefix is a plugins-reference question, not covered here.)
8. **Teammate message display**: MessageDisplay is display-only, fires only while Claude streams text, and blocks rendering until the hook returns (L1449-L1459); unsuitable as a notification channel. Terminal notifications would go through `terminalSequence` on hooks that run anyway (L955, L967-L981), but that field is ignored in `-p`/SDK (L981).
9. **Untrusted teammate text**: L1033 warns that text framed as system commands trips prompt-injection defenses; wrapping teammate text in a labeled data block, as the brief requires, aligns with the docs' guidance to write factual statements.
10. **Consent before changing a machine**: PermissionRequest `updatedPermissions` can write rules to `.claude/settings.local.json` etc. (L1935, L1976-L1981); Synchrobuilder should not return `updatedPermissions` without user consent.
11. **watchPaths**: SessionStart can register absolute paths for FileChanged events (L1192); this could let the local snapshot cache file trigger a FileChanged hook when the background sync loop updates it. FileChanged itself is outside this range.

## Conflicts with the brief

- Brief: "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)". Docs: UserPromptSubmit context reaches Claude only; "Neither channel produces a visible transcript entry" (hooks.md L1371). The teammate will see the message only if Claude repeats it or if the hook also returns `systemMessage` (L954). "Sooner" delivery is not available from any event in this range; MessageDisplay is display-only and streaming-bound (L1459).
- Brief: "Can a plugin expose a shorter prefix or aliases (e.g. /sb:audit)?" Docs: UserPromptExpansion has no rewrite/redirect field, only `decision: "block"`, `reason`, `additionalContext` (L1428-L1432). No hook alias mechanism exists in this range.
- Brief: "hooks before edits ... under 50 ms". Docs give no latency figure; a timed-out PreToolUse command hook "doesn't block the tool call" (L873), so a slow hook silently fails open rather than being enforced at 50 ms. Not a contradiction, but the budget is self-imposed.
- Brief: "collision warnings ... (warn or ask ...)" as advisory. Docs: `"ask"` forces a permission prompt even in auto mode (L1819) and is labeled `[plugin:synchrobuilder]` (L1817); `permissionDecisionReason` for `"ask"` is "shown to the user but not Claude" (L1809), so the ask path informs the human, not Claude. The warn path (`additionalContext`) informs Claude, not the human (L1000). Neither single field informs both; the design must pick or combine (`additionalContext` + `systemMessage`).
- Brief: hooks "read only a local snapshot cache" and are ".mjs invoked as node". Docs: SessionStart, Setup, CwdChanged, FileChanged expose `CLAUDE_ENV_FILE` (L1258) and docs examples are bash; nothing in this range forbids Node, but the Windows guidance at L1604 confirms a `Write` `file_path` like `C:\\project\\src\\index.ts` must be normalized in the Node script.
- Brief assumes a "MultiEdit" tool may need guarding: Not found in docs (no occurrence of `MultiEdit` in hooks.md; tool list at L1581).

## Open questions

1. Does `command_name` in UserPromptExpansion carry the plugin namespace (`synchrobuilder:audit`) or just `audit` for a marketplace plugin command? The example shows `command_name: "example-skill"` with `command_source: "plugin"` (L1417-L1419); needs a live test on v2.1.218.
2. Actual wall-clock cost of `node <path>` startup on macOS/Linux/Windows against the 50 ms target; the docs give no numbers.
3. Whether `systemMessage` from a UserPromptSubmit hook is rendered prominently enough to serve as the visible teammate-notification channel, and how it looks in `-p` (`SDKInformationalMessage`, L954).
4. Whether SessionStart plain stdout and JSON `additionalContext` differ in placement or labeling in practice on v2.1.218 (docs say both are system reminders starting with the hook's name, L1371 for UserPromptSubmit; SessionStart placement L1015).
5. Whether `watchPaths` (L1192) fires FileChanged reliably when a background sync process rewrites the snapshot cache atomically (rename) versus in place.
6. Behavior of `permissionDecision: "ask"` inside `-p` with no permission host: does it auto-deny via the PermissionRequest path (L1887)?
7. Whether `NotebookEdit` delivers a `file_path`-shaped `tool_input` compatible with the Write/Edit claim check; no schema is documented (L295 only).
8. Exact v2.1.218 behavior for items marked later than that version: `mcp_server` field (v2.1.274, L1599), resume cost fields (v2.1.251, L1157), JSON-parse-failure handling (v2.1.248, L820), bashEditDiff (v2.1.269, L1639), plan-mode defer resume (v2.1.246, L1880). These will be absent or differ on the local CLI.

## Not found in docs

- `MultiEdit` tool: no occurrence anywhere in hooks.md.
- `NotebookEdit` `tool_input` schema: not documented; only the matcher example at L295.
- A UserPromptSubmit or UserPromptExpansion field that rewrites/redirects the prompt or command (searched "updatedPrompt", "rewrite", "redirect", "alias"); L1063 confirms UserPromptSubmit "can't replace the prompt".
- Any per-hook latency recommendation in milliseconds (searched "ms", "millisecond", "latency" in the range; only tool `timeout` ms fields at L1634/L1668).
- A matcher for UserPromptSubmit (none documented in L1335-L1396).
- Whether UserPromptSubmit fires in `-p` (headless) runs: hooks.md never pairs that event with `-p`/headless (grep across the whole file: no hit).
- Whether `permission_mode` is present on SessionStart input (example at L1168-L1181 omits it; L759 says not all events receive it).
