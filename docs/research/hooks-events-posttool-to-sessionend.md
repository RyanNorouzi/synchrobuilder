# Hook events: PostToolUse through ElicitationResult (research note, key hooks-events-b)

## Source

- https://code.claude.com/docs/en/hooks — raw Markdown downloaded from code.claude.com/docs/en/hooks.md on 2026-09-18, read as `hooks.md`. Assigned range L1985-L3477; cross-references to other lines of the same file are cited where the checklist depends on them.
- Highest version marker inside hooks.md is v2.1.274 (fact-check grep, 2026-09-18); `npm view @anthropic-ai/claude-code version` returned 2.1.276 the same day, so the doc may lag npm by a release or two. The local CLI used for experiments is v2.1.218 (`claude --version`).

Citation form: (hooks.md Lnnn). Every event below gets: when it fires, matcher, hook types, input JSON, decision control, plain stdout, exit 2, version markers. Input JSON is copied verbatim for the events Synchrobuilder is likely to use; for the rest the event-specific fields are listed with the line span of the verbatim example, to stay under the 500-line cap.

## Cross-cutting rules that apply to every event in this range

- Matcher summary table (hooks.md L307-L327): tool-name matcher for `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` (L309); `SessionEnd` matches `clear`, `resume`, `logout`, `prompt_input_exit`, `other` (L312); `Notification` matches notification type (L313); `PreCompact`/`PostCompact` match `manual`, `auto` (L315); `ConfigChange` (L318); `CwdChanged` "no matcher support" (L319); `DirectoryAdded` (L320); `FileChanged` "literal filenames to watch" (L321); `StopFailure` error type (L322); and "`UserPromptSubmit`, `PostToolBatch`, `Stop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `WorktreeCreate`, `WorktreeRemove`, `MessageDisplay` | no matcher support | always fires on every occurrence" (L327).
- > `FileChanged` and `StopFailure` use a narrower exact-match set of letters, digits, `_`, and `|` only. (hooks.md L301)
- Hook types. Events supporting all five types (`command`, `http`, `mcp_tool`, `prompt`, `agent`): PermissionDenied, PermissionRequest, PostToolBatch, PostToolUse, PostToolUseFailure, PreToolUse, Stop, SubagentStop, TaskCompleted, TaskCreated, TeammateIdle, UserPromptExpansion, UserPromptSubmit (hooks.md L3482-L3496). Events supporting only `command`, `http`, `mcp_tool`: ConfigChange, CwdChanged, DirectoryAdded, Elicitation, ElicitationResult, FileChanged, InstructionsLoaded, MessageDisplay, Notification, PostCompact, PostModelSwitch, PreCompact, PreModelSwitch, SessionEnd, StopFailure, SubagentStart, WorktreeCreate, WorktreeRemove (L3498-L3518).
- Plain stdout on exit 0: > For most events, Claude Code writes stdout to the debug log and doesn't show it in the transcript. The exceptions are `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch`, where Claude Code adds plain-text stdout as context that Claude can see and act on. (hooks.md L810). Stdout starting with `{` and ending with `}` is parsed as JSON (L814-L816); a parse failure on a standard-decision event is a non-blocking error and "Before v2.1.248, Claude Code treated that stdout as plain text" (L820). > Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it. (L822)
- Exit 2: > Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print JSON (hooks.md L825). Exit 2 plus invalid JSON still blocks; "Before v2.1.214, Claude Code treated that combination as a non-blocking error" (L829). Other non-zero codes are non-blocking for most events; "If your hook is meant to enforce a policy, use `exit 2`" (L863-L865). A hook that cannot start (e.g. exit 127) is the same non-blocking bucket (L861).
- Per-event exit-2 table (hooks.md L880-L914), rows for this range, verbatim column 3: Stop "Prevents Claude from stopping, continues the conversation" (L886); SubagentStop "Prevents the subagent from stopping" (L887); TeammateIdle "Prevents the teammate from going idle, so it continues working" (L888); TaskCreated "Rolls back the task creation" (L889); TaskCompleted "Prevents the task from being marked as completed" (L890); ConfigChange "Blocks the configuration change from taking effect (except `policy_settings`)" (L891); StopFailure "Output and exit code are ignored, except `terminalSequence`" (L892); PostToolUse "Shows stderr to Claude; the tool already ran" (L893); PostToolUseFailure "Shows stderr to Claude; the tool already failed" (L894); PostToolBatch "Stops the agentic loop before the next model call" (L895); PermissionDenied "Exit code and stderr are ignored because the denial already occurred" (L896); Notification "Exit code and stderr are ignored" (L897); SubagentStart "Shows stderr to user only" (L898); SessionEnd "Shows stderr to user only" (L901); CwdChanged "Shows stderr to user only" (L902); DirectoryAdded "Stderr goes to the debug log; the directory is already added" (L903); FileChanged "Shows stderr to user only" (L904); PreCompact "Blocks compaction" (L905); PostCompact "Shows stderr to user only" (L906); PreModelSwitch "Blocks the model switch and shows stderr to the user" (L907); PostModelSwitch "Shows stderr to user only; the model already switched" (L908); Elicitation "Denies the elicitation" (L909); ElicitationResult "Blocks the response (action becomes decline)" (L910); WorktreeCreate "Any non-zero exit code causes worktree creation to fail" (L911); WorktreeRemove "Any non-zero exit code causes worktree removal to fail if the directory still exists afterward" (L912).
- Output size: > Hook output strings, including `additionalContext`, `systemMessage`, and plain stdout, are capped at 10,000 characters. Output that exceeds this limit is saved to a file and replaced with a preview and file path (hooks.md L941).
- Universal JSON fields `continue` (default `true`), `stopReason`, `suppressOutput` ("Has no effect"), `systemMessage`, `terminalSequence` (hooks.md L949-L955). `terminalSequence` is emitted "only in an interactive session, and only while its interface is on screen. In non-interactive mode with the `-p` flag and in the Agent SDK, it ignores the field." (L981)
- `additionalContext` delivery: > Claude Code wraps the string in a system reminder and inserts it into the conversation at the point where the hook fired. Claude reads the reminder on the next model request, but it doesn't appear as a chat message in the interface. (hooks.md L1000). Placement: "PreToolUse, PostToolUse, PostToolUseFailure, and PostToolBatch: next to the tool result" (L1017); "Stop and SubagentStop: at the end of the turn. The conversation continues so Claude can act on the feedback." (L1018). Multiple hooks: "Claude receives all of the values" (L1021). Phrase as factual statements, not system commands, or prompt-injection defenses may surface the text to the user (L1033). On `--continue`/`--resume`, saved text from mid-session events is replayed rather than re-run (L1035).
- Decision-control summary (hooks.md L1041-L1056): PostToolUse/PostToolUseFailure/PostToolBatch/Stop/SubagentStop/ConfigChange/PreCompact use top-level `decision`/`reason` (L1043); TeammateIdle/TaskCompleted "Exit code or `continue: false`" (L1044); TaskCreated "Exit code or top-level `decision`" (L1045); PermissionDenied `retry: true` (L1049); Elicitation/ElicitationResult `action`/`content` (L1052-L1053); "Setup, Notification, SessionEnd, PostCompact, InstructionsLoaded, StopFailure, CwdChanged, DirectoryAdded, FileChanged | None | No decision control" (L1056).
- Timeouts: defaults "600 for `command`, `http`, and `mcp_tool`; 30 for `prompt`; 60 for `agent`", lowered to 30 on UserPromptSubmit, PreModelSwitch, PostModelSwitch and 10 on MessageDisplay; "`SessionEnd` hooks share a 1.5-second budget; if your settings set a longer per-hook `timeout`, Claude Code raises the budget to match, up to 60 seconds" (hooks.md L430). A timed-out hook's output is discarded (L869).
- Common input fields include `session_id`, `prompt_id` (v2.1.196+), `transcript_path` ("may lag the in-memory conversation"), `cwd`, `scratchpad_dir` (v2.1.257+), `permission_mode` ("Not all events receive this field"), `effort`, `hook_event_name` (hooks.md L754-L761); `agent_id`/`agent_type` when inside a subagent (L767-L768).
- Lifecycle diagram alt text classifies "WorktreeCreate, WorktreeRemove, Notification, ConfigChange, InstructionsLoaded, CwdChanged, FileChanged, and DirectoryAdded as standalone async events" and "PostModelSwitch as a standalone async event" (hooks.md L27).

