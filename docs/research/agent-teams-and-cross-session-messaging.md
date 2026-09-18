# Agent Teams and Cross-Session Messaging: what Claude Code ships, and why Synchrobuilder is different

## Source

- https://code.claude.com/docs/en/agent-teams (raw: `agent-teams.md`, 489 lines, read whole)
- https://code.claude.com/docs/en/cross-session-messaging (raw: `cross-session-messaging.md`, 375 lines, read whole)
- https://code.claude.com/docs/en/remote-control (raw: `remote-control.md`, 478 lines; read the Requirements section, "Connect from another device", "Enable Remote Control for all sessions", "Connection and security", "Trusted Devices", "Limitations", and the resume/account passages)

Fetched 2026-09-18 as raw Markdown downloaded from code.claude.com/docs/en/<page>.md. The docs do not state which CLI release they describe; the highest version marker in the three files is v2.1.271 (cross-session-messaging.md L239; agent-teams.md tops out at v2.1.257, remote-control.md at v2.1.269). A claim that v2.1.276 was the latest npm release is not verifiable from these sources and was removed. The local CLI used for experiments is v2.1.218 (`claude --version`, checked 2026-09-18).

Citation format: (file L<start>-L<end>). Line numbers are those of the raw files; lines 1-4 of each are an index preamble.

---

## 1. Agent teams

### What it is

> Agent teams let you coordinate multiple Claude Code instances working together. One session acts as the team lead, coordinating work, assigning tasks, and synthesizing results. Teammates work independently, each in its own context window, and communicate directly with each other. You can also talk to any teammate directly without going through the lead. (agent-teams.md L13)

The page is versioned: "This page describes agent teams as of v2.1.178." Before that version, `TeamCreate` and `TeamDelete` tools existed; "Both tools no longer exist." The `team_name` field in `TaskCreated`, `TaskCompleted`, and `TeammateIdle` hook payloads "carries the session-derived name and is deprecated." (agent-teams.md L17-L19)

The docs position it as the heaviest option: "Before you set up a team, check whether a lighter option does the job. Subagents work within a single session, and with cross-session messaging Claude can pass findings between the sessions you run yourself." (agent-teams.md L15)

### How it is enabled

> Agent teams are experimental and disabled by default. Enable them by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your settings.json or environment. Without that variable, no team is set up at session start, no team directories are written, and Claude does not spawn or propose teammates. (agent-teams.md L9-L11)

```json settings.json theme={null}
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```
(agent-teams.md L56-L62)

Side effect of enabling: "while agent teams are enabled, a subagent that Claude names launches as a teammate, so teams can form even when you didn't ask for one." (agent-teams.md L64) Turn off with the variable set to `0`; Claude Code "reapplies settings-file `env` values to the running session when you save, and rereads the variable each time Claude spawns a subagent" (agent-teams.md L426-L436). Precedence: project/local/`--settings` and managed settings can re-enable it over a user `0` (agent-teams.md L438-L441).

Interactive only:

> Spawning teammates also requires an interactive session. In non-interactive mode with the `-p` flag, including Agent SDK sessions, Claude doesn't spawn teammates, and a subagent that Claude names runs as an ordinary subagent even with agent teams enabled. (agent-teams.md L66)

### Architecture: one lead, teammates as sessions on the same machine

| Component | Role |
| :-- | :-- |
| **Team lead** | The main Claude Code session that spawns teammates and coordinates work |
| **Teammates** | Separate Claude Code instances that each work on assigned tasks |
| **Task list** | Shared list of work items that teammates claim and complete |
| **Mailbox** | Messaging system for communication between agents |

(agent-teams.md L233-L240)

How a team starts: "Claude launches a teammate when it calls the Agent tool with a `name` while agent teams are enabled, unless the call is a fork or passes `isolation` on the call itself. Claude Code doesn't ask you to confirm the launch." (agent-teams.md L227)

Display modes (agent-teams.md L100-L105):
- **In-process**: "all teammates run inside your main terminal ... Works in any terminal, no extra setup required."
- **Split panes**: "each teammate gets its own pane ... Requires tmux, or iTerm2."

Default is `"in-process"`; `"auto"`, `"tmux"`, and (as of v2.1.186) `"iterm2"` are the other `teammateMode` values, set in `~/.claude/settings.json` or with the experimental `claude --teammate-mode auto` flag (agent-teams.md L111-L129). "Split-pane mode isn't supported in VS Code's integrated terminal, Windows Terminal, or Ghostty." (agent-teams.md L481)

Mailbox and storage are local files under the home directory:

> Each agent's mailbox is a JSON file at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`. Claude Code validates every entry when it reads a mailbox file. (agent-teams.md L242)

> Claude Code reports a message as sent only when the write to the recipient's mailbox file succeeds ... When the write fails, for example because the disk is full or the mailbox directory isn't writable, the sending agent receives an error and nothing is sent. (agent-teams.md L244)

