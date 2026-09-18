# MCP servers and channels: what the docs say for Synchrobuilder

## Source

- https://code.claude.com/docs/en/mcp (raw: `mcp.md`, 1533 lines, read whole)
- https://code.claude.com/docs/en/channels-reference (raw: `channels-reference.md`, 788 lines, read whole)
- Fetch date: 2026-09-18, raw Markdown downloaded from code.claude.com/docs/en/<page>.md
- The highest version marker in these two files is v2.1.274 (grep `v2\.1\.[0-9]+`); the docs do not state which release they describe. The local CLI used for experiments reports `2.1.218 (Claude Code)` (`claude --version`, run 2026-09-18).

Citations are (file L<start>-L<end>). Quotes are verbatim. Anything the docs do not say is marked "Not found in docs".

## 1. mcp.md

### 1.1 Plugin-provided MCP servers (mcp.md L437-L508)

Config location, start behaviour and removal (mcp.md L439-L446):

> Plugins can bundle MCP servers that provide tools and integrations when you enable the plugin. Plugin MCP servers work identically to user-configured servers.

> * Plugins define MCP servers in `.mcp.json` at the plugin root or inline in `plugin.json`
> * When you enable a plugin, Claude Code starts its MCP servers automatically
> * Claude Code offers plugin MCP tools alongside manually configured MCP tools
> * You add and remove plugin servers by installing or uninstalling the plugin, not with `/mcp` commands. You can still toggle an installed plugin server off in `/mcp`, which stops Claude Code from connecting to it without removing the plugin

Example configs, verbatim (mcp.md L450-L478):

```json
{
  "mcpServers": {
    "database-tools": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_URL": "${DB_URL}"
      }
    }
  }
}
```

```json
{
  "name": "my-plugin",
  "mcpServers": {
    "plugin-api": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/api-server",
      "args": ["--port", "8080"]
    }
  }
}
```

Lifecycle (mcp.md L482-L487):

> * At session startup, Claude Code connects the servers for enabled plugins automatically. [...]
> * If you enable or disable a plugin during a session, Claude Code connects or disconnects its MCP servers when the change applies. [...] In a session without an interactive terminal, `/reload-plugins` doesn't connect or disconnect plugin MCP servers; those changes take effect in your next session
> * When you reload, Claude Code keeps the live connections of plugin servers whose configuration is unchanged [...]
> * When you move the session with `/cd` on v2.1.246 or later, Claude Code connects the servers of plugins the new directory's settings enable and disconnects the servers of plugins that are no longer enabled [...]
> * In cloud sessions, an MCP call to a plugin server that isn't connected yet, such as right after an idle session wakes, starts the server on demand and waits for it to connect (L487)

Path placeholders (mcp.md L488-L490):

> **Path placeholders**: `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin's installation directory, `${CLAUDE_PLUGIN_DATA}` to its persistent state directory, and `${CLAUDE_PROJECT_DIR}` to the stable project root. Substitution applies to:
>   * `stdio` servers: `command`, `args`, `env`
>   * `http`, `sse`, and `ws` servers: `url`, `headers`, and `headersHelper`. Before v2.1.195, `headersHelper` passed the placeholder through as a literal string

Also: "Plugin-provided MCP configurations substitute `${CLAUDE_PROJECT_DIR}` directly and don't need the default" (mcp.md L119), whereas project/user-scope entries need `${CLAUDE_PROJECT_DIR:-.}` because the variable is set only in the server's environment (mcp.md L115, L119).

Environment and transports (mcp.md L491-L494): "User environment access: access to the same environment variables as manually configured servers"; stdio, SSE, HTTP and WebSocket are supported; "Plugin servers appear in `/mcp` with indicators showing they come from plugins."

Scoped names (mcp.md L496-L506), verbatim:

> Tools from a plugin-bundled MCP server include both the plugin name and the server key in their callable name. The full form is `mcp__plugin_<plugin-name>_<server-name>__<tool-name>`, where any character outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`. For the `database-tools` server bundled in a plugin named `my-plugin`, a `query` tool is callable as:

```
mcp__plugin_my-plugin_database-tools__query
```

> Use this full name when referencing the tool in permission rules, a skill's `allowed-tools` list, a subagent's `tools` field, or a hook matcher. A hook matcher written against the bare server key, such as `mcp__database-tools__.*`, never fires for a plugin-bundled server.

> The server itself registers under the scoped name `plugin:<plugin-name>:<server-name>`, such as `plugin:my-plugin:database-tools`. Use that name where a configured server name is expected, such as an `mcp_tool` hook's `server` field.