## PostToolUse (hooks.md L1985-L2090)

- Fires: > Runs immediately after a tool completes successfully. (L1987) > Matches on tool name, same values as PreToolUse. (L1989). Omit matcher or use `"*"` to run after any tool (L1993).
- > Claude Code doesn't run a `PostToolUse` hook matching `Edit|Write` when a `Bash` command or a process outside Claude Code rewrites the same file. (L1994) Use FileChanged for that (L1994). Separately, when Bash edits files in a git repo, "Your PostToolUse hook then receives the changed files in `tool_response.bashEditDiff`... Requires Claude Code v2.1.269 or later" (L1639), and, unless `bashEditDiffEnabled` turns recording on for every mode, recording happens "only in auto mode and `bypassPermissions` mode, and only when Claude Code directs Claude to edit files through Bash"; background and read-only commands carry no diff (L1637).
- Input: > File-tool `tool_input` paths arrive in the same format as for PreToolUse: always absolute, with the platform's native separators, so backslashes on Windows. (L1998). Verbatim example (L2000-L2018):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "type": "create"
  },
  "tool_use_id": "toolu_01ABC123...",
  "duration_ms": 12
}
```

- `duration_ms`: "Optional. Tool execution time in milliseconds. Excludes time spent in permission prompts and PreToolUse hooks" (L2023).
- tool_response shape for Write/Edit: the docs show only the Write example `{filePath, type: "create"}` (L2012-L2015) and restate "`PostToolUse` passes the tool's structured `Output` object, such as `{filePath: "...", type: "create"}` for `Write`" (L2189). Success is implied by the event firing at all ("after a tool completes successfully", L1987); failures go to PostToolUseFailure. Not found in docs: an Edit-specific `tool_response` example or the set of `type` values (searched `"type": "update"`, `structuredPatch`, `oldString`, `tool_response`). `tool_input.file_path` is the reliable "which file" field (L2008-L2011, L1998).
- Decision-control table, verbatim (L2029-L2036):

| Field                  | Description |
| :--------------------- | :---------- |
| `decision`             | `"block"` adds the `reason` next to the tool result. Claude still sees the original output; to replace it, use `updatedToolOutput` |
| `reason`               | Explanation shown to Claude when `decision` is `"block"` |
| `additionalContext`    | String added to Claude's context alongside the tool result. See Add context for Claude |
| `classifierContext`    | Short note about this call's result for the auto mode classifier rather than for Claude. ... Requires Claude Code v2.1.236 or later |
| `updatedToolOutput`    | Replaces the tool's output with the provided value before it is sent to Claude. The value must match the tool's output shape |
| `updatedMCPToolOutput` | Replaces the output for MCP tools only. Prefer `updatedToolOutput`, which works for all tools |

- Example output (L2040-L2052) uses `hookSpecificOutput.hookEventName: "PostToolUse"` with `additionalContext` and `updatedToolOutput`. Warning: `updatedToolOutput` "only changes what Claude sees. The tool has already run" (L2056); for built-in tools "a value that doesn't match the tool's output schema is ignored and the original output is used" (L2058).
- Same-turn delivery: synchronous PostToolUse `additionalContext` is inserted "next to the tool result" (L1017) and read "on the next model request" (L1000); the `decision: "block"` `reason` is likewise "next to the tool result" (L2031). So a synchronous guard hook reaches Claude before its next model call within the same turn. Exit 2 "Shows stderr to Claude; the tool already ran" (L893); L822 recommends exit 2 specifically "To surface a warning to Claude from a `PostToolUse` or `PostToolUseFailure` hook".
- `classifierContext` limits: 2,000-character cap shared across hooks for one call (L2083); "Synchronous responses only: Claude Code ignores the field in the response of a hook that runs in the background" (L2084); dropped for read-only calls (L2085).
- async / asyncRewake here: `async: true` is "only available on `type: "command"` hooks" (L3665); "Async hooks can't block or control Claude's behavior" (L3661); results "delivered on the next conversation turn. If the session is idle, the response waits until the next user interaction. Exception: an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle." (L3760). `asyncRewake`: "runs in the background and wakes Claude on exit code 2. The hook's stderr, or stdout if stderr is empty, is shown to Claude as a system reminder" (L461). `timeout` not enforced on async hooks but still enforced on `asyncRewake` (L3688). Async `additionalContext`/`systemMessage` are delivered to Claude on the next turn and "neither field is shown to you" (L3699). In `-p` mode async hooks still running at teardown are killed with outcome `cancelled` (L3692). "Before v2.1.202, malformed JSON output from an async hook could crash the session" (L3701). No dedup across firings (L3761).
- `continue: false` from PostToolUse: "the stop applies even when the tool call fails or completes while Claude is still streaming a response" (L963).

## PostToolUseFailure (hooks.md L2092-L2152)

- Fires: > Runs when a tool that started executing fails: the tool threw an error, or an MCP tool returned an error result. (L2094). Matcher: tool name (L2096). Not fired for validation rejections or permission denials (L2099).
- Input adds `error`, `is_interrupt`, `duration_ms` to `tool_name`/`tool_input`/`tool_use_id` (L2104, L2125-L2129). Verbatim example (L2106-L2122):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite"
  },
  "tool_use_id": "toolu_01ABC123...",
  "error": "Exit code 1\nError: Cannot find module 'express'",
  "is_interrupt": false,
  "duration_ms": 4187
}
```