> Teams and tasks are stored locally under a session-derived name. The name is `session-` followed by the first eight characters of the session ID: (agent-teams.md L248)

- Team config: `~/.claude/teams/{team-name}/config.json`
- Task list: `~/.claude/tasks/{team-name}/` (agent-teams.md L250-L251)

> Claude Code generates both of these automatically at session startup and updates them as teammates join, go idle, or leave. The team config directory is removed when the session ends. The task list directory persists locally and is never uploaded, so resumed sessions keep their tasks. (agent-teams.md L253)

> The team config holds runtime state such as session IDs and tmux pane IDs, so don't edit it by hand or pre-author it: your changes are overwritten on the next state update. (agent-teams.md L255)

> There is no project-level equivalent of the team config. A file like `.claude/teams/teams.json` in your project directory is not recognized as configuration; Claude treats it as an ordinary file. (agent-teams.md L261)

Team config contains a `members` array with each member's name and agent ID; the lead is type `team-lead`; "Teammates can read this file to discover other team members." (agent-teams.md L259)

### Task assignment and claiming

> The shared task list coordinates work across the team. The lead creates tasks and teammates work through them. Tasks have three states: pending, in progress, and completed. Tasks can also depend on other tasks: a pending task with unresolved dependencies cannot be claimed until those dependencies are completed. (agent-teams.md L190)

"Agents without the Task tools coordinate through messages instead of the shared task list." (agent-teams.md L192) Assignment is either lead-assigns or self-claim: "after finishing a task, a teammate picks up the next unassigned, unblocked task on its own" (agent-teams.md L194-L197).

> Task claiming uses file locking to prevent race conditions when multiple teammates try to claim the same task simultaneously. (agent-teams.md L199)

Dependencies unblock automatically (agent-teams.md L246). For an **in-process** teammate spawned from a subagent definition, Claude Code adds `SendMessage` to the definition's `tools` list, plus `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` when the session has the Task tools; the docs say nothing about adding these tools for a split-pane teammate (agent-teams.md L275).

### Hooks: TeammateIdle, TaskCreated, TaskCompleted

> * `TeammateIdle`: runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working.
> * `TaskCreated`: runs when a task is being created. Exit with code 2 to prevent creation and send feedback.
> * `TaskCompleted`: runs when a task is being marked complete. Exit with code 2 to prevent completion and send feedback. (agent-teams.md L217-L219)

### Permissions

> Teammates start with the lead's permission mode, except `dontAsk` mode, which they don't inherit. If the lead runs with `--dangerously-skip-permissions`, all teammates do too. After spawning, you can change an individual teammate's permission mode, but you can't set per-teammate permission modes at spawn time. (agent-teams.md L287)

> Teammate permission prompts appear in the lead session, so approve them there yourself. (agent-teams.md L289)

Plan approval is the exception: "Claude Code approves the plan in the lead's session as soon as the request arrives, without the lead reviewing it." (agent-teams.md L175, L289)

Messages between agents are framed as not-the-user:

> When one agent sends another a message over `SendMessage`, Claude Code tells the receiving agent the message came from another Claude session, not from you. A teammate can't approve a permission prompt or supply consent on your behalf, and a teammate that was denied an action can't relay it to another teammate to bypass the check. The same rules apply to a message that arrives from one of your other Claude Code sessions, outside the team entirely. (agent-teams.md L293)

In auto mode the classifier "treats an approval claim relayed from another agent as untrusted input rather than confirmation from you" and "reviews each message before Claude Code delivers it ... A message it blocks never reaches the recipient." (agent-teams.md L295-L298)

### Context and communication

Each teammate has its own context window, loads CLAUDE.md, MCP servers, and skills, receives the spawn prompt, and "The lead's conversation history does not carry over." (agent-teams.md L302) Messages deliver automatically; idle teammates notify the lead with their final answer; "To reach everyone, send one message per recipient." (agent-teams.md L306-L309)

### Token usage

> Agent teams use significantly more tokens than a single session. Each teammate has its own context window, and token usage scales with the number of active teammates. (agent-teams.md L315)

In-process teammate cache TTL is five minutes by default; `subagentPromptCacheTtl` set to `1h` extends it at a higher write rate (agent-teams.md L317). "There's no hard limit on the number of teammates" but "Token costs scale linearly" (agent-teams.md L367-L369). "Start with 3-5 teammates for most workflows." (agent-teams.md L373)

### Limitations (verbatim)