Trust requirements: plugin servers are not the "project scope" and mcp.md gives no separate approval prompt for them; they start when the plugin is enabled (L444, L483). Project scope (`.mcp.json` at project root) is different (mcp.md L575-L581):

> For security reasons, Claude Code prompts for approval in interactive sessions before using project-scoped servers from `.mcp.json` files. To reset those approval choices, run `claude mcp reset-project-choices`.

> In `claude -p` runs, Agent SDK sessions, and cloud sessions, Claude Code can't show that prompt: it loads project-scoped servers without asking. Claude Code also skips the prompt in a session you start in `bypassPermissions` mode with `skipDangerousModePermissionPrompt` set in your user settings or in managed settings. (L577)

Ways to keep a project server out anyway (L579-L581): `disabledMcpjsonServers` ("blocks it in every permission mode"), `--setting-sources` / SDK `settingSources` to exclude project settings, or `--strict-mcp-config` (only `--mcp-config` servers; skipping the approval prompt for unloaded project servers requires v2.1.246+).

Workspace trust for project approvals (mcp.md L252): "As of v2.1.196, `claude mcp list` and `claude mcp get` read `.mcp.json` approvals only from settings files that aren't checked into the repository until you trust the workspace [...] A cloned repository can't approve its own servers".

How to disable (mcp.md L308-L319): toggle in `/mcp`; recorded per project in `~/.claude.json` under `disabledMcpServers` (opt-out list that covers "user-configured servers, plugin servers, servers your organization provides through managed settings, the claude.ai connectors ..., and built-in servers that default to on", L314) or `enabledMcpServers` (opt-in for default-off built-ins, L315). These are "unrelated to `enabledMcpjsonServers` and `disabledMcpjsonServers`, which control approval of servers defined in a project's `.mcp.json` file" (L319).

Precedence (mcp.md L596-L606): Local > Project > User > Plugin-provided > claude.ai connectors; "The three scopes match duplicates by name. Plugins and connectors match by endpoint, so one that points at the same URL or command as a server above is treated as a duplicate." (L604). `managedMcpServers` ranks above all (L606, requires v2.1.259).

Plugin `headersHelper` restrictions (mcp.md L989, L993, L1001, L1010-L1015): the helper's environment gets `CLAUDE_PLUGIN_ROOT` "Set only when a plugin provides the server" (L989); runs from the plugin root (v2.1.195+); cannot reference `${user_config.*}` (before v2.1.207 it did); credential-looking env vars (`TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `AUTH` in the name) are removed for plugin-supplied helpers. Not relevant to a stdio server but noted.

### 1.2 stdio server config fields

Fields shown for stdio entries: `type` (`"stdio"`; an entry with no `type` is read as stdio, L85, L192), `command`, `args`, `env` (mcp.md L1043, L1207-L1218; plugin example L452-L464). Expansion locations (mcp.md L621-L627): `command`, `args`, `env`, `url`, `headers`. Supported syntax (L616-L617): `${VAR}` and `${VAR:-default}`. `timeout` is described as a field "in milliseconds" on "that server's `.mcp.json` entry" with no transport restriction (L406; the `ws` entry "accepts the same ... `timeout`, and `alwaysLoad` fields as `http`", L156). "The `alwaysLoad` field is available on all server types" (L1488). No stdio-specific `timeout` example appears in mcp.md.

> A JSON entry that has a `url` but no `type` is a configuration error, because Claude Code reads an entry with no `type` as a stdio server. (mcp.md L85)

Server-name rules (mcp.md L193, L1088): names may contain only letters, numbers, hyphens and underscores. Reserved names include `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser` (L293).

`CLAUDE_PROJECT_DIR` in the server process (mcp.md L115-L117):

> Claude Code sets `CLAUDE_PROJECT_DIR` in the spawned server's environment to the project root, so your server can resolve project-relative paths without depending on the working directory. This is the same directory hooks receive in their `CLAUDE_PROJECT_DIR` variable.

Servers wanting the full set of working directories should implement `roots/list`; Claude Code sends `notifications/roots/list_changed` (v2.1.203+) (L117).

Stdio servers are not reconnected automatically: "Stdio servers are local processes, and Claude Code doesn't reconnect them automatically." (mcp.md L361). Stdio has no per-request timer (L411); stdio idle timeout defaults to 30 minutes (L415).

### 1.3 env passing

- CLI: `--env KEY=value` / `-e`, multiple pairs allowed; the server name must not directly follow `--env` (mcp.md L126-L127, L142, L403).
- JSON: `env` object with `${VAR}` expansion (L458-L460, L625).
- Unset variable without default: config still loads, warning shown, literal `${VAR}` text used (L647).
- Credential variables in a *remote* server's `url`/`headers` read as empty: names such as `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN` (L651-L661). The docs scope this to `url` and `headers` of remote servers, not stdio `env`.
- Hidden whitespace warning covers `command`, `url`, `args`, `env`, `headers` (L291).