- `is_interrupt`: "True when the failure reached Claude Code as an abort rather than as an error the tool reported. Cancelling a running tool does not fire this hook" (L2128). Treat `error` text as display text, not a stable format (L2131).
- Decision control: only `additionalContext` ("String added to Claude's context alongside the error", L2143); example L2145-L2152. Exit 2 shows stderr to Claude (L894).

## PostToolBatch (hooks.md L2154-L2209)

- > Runs once after every tool call in a batch has resolved, before Claude Code sends the next request to the model. `PostToolUse` fires once per tool, which means it fires concurrently when Claude makes parallel tool calls. `PostToolBatch` fires exactly once with the full batch ... There is no matcher for this event. (L2156)
- Input: `tool_calls` array; each entry has `tool_name`, `tool_input`, `tool_use_id`, `tool_response` (L2160-L2184). > The `tool_response` shape differs from `PostToolUse`'s. `PostToolUse` passes the tool's structured `Output` object, such as `{filePath: "...", type: "create"}` for `Write`; `PostToolBatch` passes the serialized `tool_result` content the model sees. (L2189). "Responses can be large, so parse only the fields you need." (L2186)
- Decision control: `additionalContext` "injected once before the next model call" (L2198); example L2200-L2207. > Returning `decision: "block"` or `continue: false` stops the agentic loop before the next model call. The blocking message comes from the JSON `reason` or `stopReason`, or from stderr on exit 2. (L2209)