> Agent teams are experimental. Current limitations to be aware of:
>
> * **No session resumption with in-process teammates**: `/resume` and `/rewind` do not restore in-process teammates. After resuming a session, the lead may attempt to message teammates that no longer exist. If this happens, tell the lead to spawn new teammates.
> * **Task status can lag**: teammates sometimes fail to mark tasks as completed, which blocks dependent tasks. If a task appears stuck, check whether the work is actually done and update the task status manually or tell the lead to nudge the teammate.
> * **Shutdown can be slow**: teammates finish their current request or tool call before shutting down, which can take time.
> * **One team per session**: a session has exactly one team, scoped to that session. You can't create additional named teams or share a team across sessions.
> * **No nested teams**: teammates cannot spawn their own teammates. Only the lead can manage the team.
> * **No background subagents from in-process teammates**: an in-process teammate's own subagents run in the foreground, because a teammate's background work can't outlive the lead's process. Claude Code returns an error when a teammate spawns a subagent whose definition sets `background: true`. A teammate's `run_in_background: true` request also fails, either with an error or by running silently in the foreground, as described in how Claude Code picks foreground or background. Subagents launched from the main conversation follow the background default.
> * **Lead is fixed**: the main session is the lead for its lifetime. You can't promote a teammate to lead or transfer leadership.
> * **Permissions set at spawn**: teammates start with the permission mode described under Permissions. You can change an individual teammate's permission mode after spawning, but you can't set per-teammate permission modes at spawn time.
> * **Split panes require tmux or iTerm2**: the default in-process mode works in any terminal. Split-pane mode isn't supported in VS Code's integrated terminal, Windows Terminal, or Ghostty. (agent-teams.md L471-L481)

### Every statement scoping agent teams to one user, one machine, or one account

- "Teammates work independently, each in its own context window" and "You can also talk to any teammate directly" — teammates are Claude instances spawned by the lead, not people (agent-teams.md L13).
- "cross-session messaging Claude can pass findings between the sessions you run yourself" (agent-teams.md L15; repeated at L488).
- Teammates are "Separate Claude Code instances" spawned by "The main Claude Code session" (agent-teams.md L237-L238).
- In-process teammates "run inside your main terminal"; in split-pane mode "each teammate gets its own pane", which "Requires tmux, or iTerm2" (agent-teams.md L104-L105).
- "Each teammate is a full, independent Claude Code session. You can message any teammate directly" (agent-teams.md L179); while viewing an in-process teammate, "built-in commands still run in the lead's session" (L184).
- A stopped in-process teammate that is messaged again is brought back "in the same session" (agent-teams.md L281).
- Mailboxes are files under `~/.claude/teams/...` (agent-teams.md L242); team config and task list are under `~/.claude/` and "stored locally", "never uploaded" (agent-teams.md L248-L253).
- Team name is derived from the lead's session ID (agent-teams.md L248).
- "Teammate permission prompts appear in the lead session, so approve them there yourself." (agent-teams.md L289)
- "One team per session: a session has exactly one team, scoped to that session. You can't create additional named teams or share a team across sessions." (agent-teams.md L476)
- "a teammate's background work can't outlive the lead's process" (agent-teams.md L478)
- "Lead is fixed: the main session is the lead for its lifetime." (agent-teams.md L479)
- "Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files." (agent-teams.md L401)

Not found in docs: any mention of a second human user, a second account, a second machine, a git remote, or network transport for agent teams. A case-insensitive search of agent-teams.md for "account", "remote", "machine", "network", "another user", and "colleague" returns zero hits (re-run 2026-09-18). The only transport the page describes is the per-agent mailbox JSON file under `~/.claude/teams/` (L242); no socket, server, or network path is mentioned anywhere on the page.

---

## 2. Cross-session messaging

### Scope and version requirements

> Cross-session messaging requires Claude Code v2.1.224 or later on macOS and Linux, including Linux inside WSL 2. On native Windows, it requires Claude Code v2.1.234 or later. When a session meets the requirements, messaging is on with nothing to enable. (cross-session-messaging.md L9-L11)

> Cross-session messaging lets Claude deliver a message from one of your Claude Code sessions to another. (cross-session-messaging.md L13)

> A message is a piece of text one Claude writes to another, never the sender's conversation history or files. (cross-session-messaging.md L15)

Tools: "`ListAgents` to discover which agents it can reach, and `SendMessage` to deliver a message to one of them by name." The page "covers messages between your independent sessions." (cross-session-messaging.md L17) "Use messaging between independent sessions that you start and steer yourself." (cross-session-messaging.md L28)

Other version markers: `@`-mention typeahead requires v2.1.232 (L52); starting a conversation with a session on another of your machines requires v2.1.225 (L162); idle notices require v2.1.236 in both sessions (L92); teammates in `/list-agents` from v2.1.239 (L124); preview line from v2.1.247 (L189); `@` mentions in messages no longer attach files from v2.1.251 (L71); same-machine messaging on third-party providers or with flag fetching off requires v2.1.248 (L338); notices to `claude -p` senders require v2.1.271 (L239).

### How sessions on one machine find each other