### 1.4 Windows-specific notes (npx / cmd wrappers)

Not found in docs. Searched mcp.md for `Windows`, `cmd`, `cmd /c`, `powershell`, `wsl`. The only hits: Claude Desktop import "only works on macOS and Windows Subsystem for Linux (WSL)" (mcp.md L1093) and "The desktop app's WSL sessions have no row because connectors aren't available in them yet" (L1154). There is no guidance on wrapping `npx` in `cmd /c` on Windows in this page.

### 1.5 MCP_TIMEOUT and tool timeouts (mcp.md L405-L419, L1490)

> * Configure MCP server startup timeout using the `MCP_TIMEOUT` environment variable (for example, `MCP_TIMEOUT=10000 claude` sets a 10-second timeout)
> * Set a per-server tool execution timeout by adding a `timeout` field in milliseconds to that server's `.mcp.json` entry, for example `"timeout": 600000` for ten minutes. This overrides the `MCP_TOOL_TIMEOUT` environment variable for that server only

> The per-server `timeout` is a hard wall-clock limit per tool call, and progress notifications from the server don't extend it. Values below 1000 are ignored and fall through to `MCP_TOOL_TIMEOUT`, or to its default of about 28 hours when that variable is unset. [...] Stdio and WebSocket servers have no per-request timer. (L411)

> A per-server `timeout` of at least 1000 also acts as a floor on the idle timeout described below: Claude Code never aborts that server's tool calls for idleness sooner than the per-server `timeout`. Requires Claude Code v2.1.203 or later. (L413)

> A tool call to an MCP server that sends no response and no progress notification for the idle window aborts with an error instead of waiting for the wall-clock limit. The idle timeout requires Claude Code v2.1.187 or later. It applies to every server type except IDE servers and SDK in-process servers. The idle window defaults to five minutes for HTTP, SSE, WebSocket, and claude.ai connector servers, and to 30 minutes for stdio servers. Before v2.1.203, stdio servers were exempt from the idle timeout. (L415)

`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (ms, `0` disables) (L417). Startup: "Setting `alwaysLoad: true` also makes startup wait for the server's tools, capped at the standard 5-second connect timeout [...] Other servers connect in the background by default; set `MCP_CONNECTION_NONBLOCKING=0` to make startup wait for them too." (L1490).

Automatic backgrounding (L421-L435): a main-conversation MCP call still running after two minutes moves to a background task (v2.1.212+); never in subagents, IDE servers, or non-interactive mode unless `CLAUDE_AUTO_BACKGROUND_TASKS=1` (L431-L433). `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` changes the threshold (L427).

Output limits (L1258-L1262): warning above 10,000 tokens, default limit 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`); over-limit text results are saved to a file under the session's `tool-results` directory. A tool may set `_meta["anthropic/maxResultSizeChars"]` up to 500,000 (L1273).

Tool search (L1407, L1423, L1427): tools are deferred by default; "Claude Code truncates tool descriptions and server instructions at 2KB each." `alwaysLoad: true` on the server or `"anthropic/alwaysLoad": true` in a tool's `_meta` loads upfront (L1472, L1488). With tool search, a server that finishes connecting mid-turn has its tool names listed to Claude on its next request (L306).

### 1.6 MCP prompts as slash commands (mcp.md L1492-L1529)

> Type `/` to see the commands available to you, including those from MCP servers. Claude Code lists each MCP prompt as `/servername:promptname (MCP)`. Typing `/mcp__servername__promptname` also runs it. (L1500)

Examples (L1505, L1513, L1517): `/mcp__github__list_prs`, `/mcp__github__pr_review 456`, `/mcp__jira__create_issue login-bug high`. "Claude Code splits the arguments on whitespace, so each argument is a single token" (L1510). "Prompt results are injected directly into the conversation" (L1527).

> In the `/mcp__servername__promptname` form, Claude Code replaces any character in the server name outside `A-Z`, `a-z`, `0-9`, `_`, and `-` with `_`, and uses the prompt name as the server declares it (L1528)

Shorter command name? The visible form is `/servername:promptname`, so the prefix is the *server name*, not the plugin name. mcp.md does not say what `servername` is for a plugin-bundled server (whether the `/`-menu shows `plugin:synchrobuilder:sb` or just the server key `sb`). The only hint is L506: the plugin server "registers under the scoped name `plugin:<plugin-name>:<server-name>` [...] Use that name where a configured server name is expected", which, if it applies to prompt listing, would give a *longer* prefix, not a shorter one. The tool-name form is documented as `mcp__plugin_<plugin-name>_<server-name>__<tool-name>` (L498); no equivalent statement exists for prompt commands. Not found in docs: whether `/sb:audit` is achievable via an MCP prompt on a plugin server. Needs an experiment.