## PermissionDenied (hooks.md L2211-L2257)

- > This hook only fires in auto mode: it doesn't run when you manually deny a permission dialog, when a `PreToolUse` hook blocks a call, or when a `deny` rule matches. (L2213). Matcher: tool name (L2215).
- Input: `tool_name`, `tool_input`, `tool_use_id`, `reason` (L2217); example L2221-L2236 (`permission_mode: "auto"`, `reason: "[Irreversible Local Destruction]"`). `reason` forms: rule name in brackets, or starts with `Auto mode could not evaluate this action and is blocking it for safety`, or fixed text `Classifier unavailable` (L2240).
- Decision control: `hookSpecificOutput.retry: true` tells the model it may retry; "Claude Code doesn't reverse the denial itself" (L2255); ignored for no-verdict denials (L2257). Exit code and stderr ignored (L896).

## Notification (hooks.md L2259-L2351)

- > Runs when Claude Code sends notifications. Matches on notification type. Omit the matcher to run hooks for all notification types. (L2261) > You receive these hook events even with desktop notifications turned off (L2263).
- Notification types, matcher column verbatim (L2267-L2278): `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled`. Key timings: `permission_prompt` "the prompt has waited about six seconds" (L2267); `idle_prompt` "Claude finished responding about 60 seconds ago and you haven't typed since" (L2268).
- Version markers: > The `agent_needs_input` and `agent_completed` types require Claude Code v2.1.198 or later. (L2280) > The `quota_auto_resume_fired`, `quota_auto_resume_stale`, and `quota_auto_resume_disabled` types require Claude Code v2.1.234 or later. (L2282) `permission_prompt` for sandboxed network requests requires v2.1.246 (L2284); `agent_needs_input` for teammate setup questions requires v2.1.248 (L2286); "Before v2.1.233, `permission_prompt` didn't fire in these sessions" (SDK `canUseTool` hosts) (L2304).
- Interactive-only timing: > The `permission_prompt`, `idle_prompt`, `elicitation_dialog`, and `elicitation_url_dialog` types share their timing with desktop notifications, so in terminal sessions you only see them when you appear to be away from the terminal (L2289). Env `CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS=1` turns `permission_prompt` off in SDK-hosted sessions (L2302).
- Input verbatim (L2339-L2349):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission",
  "title": "Permission needed",
  "notification_type": "permission_prompt"
}
```

- What a hook can do: > Notification hooks can't block or modify notifications. Claude Code discards their `systemMessage` and `continue` fields but still emits `terminalSequence` ... Notification hooks are intended for side effects such as forwarding the notification to an external service. (L2351). Exit code and stderr ignored (L897).

## SubagentStart (hooks.md L2353-L2389)

- Fires on Agent-tool spawn, subagent resume, and "each time an in-process agent team teammate handles a new message" (L2355). Matcher: agent type; for plugin subagents "the agent type is the plugin-scoped identifier such as `my-plugin:reviewer`" and the colon forces the regex path, so anchor `^my-plugin:reviewer$` (L2357).
- Input: `agent_id`, `agent_type` (L2361); example L2363-L2372. Output: `additionalContext` "added to the subagent's context at the start of its conversation" (L2378); cannot block (L2374); repeated runs re-inject only after auto-compaction discards the copy (L2389). Exit 2 shows stderr to user only, in the subagent's own transcript (L898, L916).

## SubagentStop (hooks.md L2391-L2420)

- Fires when a subagent finishes responding; matcher: agent type (L2393). Input: `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, plus `background_tasks` and `session_crons` "scoped to the parent session" (L2397, L2401). v2.1.271+: with `SubagentHandback`, `last_assistant_message` holds closing text, not the report; the report is `tool_input.message` on a PreToolUse/PostToolUse hook matched on `SubagentHandback` (L2399). Example L2403-L2418.
- Decision control: same as Stop, including `hookSpecificOutput.additionalContext` with `hookEventName: "SubagentStop"`; `decision: "block"` with `reason` keeps the subagent running; > To inject context into the parent session after a subagent returns, use a `PostToolUse` hook on the `Agent` tool instead. (L2420)

## TaskCreated (hooks.md L2422-L2474)