> Same-machine delivery works wherever the feature is enabled. Each session registers itself in files on disk. When Claude lists or messages your local sessions, Claude Code reads those files to find the sessions, so two sessions can reach each other only when they can see the same files. (cross-session-messaging.md L166)

> A container has its own filesystem, so a session inside it and a session on the host can't reach each other. Two sessions inside the same container can still message each other, including on a self-hosted runner. A session inside WSL 2 and a native Windows session on the same computer can't reach each other either, because they register under different home directories and listen on different socket types. (cross-session-messaging.md L168)

A local session "appears only when it binds an inbox socket" (cross-session-messaging.md L125).

The inbox socket:

> Claude Code binds an inbox socket for each session with cross-session messaging enabled, where other sessions on the machine deliver messages. The socket is a Unix domain socket on macOS and Linux, including Linux inside WSL 2, and a named pipe on native Windows. (cross-session-messaging.md L266)

Path discovery: `/status` shows it in the `Peer address` row prefixed `uds:`; and "Claude Code exports it to hooks and Bash commands as the `CLAUDE_CODE_MESSAGING_SOCKET` environment variable", exported "before any hook runs, including `SessionStart`", and "Each session exports its own socket, never one inherited from a parent session." (cross-session-messaging.md L268-L273)

> On macOS and Linux, Claude Code restricts the socket to your operating-system user. On native Windows, it instead requires each connection to authenticate first with a key that only your operating-system user can read. Either way, on a shared machine another user's sessions can't deliver to it. (cross-session-messaging.md L275)

Fallback directory `/tmp/cc-socks-<uid>`; when no directory is acceptable "the session runs without an inbox" and `/status` shows `unavailable` (cross-session-messaging.md L277).

Scripts and hooks can post into a session (the section is introduced with "when you want a script or hook to post into a session", L264):

> Alongside the socket's path, Claude Code exports a per-session token as `CLAUDE_CODE_MESSAGING_TOKEN`. A script posting to its own session's socket can send `{"type":"auth","token":"<token>"}` as the first line of its connection, where `<token>` is the value of `CLAUDE_CODE_MESSAGING_TOKEN`. (cross-session-messaging.md L279)

The auth line is optional on macOS/Linux/WSL 2 and required on native Windows (L281-L282). "Claude Code closes a connection that hasn't sent a complete line within 30 seconds" (L284).

Own-child rule:

> **Own-child messages**: when no `crossSessionInbound` value applies, Claude Code delivers a message it verifies came from the session's own child processes, such as a hook or Bash command posting back to its own session's socket. (cross-session-messaging.md L290)

Verification: on Linux by process evidence even after the child exits; on macOS only while the posting process is still running, otherwise by the token; in a PID-1 container and on native Windows only by the token; when neither works "it treats the message like any other that asserts no permission class, so a session that bypasses permission prompts holds it for your approval." (cross-session-messaging.md L291-L293) Sandboxed Bash needs `sandbox.network.allowAllUnixSockets` / `allowUnixSockets` to reach the socket (L294).

A regular `claude -p` session binds an inbox socket "like an interactive one" and appears in the listing; only a bare-mode session does not bind the socket, "so that session can't receive messages and doesn't appear in the agent list" (L247).

Sender-side safety check on local targets: Claude Code refuses a send when "The reply target on this machine fails a safety check, such as a symlinked target or an endpoint that isn't the expected process." (L77) Names are not unique identifiers: when "Several sessions share the name, or Claude Code couldn't check everywhere your sessions run", Claude adds "a short identifier to each row of its listing and uses the identifier in the address" (L147-L150).

### How messages to other machines travel

| Where the other session runs | How the message travels |
| :-- | :-- |
| On this machine | Over a per-session socket on macOS and Linux, or a per-session named pipe on native Windows, never through Anthropic servers |
| On another of your machines | Through Anthropic servers, arriving over that machine's Remote Control connection |
| In the cloud | Through Anthropic servers, straight to the cloud session |

(cross-session-messaging.md L156-L160)

> Starting a conversation with a session on another of your machines requires Claude Code v2.1.225 or later and a target that appears in the listing. (cross-session-messaging.md L162)

Listing entries beyond this machine: "Your cloud sessions: shown while this session is connected to Remote Control" and "Your Remote Control sessions on other machines: shown while this session is connected to Remote Control, and labeled `Remote Control`. Claude Code shows `offline` as the status of a session whose Remote Control connection has dropped." (cross-session-messaging.md L126-L127) A message to an `offline` session "arrives only after that session's machine reconnects" (L164). The lists are read "newest first" with "a bounded number of pages" (L139).

> If this session isn't connected to Remote Control when Claude sends to a session beyond this machine, the message still goes through, but without a reply address, so the receiving Claude can't answer it. (cross-session-messaging.md L172)

Cross-machine messages appear under the sender's Remote Control name, e.g. `laptop-graceful-unicorn` (L170).

### Availability by provider