### 1.7 Permission rules for MCP tools

mcp.md refers permission-rule syntax to the permissions page; what it says itself:

- Use the full `mcp__plugin_<plugin>_<server>__<tool>` name in permission rules, `allowed-tools`, subagent `tools`, and hook matchers (L504).
- `ToolSearch` can be denied via `"permissions": {"deny": ["ToolSearch"]}` (L1462-L1468).
- Org connector controls `ask`/`blocked` apply to claude.ai connectors only (L1167-L1172).
- "This MCP server only exposes Claude Code's tools to your MCP client, so your own client is responsible for implementing user confirmation" (L1251, for `claude mcp serve`).

Not found in docs (mcp.md): the general `mcp__server` / `mcp__server__tool` allow-rule syntax; that belongs to permissions.md (out of this assignment).

### 1.8 `_meta` `anthropic/requiresUserInteraction` (mcp.md L1321-L1347)

> If you're building an MCP server, you can mark a tool as requiring explicit approval on every call by setting `_meta["anthropic/requiresUserInteraction"]` to `true` in the tool's `tools/list` response entry. The value must be the JSON boolean `true`; any other value is ignored. (L1323)

> Claude Code shows that tool's permission prompt on every call, even in `acceptEdits`, `auto`, and `bypassPermissions` permission modes, and doesn't offer a "don't ask again" option for it. Allow rules that match the tool don't skip the prompt either. In `dontAsk` mode, which never prompts, Claude Code denies the call instead. (L1325)

> The prompt has to reach a person. In non-interactive mode with `--permission-prompt-tool`, an `allow` result from the prompt tool for a flagged tool is converted to a deny with the message `MCP tool requires user interaction; not supported via --permission-prompt-tool`. The Agent SDK's `canUseTool` callback does receive these calls and can approve them, because your SDK application is expected to show them to a user. (L1327)

> Use this for tools whose permission prompt is itself the point, such as a consent or access-grant step where auto-approval would mean no human ever agreed. Other tools from the same server keep their normal permission behavior. (L1329)

```json
{
  "name": "grant_access",
  "description": "Requests access to a protected resource",
  "_meta": {
    "anthropic/requiresUserInteraction": true
  }
}
```

> The `anthropic/requiresUserInteraction` annotation requires Claude Code v2.1.199 or later. Earlier versions ignore it and apply the standard permission flow. (L1343)

Remote Control and Agent SDK one-tap approval is withheld for a flagged tool; "Claude Code withholds the one-tap action and shows the tool's full permission prompt instead" (L1345; the general rule for terminal-only prompts requires v2.1.214+, L1347).

Other `_meta` keys on this page: `anthropic/maxResultSizeChars` (L1273-L1285), `anthropic/alwaysLoad` (L1488).

### 1.9 Channels as seen from mcp.md (L24, L390-L394)

> An MCP server can also push messages directly into your session so Claude can react to external events like CI results, monitoring alerts, or chat messages. To enable this, your server declares the `claude/channel` capability and you opt it in with the `--channels` flag at startup. (L392)

> On the v2 runtime, if you set `MCP_PROTOCOL_NEGOTIATION` to `auto` and a channel server negotiates MCP protocol revision 2026-07-28, it can't deliver channel messages, so Claude Code doesn't register it as a channel. Leaving the variable unset, or setting it to `legacy`, keeps stdio servers on the earlier handshake. (L394; see also L337)

WebSocket servers "suit remote MCP servers that push events to Claude unprompted" (L147) but need `.mcp.json`/`add-json`, are header-auth only, and are not shown by `claude mcp list` (L149-L156, L248).

## 2. channels-reference.md

### 2.1 What a channel is (channels-reference.md L9-L15, L32-L35)

> Channels are in research preview. Team and Enterprise organizations must explicitly enable them. (L10)

> A channel is an MCP server that pushes events into a Claude Code session so Claude can react to things happening outside the terminal. (L13)

> A channel is an MCP server that runs on the same machine as Claude Code. Claude Code spawns it as a subprocess and communicates over stdio. (L32)

Requirements (L43-L49): only `@modelcontextprotocol/sdk` and a Node-compatible runtime ("Bun, Node, and Deno all work"); the server must (1) declare `claude/channel`, (2) emit `notifications/claude/channel`, (3) connect over stdio.

### 2.2 Capability declaration (L194-L219)