- > Runs when a task is being created via the `TaskCreate` tool. ... In a session without the Task tools, this event doesn't fire. (L2424) No matcher (L2426). Not stated as agent-teams-only: `teammate_name` "May be absent" (L2451).
- Input verbatim (L2432-L2444):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "TaskCreated",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "session-a1b2c3d4"
}
```

- `team_name`: "Deprecated. Session-derived team name; will be removed in a future release" (L2452). Decision control: exit 2 (stderr as message) or `{"decision": "block", "reason": "..."}`; "Claude Code deletes the task and returns your message to Claude as the tool's error. Claude Code ignores `continue: false` from this event" (L2456-L2459).

## TaskCompleted (hooks.md L2476-L2530)

- > This fires in two situations: when any agent explicitly marks a task as completed through the TaskUpdate tool, or when an agent team teammate finishes its turn with in-progress tasks. (L2478) No matcher (L2480). Input fields identical to TaskCreated plus `permission_mode` in the example (L2486-L2498); `teammate_name` "May be absent" (L2506).
- Decision control (L2513-L2514): exit 2 keeps the task open and feeds stderr to the model; `{"continue": false, "stopReason": "..."}` stops a teammate entirely when a teammate turn triggered the event, but "When the `TaskUpdate` tool triggered the event, Claude Code ignores `continue: false`; exit code 2 still blocks the completion."

## Stop (hooks.md L2532-L2632)

- > Runs when the main Claude Code agent has finished responding. Does not run if the stoppage occurred due to a user interrupt. API errors fire StopFailure instead. (L2534-L2536). No matcher (L327). `/goal` is a built-in session-scoped prompt-based Stop hook (L2539).
- Input: `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` (L2544). > The `stop_hook_active` field is `true` when Claude Code is already continuing as a result of a stop hook. Check this value or process the transcript to avoid blocking on a condition that will never resolve. Claude Code overrides the hook and ends the turn after 8 consecutive blocks. (L2544) > the transcript file isn't guaranteed to include the final message at Stop time on all versions. (L2546) `background_tasks`/`session_crons` "let hooks distinguish 'session is done' from 'session is paused waiting for background work'" (L2548); field tables L2552-L2571 (`type` labels `shell`, `subagent`, `monitor`, `workflow`, `teammate`, `cloud session`, `MCP task`, L2555).
- Input verbatim (L2575-L2602):

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring. Here's a summary...",
  "background_tasks": [
    {
      "id": "task-001",
      "type": "shell",
      "status": "running",
      "description": "tail logs",
      "command": "tail -f /var/log/syslog"
    }
  ],
  "session_crons": [
    {
      "id": "cron-001",
      "schedule": "0 9 * * 1-5",
      "recurring": true,
      "prompt": "check the build"
    }
  ]
}
```

- Decision-control table verbatim (L2608-L2612):

| Field                                  | Description |
| :------------------------------------- | :---------- |
| `decision`                             | `"block"` prevents Claude from stopping. Omit to allow Claude to stop |
| `reason`                               | Required when `decision` is `"block"`. Tells Claude why it should continue |
| `hookSpecificOutput.additionalContext` | Non-error feedback for Claude. The conversation continues so Claude can act on it, but unlike `decision: "block"` it is shown in the transcript as hook feedback rather than a hook error |

- > A hook that blocks by exiting 2 routes the same way as `reason`: Claude receives the stderr message as the explanation for why it should continue. (L2614) `additionalContext` "keeps the conversation going through the same loop protections as `decision: "block"`, namely the `stop_hook_active` input and the 8-consecutive-continuation cap, but the transcript labels it `Stop hook feedback`" (L2623). So Stop can add context, but only by continuing the turn; there is no documented way to add context for a *future* turn without continuing. Timing: "at the end of the turn" (L1018); cadence "per turn" (L22).

## StopFailure (hooks.md L2634-L2660)

- > Runs instead of Stop when the turn ends due to an API error. Claude Code ignores the hook's output and exit code, apart from `terminalSequence`. (L2636) Matcher: `error` type list `rate_limit`, `overloaded`, `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown` (L2644); `cloud_credential_error` matching requires v2.1.267 (L329). Input adds `error`, optional `error_details`, optional `last_assistant_message` (the rendered API error string) (L2640-L2646); example L2648-L2658. No decision control (L2660).

## TeammateIdle (hooks.md L2662-L2707)

- > Runs when an agent team teammate is about to go idle after finishing its turn. (L2664) Agent-teams-only by definition; no matcher (L2666). Input verbatim (L2672-L2682):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TeammateIdle",
  "teammate_name": "researcher",
  "team_name": "session-a1b2c3d4"
}
```

- Decision control: exit 2 → "the teammate receives the stderr message as feedback and continues working instead of going idle" (L2693); `{"continue": false, "stopReason": "..."}` "stops the teammate entirely" (L2694).

## ConfigChange (hooks.md L2709-L2778)

- Fires "when a settings file, a managed policy file, or a skill file changes" (L2713). Matchers `user_settings` (`~/.claude/settings.json`), `project_settings` (`.claude/settings.json`), `local_settings` (`.claude/settings.local.json`), `policy_settings`, `skills` (`.claude/skills/`) (L2719-L2723). Input: `source`, optional `file_path` (L2747); example L2749-L2758. Decision: `decision: "block"` or exit 2 prevents the change; `reason` "Accepted but never shown" (L2766-L2767); `policy_settings` can't be blocked (L2776); a blocked change "surfaces no message to you or to Claude" (L2778); `systemMessage` and `continue` discarded (L2778).

## CwdChanged (hooks.md L2780-L2813)

- > Runs when a shell command in the main conversation changes the working directory, for example when Claude executes a `cd` command. (L2782) Not agent-teams-only. Has `CLAUDE_ENV_FILE`; variables persist "until the next CwdChanged event, when Claude Code clears them" (L2784). No matcher (L2786). Input verbatim (L2792-L2800):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project/src",
  "hook_event_name": "CwdChanged",
  "old_cwd": "/Users/my-project",
  "new_cwd": "/Users/my-project/src"
}
```