> * **Sessions on this machine**: available on every provider, including Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, and Microsoft Foundry, and in sessions that run with feature-flag fetching off. On those providers, and with flag fetching off, same-machine messaging requires Claude Code v2.1.248 or later. Claude Code delivers these messages over a per-session socket on your machine, never through Anthropic servers. (cross-session-messaging.md L338)

> * **Sessions beyond this machine**: Claude finds your cloud sessions and your sessions on other machines from a session that is connected to Remote Control, which needs a claude.ai sign-in as this session's active authentication and the other Remote Control requirements. Claude can't find those sessions with an API key or on Amazon Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, and Microsoft Foundry. (cross-session-messaging.md L342)

OS: "available on macOS, Windows, and Linux, including Linux inside WSL 2." (L336) Diagnostic: `/list-agents` (alias `/peers`); if it "isn't recognized", the session lacks the feature (L344-L346).

### Inbound controls: `crossSessionInbound`

| Value | Behavior |
| :-- | :-- |
| `accept` | Claude Code delivers each message to Claude |
| `hold` | Claude Code shows a notice for each message and doesn't deliver it. If an `accept` later applies, per the precedence rules, Claude Code releases the held messages |
| `refuse` | Claude Code drops each message without delivering it |

(cross-session-messaging.md L213-L217)

Also selectable in `/config` as **Messages from your other sessions** (v2.1.232+) (L219). Default when no value applies is decided per message from the two sessions' permission modes: a prompting receiver delivers unless the sender bypasses permissions; a bypassing receiver holds unless the sender also bypasses (L223-L226). Held messages open an approval dialog; unanswered past `dialogExpiry` (default five minutes) they are dropped (L228-L232). "Claude Code holds at most 100 messages, separately from the delivery queue, and past that drops the oldest." (L243) For a `-p` worker to take messages unattended, start it with `crossSessionInbound` set to `accept` in `--settings` (L258).

Three outcomes: Delivered, Held, Refused (L80-L84). Once delivered, "the message counts toward usage like a prompt you type" (L86).

### `isolatePeerMachines`

```json theme={null}
{
  "isolatePeerMachines": true
}
```
(cross-session-messaging.md L304-L308)

> With this set, Claude Code asks for your approval before Claude's message to a session beyond this machine leaves, even in `bypassPermissions` mode, which skips ordinary permission prompts. A `true` from any settings scope applies, so a checked-in project file can turn the requirement on but not off. Claude Code doesn't prompt for messages between sessions on the same machine. (cross-session-messaging.md L310)

Turning messaging off: `crossSessionInbound: "refuse"` stops receiving; permission deny rules naming bare `SendMessage` and `ListAgents` stop sending and listing; "Denying `SendMessage` also removes messaging to subagents and agent-team teammates, since the same tool serves both." (L314-L330)

### How a session treats an incoming message (verbatim)

> When session A messages session B, Claude Code tells B's Claude that the message came from another session, not from you, and limits what the message can do:
>
> * **It can't approve anything**: a message from another session never counts as your consent, so it can't answer a pending permission prompt on your behalf.
> * **It can't change configuration**: Claude Code instructs the receiving Claude never to change permission settings, `CLAUDE.md`, or other configuration because another session asked.
> * **Commands don't run**: a command in the message's text, such as `/compact`, arrives as plain text. Claude Code never executes it.
> * **Permission prompts still fire**: if acting on the message requires a permission the receiving session doesn't have, you see the same prompt you'd see for any other work. (cross-session-messaging.md L178-L183)

Delivery timing: "The receiving Claude reads the message between tool calls during an active turn, so a running tool is never interrupted. When the receiving session is idle, Claude Code starts a new turn with the message." (L69) `@` mentions in a message arrive as written; "Claude Code attaches nothing" (L71).

What the user sees: a dim one-line preview such as `› Message from @api-worker: Schema migration finished (ctrl+o to expand)`; the preview "shortens only what you see ... Claude reads the full message." (L189-L196) "Claude receives the message with the sender's name and a reply address, except for a one-way cross-machine message ... Beyond the name and reply address, the receiving Claude gets the message's text, never the sender's conversation history or files." (L198) Permission boundaries stay per-session; Claude "is instructed never to ask another session for an action that was denied or blocked in its own session" (L88).

### Limits (verbatim)

> * **Plain text only**: Claude sends only plain text across sessions. Structured agent team protocol messages stay within a team.
> * **Same-machine message size is capped**: Claude Code refuses a message to a session on this machine once its serialized form passes about a million characters. The refusal names the exact sizes. Nothing reaches the receiving session.
> * **Rapid bursts to one session are refused at the sender**: once a rapid burst of messages to a session on this machine reaches what that session's inbox accepts, Claude Code refuses further sends in the sending session. The refusal names the burst and tells Claude to batch the rest into one message or wait. Before v2.1.236, Claude Code reported those sends as sent while the receiving session dropped them.
> * **Message loops are throttled**: in the receiving session, Claude Code rate-limits repeated messages per sender, drops identical repeats arriving within a short window, and queues at most 50 accepted messages for Claude to read. A message loop between two sessions therefore stops on its own. When the rate limit, repeat check, or queue cap drops a message from an interactive session on this machine, Claude Code tells that session which one dropped it and tells its Claude not to resend right away. (cross-session-messaging.md L362-L365)