| Field | Type | Description |
| --- | --- | --- |
| `capabilities.experimental['claude/channel']` | `object` | Required. Always `{}`. Presence registers the notification listener. |
| `capabilities.experimental['claude/channel/permission']` | `object` or `false` | Optional. `{}` opts in to permission relay. "Before v2.1.234, Claude Code treated `false` as declared." |
| `capabilities.tools` | `object` | Two-way only. Always `{}`. |
| `instructions` | `string` | Recommended. Delivered to Claude as context when the server connects. |

(Table paraphrased from L196-L201; field names and defaults verbatim.)

```ts
const mcp = new Server(
  { name: 'your-channel', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },  // registers the channel listener
      tools: {},  // omit for one-way channels
    },
    // Claude Code delivers this to Claude as context when the server connects, so it knows how to handle your events
    instructions: 'Messages arrive as <channel source="your-channel" ...>. Reply with the reply tool.',
  },
)
```
(L208-L218)

### 2.3 Notification format (L221-L254)

| Field | Type | Description |
| --- | --- | --- |
| `content` | `string` | The event body. Delivered as the body of the `<channel>` tag. |
| `meta` | `Record<string, string>` | Optional. Each entry becomes an attribute on the `<channel>` tag [...] Keys must be identifiers: letters, digits, and underscores only. Keys containing hyphens or other characters are silently dropped. |

(L225-L228, verbatim descriptions.)

```ts
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'build failed on main: https://ci.example.com/run/1234',
    meta: { severity: 'high', run_id: '1234' },
  },
})
```
(L233-L240)

What reaches Claude (L242-L248):

> The event arrives in Claude's context wrapped in a `<channel>` tag. The `source` attribute is set automatically from your server's configured name:

```text
<channel source="your-channel" severity="high" run_id="1234">
build failed on main: https://ci.example.com/run/1234
</channel>
```

Delivery semantics (L250-L254):

> Claude Code doesn't acknowledge notifications. The `await` on `mcp.notification()` resolves when the message is written to the transport, not when Claude has processed it. If the session hasn't loaded your server as a channel, or the organization policy blocks it, Claude Code drops the events silently and returns no error to your server.

> Events queue into the session and are processed in order. If several notifications arrive while Claude is busy, they're delivered together on the next turn and Claude handles them as a group. To process independent event streams concurrently, run separate sessions.

Terminal rendering (L163): "Your terminal renders the event as a one-line summary, `← webhook: build failed on main: https://ci.example.com/run/1234`, rather than the raw tag." Spawning (L145): "After you accept, Claude Code spawns your `webhook.ts` as a subprocess, and the HTTP listener starts automatically on the port you configured [...] You don't need to run the server yourself." Registration notice (L147): "`Channels (experimental) messages from server:webhook inject directly in this session · restart without --dangerously-load-development-channels to stop`".

### 2.4 How inbound messages are presented: untrusted? labeled?

- Labeled: yes, by the `<channel source="...">` wrapper with `meta` attributes (L157-L161, L242-L248). The `source` attribute comes from the server's configured name.
- Marked untrusted by Claude Code: Not found in docs. The page never says Claude Code annotates channel content as untrusted for the model. The security stance is placed on the server author: "An ungated channel is a prompt injection vector. Anyone who can reach your endpoint can put text in front of Claude." (L420). The only "Treat as untrusted" language concerns relay fields the *server* receives (L488, L532-L533).
- Note: the docs say instructions are delivered "as context when the server connects" (L115, L201), and server instructions are truncated at 2KB (mcp.md L1423).

### 2.5 Gate inbound messages (L418-L436)

> An ungated channel is a prompt injection vector. Anyone who can reach your endpoint can put text in front of Claude. A channel listening to a chat platform or a public endpoint needs a real sender check before it emits anything. (L420)

```ts
const allowed = new Set(loadAllowlist())  // from your access.json or equivalent

// inside your message handler, before emitting:
if (!allowed.has(message.from.id)) {  // sender, not room
  return  // drop silently
}
await mcp.notification({ ... })
```
(L425-L431)

> Gate on the sender's identity, not the chat or room identity: `message.from.id` in the example, not `message.chat.id`. In group chats, these differ, and gating on the room would let anyone in an allowlisted group inject messages into the session. (L434)

Telegram/Discord gate on a sender allowlist bootstrapped by pairing; iMessage auto-admits the user's own addresses (L436).

### 2.6 Reply tool (L256-L323)

A reply tool is "a standard MCP tool [...] Nothing about the tool registration is channel-specific" (L258). Three components: `tools: {}` capability, `ListToolsRequestSchema`/`CallToolRequestSchema` handlers, and `instructions` telling Claude when to call it (L260-L262). Example tool `reply` with `chat_id` and `text` (L286-L312). Calling the reply tool goes through the normal permission dialog; in the walkthrough the prompt appears for `mcp__webhook__reply` (L761).