- Output: `watchPaths` "Array of absolute paths. Replaces the current dynamic watch list. Paths from your `matcher` configuration are always watched. Returning an empty array clears the dynamic list" (L2809). No decision control (L2811). > Claude Code reads `watchPaths` and `systemMessage` from their JSON output and discards `continue`. In interactive sessions, it shows the `systemMessage` as a brief terminal notification. The message doesn't reach the SDK message stream. (L2813)

## DirectoryAdded (hooks.md L2815-L2859)

- Fires after `/add-dir` or the SDK `register_repo_root` control request (L2817); not for `--add-dir` at startup, the `/permissions` Workspace tab, or an already-covered directory (L2821-L2823). > Claude Code doesn't wait for the hook: the add completes immediately, and the hook runs in the background with the 600-second default timeout. (L2827) Matchers `slash_command`, `register_repo_root` (L2833-L2834). Input: `directory`, `source` (L2842-L2843); example L2845-L2854. No decision control; for `slash_command` the `systemMessage` is delivered "to Claude as context on the next conversation turn, rather than showing it to you" (L2858).

## FileChanged (hooks.md L2861-L2936)

- > Runs when a watched file changes on disk. Claude Code detects changes with a filesystem watcher, not by inspecting tool calls, so it runs the hook no matter what changed the file (L2863). Not agent-teams-only.
- Matcher dual role: > the value is split on `|` and each segment is registered as a literal filename in the working directory, so `".envrc|.env"` watches exactly those two files. Regex patterns are not useful here (L2867); the same value also filters hook groups against the changed file's basename (L2868). Dynamic watching: > Claude Code starts the watcher only when something names a file to watch, so seed the list with a FileChanged group whose matcher names at least one file, or with a SessionStart or CwdChanged hook that returns `watchPaths`. ... give the group that handles dynamic paths an omitted matcher ... A `"*"` matcher ... registers it in the watch list ... as a literal file named `*`. (L2902) A hook that rewrites the watched file re-fires itself; guard against loops (L2890). Has `CLAUDE_ENV_FILE` (L2904).
- Input: `file_path` (absolute), `event` = `"change"` | `"add"` | `"unlink"` (L2912-L2913). Verbatim (L2915-L2923):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "FileChanged",
  "file_path": "/Users/my-project/.envrc",
  "event": "change"
}
```

- Output: `watchPaths` "Replaces the current dynamic watch list. Paths from your `matcher` configuration are always watched" (L2932). No decision control (L2934); `systemMessage` shown as brief terminal notification in interactive sessions, `continue` discarded, not in SDK stream (L2936).

## WorktreeCreate / WorktreeRemove (hooks.md L2938-L3046)

- WorktreeCreate fires for `claude --worktree`, `isolation: "worktree"` subagents, and isolated background sessions; configuring it "replaces that default git behavior" (L2940) and `.worktreeinclude` is not processed (L2942). Input: `name` slug (L2971); example L2973-L2980. Output: command hooks print the path as the last non-empty stdout line; HTTP hooks return `hookSpecificOutput.worktreePath` (L2987-L2988); failure or no path fails creation (L2990); symlink/dot-segment screening "Before v2.1.216, worktree creation followed the hook's path without this screening" (L2994). `systemMessage`/`continue` discarded (L2946).
- WorktreeRemove fires on `--worktree` exit with removal chosen, worktree-subagent finish, or background-session delete (L3000-L3002). Input: `worktree_path` (L3031); example L3033-L3041. JSON output discarded (L3006); non-zero exit with directory still present fails the removal (L3043-L3046); pre-v2.1.216 ran without path checks (L3008).

## PreCompact (hooks.md L3048-L3078)

- > Runs before Claude Code is about to run a compact operation. (L3050) Matchers `manual` (`/compact`) and `auto` (L3056-L3057). > Exit with code 2 to block compaction. For a manual `/compact`, the stderr message is shown to the user. You can also block by returning JSON with `"decision": "block"`. (L3059) Blocking auto-compact that was recovering from a context-limit error makes the request fail (L3061). `systemMessage`/`continue` discarded (L3063). Input verbatim (L3069-L3078):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PreCompact",
  "trigger": "manual",
  "custom_instructions": null
}
```

## PostCompact (hooks.md L3080-L3106)