Idle notices (`notify_when_idle`): one-shot, dropped after 12 hours, and "Only the Claude in your main conversation can subscribe, and only to your sessions on this machine." (L110, L117)

---

## 3. Remote Control requirements

What it is: "Remote Control connects claude.ai/code or the Claude app for iOS and Android to a Claude Code session running on your machine." (remote-control.md L13) "The web and mobile interfaces are a window into that local session." (L22)

Requirements (verbatim, L30-L37). Note the page's own inconsistency on plans: the intro Note says "Remote Control is available on all plans" (L10), while the Requirements bullet lists "Pro, Max, Team, and Enterprise plans" and excludes API keys (L30); both agree Team and Enterprise need an Owner to enable the toggle.

> * **Subscription**: available on Pro, Max, Team, and Enterprise plans. API keys are not supported. On Team and Enterprise, an Owner must first enable the Remote Control toggle in Claude Code admin settings.
> * **Authentication**: run `claude` and use `/login` to sign in through claude.ai if you haven't already. Without an eligible login, `claude remote-control` exits with an error, while `claude --remote-control` still starts an interactive session and shows a Remote Control failure notification shortly after launch.
> * **API endpoint**: not available in any of these configurations:
>   * You use Amazon Bedrock, Google Cloud's Agent Platform, or Microsoft Foundry.
>   * You point `ANTHROPIC_BASE_URL` at a host other than `api.anthropic.com`, such as an LLM gateway or proxy. Unset the variable to use Remote Control. Before v2.1.196, Claude Code allowed Remote Control with a custom `ANTHROPIC_BASE_URL`.
>   * You sign in through an enterprise Claude apps gateway.
> * **Feature-flag evaluation**: `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and `DISABLE_GROWTHBOOK` each disable the feature-flag evaluation that Remote Control availability depends on. Unset the variable wherever it's set, in your shell environment or in the `env` block of a `settings.json` file, to use Remote Control.
> * **Workspace trust**: run `claude` in your project directory at least once to accept the workspace trust dialog. The startup trust dialog never saves trust for your home directory, so start Remote Control from a project directory. (remote-control.md L30-L37)

Transport and data: "Your local Claude Code session makes outbound HTTPS requests only and never opens inbound ports on your machine ... it registers with the Anthropic API and polls for work." (L222) "While Remote Control is connected, the session transcript, including your messages, Claude's responses, and tool activity, is stored on Anthropic servers." (L226) "Organizations with compliance requirements such as Zero Data Retention can't enable Remote Control." (L228)

Cross-session messaging rides the same connection: "the same connection carries messages between your own sessions on different machines and from your cloud sessions, through Anthropic servers like the rest of Remote Control traffic ... Requires Claude Code v2.1.224 or later." (L176)

### Could Remote Control connect two different developers?

Conclusion from the docs: no. Every statement scopes Remote Control to the signed-in account's own sessions, and nothing describes sharing a session with another account.

- "Auto-connect signs in with your own claude.ai account, so a session it starts appears only in your own account's Claude apps and grants no one else access." (remote-control.md L200)
- Cross-machine messaging is "between your own sessions on different machines" (L176) and the listing shows "Your Remote Control sessions on other machines" (cross-session-messaging.md L127).
- On resume, when the reconnection "record names a different account: Claude Code starts a new session without the conversation's earlier messages and without showing a message" (remote-control.md L427); "the server reports a session you deleted and a session owned by another account the same way" (L442).
- Trusted Devices "ties Remote Control access to a known device and a recent authentication, not just a signed-in account" and is about a member's own enrolled devices (L238-L243); nothing there describes viewing another member's session.
- Searched remote-control.md for "share", "shared", "collaborat", "invite", "other people", "another user", "other users": the only hits are `--spawn same-dir` ("all sessions share the current working directory", L63), which concerns one user's sessions. Not found in docs: any way to grant a second account access to a Remote Control session.

Other constraints: "One remote session per interactive process" (L327); "Local process must keep running ... the session goes offline until you bring it back" (L328); local-only commands such as `/plugin` "work only from the local CLI" (L337).

---

## 4. How Synchrobuilder differs: fact base

Synchrobuilder's target is two developers on two machines with different accounts, coordinating through a git remote with no server. Each built-in feature fails at least one of those requirements.

### Agent Teams: unsuitable because

1. Teammates are Claude instances spawned by one lead session, not humans: "Separate Claude Code instances that each work on assigned tasks" (agent-teams.md L238); the lead "spawns teammates" (L237).
2. All state lives in the lead user's home directory: mailboxes at `~/.claude/teams/{team-name}/inboxes/{agent-name}.json` (L242), config at `~/.claude/teams/{team-name}/config.json`, tasks at `~/.claude/tasks/{team-name}/` (L250-L251); "stored locally" and "never uploaded" (L248, L253).
3. A team cannot span sessions, let alone machines: "One team per session ... You can't create additional named teams or share a team across sessions." (L476)
4. The team dies with the lead process: "a teammate's background work can't outlive the lead's process" (L478); "The team config directory is removed when the session ends" (L253); "Lead is fixed" (L479).
5. No project-level configuration exists that a repo could ship: "There is no project-level equivalent of the team config" (L261).
6. Experimental, off by default, and requires a per-user env flag (L9-L11, L54); interactive sessions only (L66).
7. Token cost scales with teammates because each is a separate Claude instance (L48, L315, L369), whereas Synchrobuilder's teammates are already-running human sessions.
8. The task-claiming file lock (L199) is a same-filesystem mechanism; the docs give no networked equivalent.

### Cross-session messaging: unsuitable because

1. It is defined as messaging between one person's sessions: "from one of your Claude Code sessions to another" (cross-session-messaging.md L13); "between your independent sessions" (L17); "sessions that you start and steer yourself" (L28).
2. Same-machine discovery is filesystem-bound: "Each session registers itself in files on disk ... two sessions can reach each other only when they can see the same files" (L166); a container or WSL boundary already breaks it (L168).
3. The local socket is restricted to one OS user: "on a shared machine another user's sessions can't deliver to it" (L275).
4. Cross-machine delivery requires Remote Control and thus a claude.ai sign-in and Anthropic servers: "Through Anthropic servers, arriving over that machine's Remote Control connection" (L159); "needs a claude.ai sign-in as this session's active authentication" (L342). Synchrobuilder's brief requires no server and must work for teammates on any provider.
5. Not available across machines with an API key or on Bedrock, Claude Platform on AWS, Google Cloud's Agent Platform, or Microsoft Foundry (L342); Remote Control itself excludes API keys, those providers, custom `ANTHROPIC_BASE_URL`, and the enterprise apps gateway (remote-control.md L30-L35).
6. Remote Control is single-account: "grants no one else access" (remote-control.md L200); the listing is of "Your Remote Control sessions on other machines" (cross-session-messaging.md L127).
7. Remote Control stores the transcript on Anthropic servers (remote-control.md L226), which conflicts with a privacy stance of never sending prompts or transcripts anywhere.
8. Messages are addressed to running sessions, not to people or repositories: plain text only (L362); a local session "appears only when it binds an inbox socket", i.e. while it is running (L125); a bare-mode `-p` session cannot receive at all (L247); a message to an `offline` Remote Control session "arrives only after that session's machine reconnects" (L164), which is the only documented queued delivery and it targets a specific existing session. The docs describe no way to address a session that does not exist yet, so a teammate who opens a fresh session tomorrow has no inbox to receive yesterday's message. Synchrobuilder needs durable state (presence, claims, task board, handoffs) that survives both sessions ending.
9. Version floor v2.1.224 (macOS/Linux) or v2.1.234 (Windows) (L334); the local experiment CLI v2.1.218 predates it.

---

## Implications for Synchrobuilder

- **Own-session socket is a viable "sooner than next prompt" channel.** A hook or child script can post into its own session's inbox socket using `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`, and an own-child message is delivered when no `crossSessionInbound` value applies (cross-session-messaging.md L264, L271-L273, L279-L284, L290). Delivery happens "between tool calls during an active turn" or starts a new turn when idle (L69). This could let the background sync loop surface a `/synchrobuilder:notify` mid-turn. Caveats: the variable is exported to hooks only in sessions "that start with messaging on" (L272); the auth line is mandatory on Windows (L282); on macOS after the posting process exits verification needs the token (L292); a bypassing session holds unverifiable messages (L293); and the docs never state the wire format beyond the auth line, so Node (not bash) socket code must be settled by experiment.
- **Reuse the docs' untrusted-message framing.** Claude Code tells the receiving Claude the message "came from another session, not from you", cannot approve, cannot change configuration, and commands arrive as plain text (L178-L183; agent-teams.md L293). Synchrobuilder's labeled untrusted block for teammate text should state the same four limits.
- **Respect the loop and burst limits if the socket is used.** Queue cap 50, per-sender rate limit, identical repeats dropped, held cap 100 (L365, L243). Batch notices into one message per sync tick.
- **Do not depend on `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, TeammateIdle, TaskCreated, or TaskCompleted.** Those hooks fire for agent-team tasks, not for Synchrobuilder's git-backed task board (agent-teams.md L217-L219). Reusing the word "task" for the board needs a note that it is not the Task tools' list.
- **Avoid `.claude/teams/` paths.** The docs explicitly say `.claude/teams/teams.json` is treated as an ordinary file (L261); `.synchrobuilder/team.json` is unrelated, but the docs name collision on "team" is worth a sentence in README.
- **Presence status "offline" semantics exist as prior art.** Cross-session listing marks a dropped Remote Control session `offline` and still accepts a message for later delivery (L127, L164); Synchrobuilder's presence and queued notify can mirror that vocabulary.
- **Channels are the documented path for pushing external events into a session.** Cross-session messaging's own "use the feature built for it" list says: "To push external events, such as CI results or chat messages, into a session, use channels" (cross-session-messaging.md L34), and remote-control.md's comparison table describes Channels as "Push events from a chat app like Telegram or Discord, or your own server", set up by "Install a channel plugin or build your own", running on "Your machine (CLI)" (remote-control.md L464, L473). The channels page itself is not among the sources, so version, transport, trust framing, and whether a plugin can post mid-turn are Not found in docs here; this is the first thing to research before committing to the inbox-socket approach.
- **Nothing here drives the status line.** A case-insensitive search of all three files for "status line" / "statusline" returns no hits.