### 2.7 Permission relay (L438-L595)

> When Claude calls a tool that needs approval, the local terminal dialog opens and the session waits. A two-way channel can opt in to receive the same prompt in parallel and relay it to you on another device. (L440)

> Relay covers tool-use approvals like `Bash`, `Write`, and `Edit`. Project trust and MCP server consent dialogs don't relay; those only appear in the local terminal. (L442)

> Claude Code v2.1.234 and later sends permission requests only to servers it registered as channels for the session [...] Relay also requires you to opt the server in with `--channels` or the development flag, and requires the server to declare the permission capability. (L444)

Outbound: `notifications/claude/channel/permission_request` with `request_id` ("Five lowercase letters drawn from `a`-`z` without `l`"), `tool_name`, `description`, `input_preview` (L463-L470). Sanitisation v2.1.211+: 3,500 code-point cap with `⋯ N code points elided ⋯` marker (L472-L478); v2.1.234+: `(value unserializable)` and `[REDACTED]` credential masking (L480-L486). Verdict: `notifications/claude/channel/permission` with `request_id` and `behavior: 'allow' | 'deny'`; "Neither verdict affects future calls." (L490). "Only declare the capability if your channel authenticates the sender" (L500). Wrong-ID verdicts are dropped silently (L594).

### 2.8 Research preview status and the exact flag (L53, L135-L149, L174-L190)

> During the research preview, custom channels aren't on the approved allowlist. Use `--dangerously-load-development-channels` to test locally. (L53)

```bash
# Testing a plugin you're developing
claude --dangerously-load-development-channels plugin:yourplugin@yourmarketplace

# Testing a bare .mcp.json server (no plugin wrapper yet)
claude --dangerously-load-development-channels server:webhook
```
(L179-L183)

> The bypass is per-entry. Combining this flag with `--channels` doesn't extend the bypass to the `--channels` entries. During the research preview, the approved allowlist is Anthropic-curated, so your channel stays on the development flag while you build and test. (L186)

> This flag skips the allowlist only. The `channelsEnabled` organization policy still applies. Don't use it to run channels from untrusted sources. (L189)

> Claude Code first shows a full-screen warning dialog listing the development channels you're loading. Select **I am using this for local development** to continue, or **Exit** to quit. (L141)

If blocked: "If you see "blocked by org policy," your organization admin needs to enable channels first." (L149).

### 2.9 Packaging as a plugin (L775-L781)

> To make your channel installable and shareable, wrap it in a plugin and publish it to a marketplace. Users install it with `/plugin install`, then enable it per session with `--channels plugin:<name>@<marketplace>`. (L777)

> A channel published to your own marketplace still needs `--dangerously-load-development-channels` to run, since it isn't on the approved allowlist. The default allowlist is the channel plugins in `claude-plugins-official`, which Anthropic curates at its discretion. The in-app submission forms add plugins to the community marketplace, which is not on the channel allowlist. (L779)

> On Team and Enterprise plans, an admin can instead include your plugin in the organization's own `allowedChannelPlugins` list, which replaces the default Anthropic allowlist. (L781)

`channels` field in plugin.json: Not found in docs. Searched channels-reference.md for `plugin.json` and `"channels"`; the page only says to "wrap it in a plugin" and address it as `plugin:<name>@<marketplace>`. The channel is presumably the plugin's MCP server (mcp.md L443), but no plugin.json field is documented here.

### 2.10 Availability constraints

- Same machine, stdio subprocess only (L32, L49). No HTTP/WS channel transport is described.
- Session opt-in per launch: `--channels` or the development flag (mcp.md L392; channels-reference L444, L777).
- Org policy: `channelsEnabled` (L189); Team/Enterprise must enable explicitly (L10); `allowedChannelPlugins` (L781).
- Runtime: Node-compatible; Bun, Node, Deno (L43).
- Platforms: Not found in docs (no macOS/Windows/Linux statement in channels-reference.md).
- Providers (Bedrock/Vertex/Foundry): Not found in docs.
- Interactive only? Not stated directly. The dev flag shows "a full-screen warning dialog" (L141) and the `.mcp.json` consent dialog (L143); relay says "The local terminal dialog stays open" (L455). The page has no `claude -p`/headless statement.
- v2 runtime caveat: a channel server negotiating protocol 2026-07-28 is not registered as a channel (mcp.md L337, L394).

## 3. Judgement inputs: three ways to deliver a teammate message mid-session