- Fires after compaction completes; `systemMessage`/`continue` discarded (L3082). Matchers `manual`, `auto` (L3088-L3089). Input: `trigger`, `compact_summary` (L3093); verbatim (L3095-L3104):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PostCompact",
  "trigger": "manual",
  "compact_summary": "Summary of the compacted conversation..."
}
```

- No decision control (L3106). SessionStart fires again after compaction: `source` is "`"compact"` after compaction" (L1152), and `sessionTitle` is "ignored on `"clear"` and `"compact"`" (L1191).

## PreModelSwitch / PostModelSwitch (hooks.md L3108-L3314)

- Both "require Claude Code v2.1.251 or later" (L3112, L3267). PreModelSwitch matcher compares against the canonical target model name (L3122); input fields `from_model`, `to_model`, `requested_model`, `source` (`"command"`/`"picker"`/`"sdk"`), `context_tokens`, `prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`, `pricing` (L3200-L3208); example L3212-L3228. Decision: exit 2 or `decision: "block"` cancels; `permissionDecision` `allow`/`deny`/`ask` (L3232-L3239); > Only `/model` in an interactive session can show the `"ask"` prompt. On every other surface, including non-interactive mode with the `-p` flag, `/config`, and `set_model` requests, Claude Code treats `"ask"` as a refusal. (L3241) A timed-out hook blocks the switch; default timeout 30 s; command/http/mcp_tool only (L3259).
- PostModelSwitch can't block (L3267); extra `source` values `"auto"` and `"resume"` (L3302). > Claude Code takes your hook's plain-text stdout on exit 0, or `additionalContext` from JSON output, and delivers it to Claude with the next request after the switch. (L3308) If not finished within five seconds after the next prompt, output attaches to the following request (L3314).

## SessionEnd (hooks.md L3316-L3359)

- > Runs when a Claude Code session ends. Useful for cleanup tasks, logging session statistics, or saving session state. Supports matchers to filter by exit reason. (L3318-L3319)
- Reason table verbatim (L3323-L3330):

| Reason                        | Description |
| :---------------------------- | :---------- |
| `clear`                       | Session cleared with `/clear` command |
| `resume`                      | Session switched via interactive `/resume` |
| `logout`                      | User logged out |
| `prompt_input_exit`           | User exited while prompt input was visible |
| `other`                       | Other exit reasons |
| `bypass_permissions_disabled` | Removed in v2.1.234; Claude Code doesn't send it. Drop it from your `SessionEnd` matchers |

- Input verbatim (L3336-L3344):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

- Output: > SessionEnd hooks have no decision control. They can't block session termination but can perform cleanup tasks. Claude Code discards their JSON output fields, such as `systemMessage`. (L3346) Exit 2 "Shows stderr to user only" (L901).
- Time budget, verbatim: > SessionEnd hooks have a default timeout of 1.5 seconds. It applies when you exit, run `/clear`, or switch sessions with interactive `/resume`. (L3348) Per-hook `timeout` raises the budget "up to 60 seconds. If you raise the budget this way, a hook without its own `timeout` still keeps the default. Timeouts set on plugin-provided hooks don't raise the budget." (L3350) `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` overrides the budget and "also becomes the timeout for each hook without its own `timeout`" (L3351); example `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000 claude` (L3356). > Before v2.1.268, `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` raised only the overall budget, and a hook without its own `timeout` was still canceled after 1.5 seconds. (L3359)
- Terminal kill: Not found in docs. Searched `kill`, `SIGHUP`, `SIGTERM`, `SIGINT`, `Ctrl+C`, `crash`, `terminal closes`; the only hit is L3692 (async hooks killed at `-p` teardown). Whether SessionEnd fires when the terminal window is closed or the process is killed is not stated.

## Elicitation / ElicitationResult (hooks.md L3361-L3476)

- Elicitation fires "when an MCP server requests user input mid-task" (L3363); matcher = MCP server name (L3365). Input: `mcp_server_name`, `message`, optional `mode`, `url`, `elicitation_id`, `requested_schema` (L3369); form example L3373-L3389, URL example L3393-L3404. Output `hookSpecificOutput.action` (`accept`/`decline`/`cancel`) and `content` (L3410-L3425); > Exit code 2 denies the elicitation. Claude Code doesn't show your stderr message anywhere. (L3427); `systemMessage`/`continue` discarded (L3429).
- ElicitationResult fires after the user responds, before the response returns to the server (L3433); matcher = MCP server name (L3435). Input: `mcp_server_name`, `action`, optional `mode`, `elicitation_id`, `content` (L3439); example L3441-L3453. Output overrides `action`/`content` (L3459-L3472); exit 2 "changing the effective action to `decline`" (L3474).

## Interactive-only / `-p` mode statements found

- `terminalSequence` ignored in `-p` and SDK (L981). Notification `permission_prompt`/`idle_prompt`/`elicitation_*` share desktop-notification timing "in terminal sessions" (L2289). CwdChanged/FileChanged `systemMessage` shown only "In interactive sessions" and "doesn't reach the SDK message stream" (L2813, L2936). PreModelSwitch `"ask"` only in interactive `/model` (L3241). SessionEnd `resume` reason is "interactive `/resume`" (L3326). Async hooks are killed at `-p` teardown (L3692). Workspace trust: interactive sessions hold back settings-file hooks until trust is accepted; `-p`/SDK sessions treat the folder as trusted (L3775-L3776). Not found in docs: any statement that Stop, SessionEnd, PostToolUse, PreCompact, PostCompact, TaskCreated/TaskCompleted, or TeammateIdle are unavailable in `-p` mode.

## Implications for Synchrobuilder

1. Guard hook (after Write/Edit): use a synchronous `PostToolUse` command hook with matcher `Edit|Write` (L292, L1989). Read `tool_input.file_path` (absolute, native separators, L1998). Report via `hookSpecificOutput.additionalContext` (delivered next to the tool result, read on the next model request: L1000, L1017) for advisory tone, or exit 2 with stderr for a louder warning (L893, L822). Do not use `async: true` for the guard: async output waits for the next turn (L3760), and `classifierContext` is dropped from background hooks (L2084). Because `Edit|Write` hooks do not fire for Bash rewrites (L1994), pair with `FileChanged` only for named files; `bashEditDiff` (v2.1.269+, L1639) is newer than the local CLI.
2. Handoff at session end: `SessionEnd` gives only `reason` and common fields, no output channel (L3346), and a 1.5 s default budget that plugin `timeout` values cannot raise (L3348-L3350). A handoff writer must finish in about 1.5 s or rely on `Stop` (which has `last_assistant_message`, L2546) to pre-stage the handoff on every turn, and treat SessionEnd as best-effort.
3. Notify landing "sooner if plugin monitors allow": `Stop` cannot inject context for a later turn without continuing the turn (L2612, L2623). An `asyncRewake` command hook exiting 2 "wakes Claude immediately even when the session is idle" (L3760, L461) is the only documented idle-wake path; it is advisory-hostile (it is framed as a failure signal) and needs an experiment.
4. Presence/idle: `Notification` `idle_prompt` fires ~60 s after Claude finishes and only in terminal sessions when the user appears away (L2268, L2289); it is a side-effect-only event (L2351), suitable for writing a local presence heartbeat but not for messaging Claude.
5. `PreCompact`/`PostCompact` are side-effect only; SessionStart re-fires with `source: "compact"` (L1152), so the digest injector must be idempotent and should treat `compact` as a re-inject opportunity.
6. Task board: `TaskCreated`/`TaskCompleted` fire for the `TaskCreate`/`TaskUpdate` tools in any session that has Task tools (L2424, L2478), not only agent teams; `TeammateIdle` is agent-teams-only (L2664). `team_name` is deprecated (L2452, L2507).
7. `FileChanged` can watch `.synchrobuilder/team.json` or the local snapshot cache by literal basename in the cwd (L2867); dynamic `watchPaths` from CwdChanged/SessionStart can point at absolute paths elsewhere (L2809, L2902).
8. All hooks: keep stdout to a single JSON object or empty (L939, L814); exit 0 on internal errors satisfies fail-open; stderr on exit 0 never reaches Claude (L822).

## Conflicts with the brief

- Brief: the guard "tells Claude in the same turn". Docs: synchronous PostToolUse `additionalContext` is read "on the next model request" (L1000) next to the tool result (L1017), which is within the same user turn; but an async hook's output is "delivered on the next conversation turn" (L3760). The brief's claim holds only for synchronous hooks.
- Brief: "handoff written at session end". Docs: SessionEnd default budget is 1.5 s and "Timeouts set on plugin-provided hooks don't raise the budget" (L3348-L3350); only the user's env var or settings-file timeouts raise it. A plugin cannot guarantee itself more than 1.5 s.
- Brief: "hooks before edits and on every prompt must be ... under 50 ms". Docs impose no such limit, but note UserPromptSubmit blocks model processing until it completes (L1341, outside range); no conflict, just stricter than docs.
- Brief: notify "landing in the teammate's next prompt (sooner if plugin monitors allow)". Docs provide no plugin "monitor" concept in this range; the only idle-wake mechanism is `asyncRewake` exit 2 (L3760).
- Brief: "NO bash/PowerShell ... anywhere in shipped code". Docs examples in this range are bash/jq scripts, but the `command` + `args` exec form spawns an executable "with no shell involved" (L459, L468-L470), so `node <path>` is supported; no conflict.

## Open questions

1. Does SessionEnd fire on terminal close / SIGHUP / SIGKILL, and with which `reason`? (Not found in docs.)
2. What is the exact `tool_response` for `Edit` (fields and `type` values) on v2.1.218? Docs only show the `Write` case (L2012-L2015).
3. Can a plugin-declared `asyncRewake` PostToolUse hook be used as an idle wake for notify without appearing to Claude as an error? What does the system reminder look like (L461)?
4. Plain-text stdout from a PostToolUse hook goes to the debug log on every version (L810). The v2.1.248 change (L820) concerns stdout that looks like JSON but fails to parse: on v2.1.218 it is "treated as plain text" (silently logged) instead of raising a hook-error notice. Confirm on v2.1.218 that a malformed guard payload therefore disappears without a trace, so the guard must emit strictly valid JSON.
5. On v2.1.218 (pre-v2.1.268), does `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` leave per-hook timeout at 1.5 s (L3359)? Measure how much a Node.js ESM handoff writer can do in 1.5 s including Node startup.
6. Does `FileChanged` accept a matcher like `.synchrobuilder/cache.json` (path with a directory component) or only bare basenames in cwd (L2867)?
7. Does `Stop` fire in `-p` mode, and does `Notification` `idle_prompt` fire at all outside terminal sessions (L2289)?