## Conflicts with the brief

| Brief claim | What the docs say | Citation |
| :-- | :-- | :-- |
| "Multiplayer with no server" is a gap Claude Code does not fill | Confirmed, not a conflict: the only built-in cross-machine path is "Through Anthropic servers, arriving over that machine's Remote Control connection", same account only | cross-session-messaging.md L159, L342; remote-control.md L200 |
| Brief uses "teammate" for a human colleague | Claude Code uses "teammate" for a spawned Claude instance in an agent team, and `TeammateIdle` is a hook about those instances; user-facing text and hook names will collide in meaning | agent-teams.md L13, L217, L238 |
| "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)" | These three pages offer no "plugin monitor". Two documented paths exist for getting text into a running session: (a) the session's own inbox socket via `CLAUDE_CODE_MESSAGING_SOCKET`, which requires v2.1.224+ and is read only "between tool calls" or starts a new turn when idle; (b) channels, named as the feature "To push external events ... into a session", built as a channel plugin, but documented only by reference here | cross-session-messaging.md L34, L69, L271-L273, L290, L334; remote-control.md L464 |
| Brief says hooks must be under 50 ms and local-file-read only | Not contradicted, but a socket post from a hook holds a connection and the server allows up to 30 seconds for a line; a socket write is not a local file read and must be moved to the background loop, not the pre-edit hook | cross-session-messaging.md L284 |
| Brief: "never send prompts, transcripts" | Any design that leans on Remote Control would violate this: "the session transcript ... is stored on Anthropic servers" | remote-control.md L226 |
| Brief: local CLI for experiments is v2.1.218 | Cross-session messaging needs v2.1.224+ (v2.1.234 on Windows); socket experiments cannot run on v2.1.218 | cross-session-messaging.md L9-L11, L334 |