| Constraint | Plugin monitor stdout lines | Channel | Wait for next hook |
| --- | --- | --- | --- |
| Documented in assigned sources | No. Neither mcp.md nor channels-reference.md mentions plugin monitors (grep `monitor` hits only prose about "monitoring alerts", mcp.md L11, L20, L392; channels-reference L15, L35, L57). Facts must come from the plugins-reference note. | Yes, fully (channels-reference.md whole). | No. Hook delivery is in hooks.md (other note); mcp.md only says server instructions and tool names load at session start (L1407) and a late-connecting server's tool names reach Claude on its next request in the same turn (L306). |
| Status | Not found in docs | "research preview" (L10); registration notice says "Channels (experimental)" (L147) | Not found in docs |
| Extra launch flag needed | Not found in docs | Yes: `--channels plugin:<name>@<marketplace>` for allowlisted, plus `--dangerously-load-development-channels plugin:...` for anything not on the Anthropic allowlist (L777-L779); a full-screen warning dialog on every launch (L141) | Not found in docs |
| Org gating | Not found in docs | `channelsEnabled` policy; Team/Enterprise must enable (L10, L189); `allowedChannelPlugins` (L781) | Not found in docs |
| Delivery timing | Not found in docs | Queued; "If several notifications arrive while Claude is busy, they're delivered together on the next turn" (L254); no ack, silent drop if not registered (L250) | Not found in docs |
| Presentation to Claude | Not found in docs | `<channel source="<server-name>" k="v">body</channel>` (L245-L247); `meta` keys identifiers only (L228); terminal shows a one-line `← source: ...` summary (L163) | Not found in docs |
| Trust label added by Claude Code | Not found in docs | None documented; gating is the server's job (L420) | Not found in docs |
| Runtime requirement | Not found in docs | `@modelcontextprotocol/sdk` + Node/Bun/Deno (L43); stdio subprocess on same machine (L32) | Not found in docs |
| Reply path | Not found in docs | Standard MCP tool, subject to permission prompt (L258, L761) | Not found in docs |
| Windows/headless | Not found in docs | Not found in docs | Not found in docs |

## Implications for Synchrobuilder

1. If the plugin ships an MCP server, its tools are addressed as `mcp__plugin_synchrobuilder_<server>__<tool>` and the server as `plugin:synchrobuilder:<server>` (mcp.md L498-L506). Hook matchers must use the full form. Choose a short server key to keep names readable.
2. A plugin MCP server starts automatically when the plugin is enabled (mcp.md L444, L483); the `.mcp.json` "New MCP server found" consent dialog is documented only for project-scope `.mcp.json` (mcp.md L575; channels-reference L143). This is the mechanism through which a plugin could run a persistent background process (the sync loop) without the user running anything, but it costs a Node process per session and startup connects in the background (mcp.md L1490).
3. `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PROJECT_DIR}` are substituted in `command`, `args`, `env` of plugin stdio servers (mcp.md L488-L489), so `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs"]` fits the Node-ESM-only principle. `CLAUDE_PROJECT_DIR` is also set in the server's environment (L115).
4. Stdio servers are not reconnected automatically ("Claude Code doesn't reconnect them automatically", mcp.md L361), and the stdio idle timeout is 30 min per tool call (L415; a per-server `timeout` >= 1000 ms raises that floor, L413). A long-lived sync loop must not be modelled as a single blocking tool call; run it as an independent timer inside the server process, which channels explicitly allow (channels-reference L94-L110 run an HTTP listener in-process).
5. Channels are the only documented mechanism in these two pages for pushing a teammate message into the session between prompts, but they require per-launch `--channels`, are research preview, and any plugin outside `claude-plugins-official` additionally needs `--dangerously-load-development-channels` with a full-screen warning (L141, L779), unless a Team/Enterprise admin lists it in the organization's `allowedChannelPlugins`, "which replaces the default Anthropic allowlist" (L781). They also queue until the next turn (L254), so "sooner than next prompt" is bounded by the current turn ending.
6. Server `instructions` (max 2KB, mcp.md L1423) are the documented place to tell Claude how to read `<channel source="synchrobuilder" ...>` events and that the body is teammate text; Claude Code adds no untrusted label itself (section 2.4).
7. `meta` keys must be identifier-only (L228): use `from_handle`, `kind`, `file`, not `from-handle`.
8. `_meta["anthropic/requiresUserInteraction"]: true` (mcp.md L1323, v2.1.199+) is the documented way to force a human prompt on a consent-type tool (e.g. a tool that changes the machine), matching the "consent before changing a machine" principle; the local CLI (2.1.218, verified) is past the v2.1.199 threshold. Note the headless caveat: with `--permission-prompt-tool` an `allow` is converted to a deny (L1327), so a flagged tool is unusable in `claude -p` runs that rely on that flag.
9. MCP prompts appear as `/servername:promptname (MCP)` (mcp.md L1500). Whether a plugin server key yields a short prefix such as `/sb:audit` is undocumented (section 1.6).
10. Tool descriptions and server instructions are truncated at 2KB (mcp.md L1423); outputs above 25,000 tokens are spilled to a file (L1260-L1262), well above the 6 KB digest cap.
11. Tool search defers MCP tools by default (L1427); a tool Claude must see on every turn needs `alwaysLoad` (L1472, L1488), which makes startup wait up to 5 s for the server (L1490).

## Conflicts with the brief

| Brief says | Docs say | Source |
| --- | --- | --- |
| "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)" | Plugin monitors are not described in mcp.md or channels-reference.md; the only push mechanism documented here is a channel, which delivers "on the next turn" when Claude is busy, not mid-turn. | channels-reference.md L254; grep in section 3 |
| Zero-friction install: "/plugin marketplace add" then "/plugin install" | If the push path is a channel, every session must also be started with `--channels plugin:synchrobuilder@<marketplace>` and, because the plugin is not in `claude-plugins-official`, `--dangerously-load-development-channels`, with a full-screen warning dialog each launch. The only documented alternative is a Team/Enterprise admin adding the plugin to `allowedChannelPlugins`. | channels-reference.md L141, L777-L781 |
| "advisory not blocking", "no bash anywhere" | Channels themselves are fine with Node (L43), but Team/Enterprise orgs must enable `channelsEnabled`; otherwise events are dropped silently with no error to the server. | channels-reference.md L10, L189, L250 |
| "teammate text is untrusted data wrapped in a labeled block" | Claude Code wraps channel events only in `<channel source=...>`; it adds no untrusted marker. The wrapper text must come from Synchrobuilder itself (content or instructions). | channels-reference.md L242-L248, L420 |
| ".mcp.json only if Phase 0 shows MCP tools are the right mechanism" | A plugin `.mcp.json` at plugin root is the documented way to bundle a server; note the plugin's server tool names carry the `mcp__plugin_synchrobuilder_` prefix, so any hook matcher or allow rule written against a bare server key never fires. | mcp.md L443, L498-L504 |
| Short command prefix (/sb:audit) | MCP prompts are listed as `/servername:promptname (MCP)`; nothing says whether a plugin server's `servername` is the bare key or a plugin-scoped name. Not a confirmed route to a shorter prefix. | mcp.md L1500, L1528 |
| "hooks ... under 50 ms" and "one writer per file, sync every 30-60 s" | Not contradicted, but an MCP server as the sync process is an extra long-lived subprocess per session; stdio servers are not auto-reconnected if it crashes. | mcp.md L361 |

## Open questions

1. What does the `/` menu show for a prompt exposed by a plugin-bundled server: `/sb:audit`, `/plugin:synchrobuilder:sb:audit`, or `/mcp__plugin_synchrobuilder_sb__audit`? (mcp.md L1500 vs L498; undocumented.) Needs an experiment on v2.1.218.
2. Does Claude Code v2.1.218 accept `--channels plugin:synchrobuilder@<marketplace>` for a marketplace-installed plugin, and does `--dangerously-load-development-channels plugin:...` require the plugin to be enabled first? Which flag ordering works?
3. Is a channel event delivered while Claude is idle (no turn running) immediately, or only when the user sends the next prompt? L254 covers only the "busy" case.
4. Does a channel server registered via the plugin's `.mcp.json` get the "New MCP server found" consent dialog (documented only for project `.mcp.json`, L143) or start silently (mcp.md L444)?
5. Is `${CLAUDE_PLUGIN_DATA}` created before the server is spawned, and is it per-plugin or per-plugin-per-project? (mcp.md L488 only names it.)
6. On Windows, does `"command": "node"` resolve without a `cmd /c` wrapper for plugin stdio servers? (No Windows guidance found in mcp.md.)
7. Does a plugin stdio server keep running between turns so an in-process 30-60 s sync timer can run, and is it killed on session exit? (Lifecycle at L482-L487 covers connect/disconnect, not idle behaviour.)
8. In `claude -p` / headless runs, are channels registered at all, and does the dev-flag warning dialog block startup? Nothing in channels-reference.md addresses headless.
9. Does the `<channel>` body get any additional system framing (e.g. an untrusted-content notice) visible in `--debug` transcripts? The docs show only the tag (L245-L247).
10. With tool search on, does the channel's `instructions` string reach Claude at session start even though its tools are deferred? (mcp.md L1407 says "Only tool names and server instructions load at session start"; confirm the 2KB truncation on a real instructions string.)