## Open questions

1. Wire format of the inbox socket beyond the `{"type":"auth","token":...}` first line: what JSON shape carries a message, and does the socket accept one message per connection? The docs do not say (searched cross-session-messaging.md for "type", "json", "line"). Needs an experiment on v2.1.224+.
2. Is `CLAUDE_CODE_MESSAGING_SOCKET` exported to `UserPromptSubmit` and `PostToolUse` hooks in the same way as `SessionStart` (L272 says "before any hook runs" only for sessions that start with messaging on)? Verify per hook event and in `-p` sessions.
3. Does a message posted by a detached background loop (parent hook already exited) count as own-child on macOS with the token, or is it held? L292 says the token path applies "after the posting process has exited"; confirm for a process spawned two hops down.
4. Does an own-child message start a new turn when the session is idle (L69), and is that acceptable UX for presence pings, or should the loop post only while a turn is active?
5. How the message is rendered to Claude (sender name, reply address, any wrapper text) when it arrives from the socket rather than from `SendMessage`, so Synchrobuilder's labeled block does not double-wrap.
6. Answered by the docs, pending experiment: `crossSessionInbound: "refuse"` (which some orgs set via managed settings, L319-L330) does drop own-child socket posts. Socket messages go "through the same inbound controls as any other peer message" (L288), the own-child exception applies only "when no `crossSessionInbound` value applies" (L290), and with `refuse` in place Claude Code "drops every message that arrives on it without delivering anything to Claude" (L330). By the same reading, an explicit `hold` holds own-child posts too. A refusing session "shows no visible change" in `/status` (L330), so Synchrobuilder cannot detect this from the outside; it must read the effective settings.
7. Whether `/list-agents` is recognized on the v2.1.218 experiment CLI at all (L346 says an unrecognized command means the feature is absent); expected answer is no, which forces an upgrade before any socket experiment.
