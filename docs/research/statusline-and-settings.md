# Status line and settings: what a plugin can and cannot drive

## Source

- https://code.claude.com/docs/en/statusline (raw: `statusline.md`, 1187 lines)
- https://code.claude.com/docs/en/settings (raw: `settings.md`, 762 lines)
- https://code.claude.com/docs/en/settings-reference (raw: `settings-reference.md`, 6035 lines)
- Cross-check only: https://code.claude.com/docs/en/plugins (`plugins.md` L267-L279) and https://code.claude.com/docs/en/plugins-reference (`plugins-reference.md` L955)

Fetched 2026-09-18, raw Markdown downloaded from code.claude.com/docs/en/<page>.md. The highest version marker in these three files is v2.1.274 (`grep -o 'v2\.1\.[0-9]*'` over the raw files); `npm view @anthropic-ai/claude-code version` returned 2.1.276 on 2026-09-18, and the local CLI (`claude --version`) is 2.1.218.

Line numbers refer to the raw files (4-line index preamble, title on line 5).

---

## 1. statusLine: schema, stdin data, refresh, output

### 1.1 Setting schema

Reference entry (settings-reference.md L3374-L3394):

> Run your own command to render a [status line] below the prompt with context such as the model, cost, or git branch. Optional fields adjust spacing, add periodic re-runs, and hide the built-in vim mode indicator when your script renders `vim.mode` itself. (L3376)

> * **Scope**: `Any file`. When `allowManagedHooksOnly` is on, or `disableAllHooks` is set outside managed settings, only the managed settings value runs.
> * **Type**: object with `type` set to `"command"` and a `command` string, plus optional `padding` as a number of characters, `refreshInterval` as a number of seconds, minimum `1`, and `hideVimModeIndicator` as a Boolean
> * **Default**: unset, so no status line (L3378-L3380)

```json
{
  "statusLine": {
    "type": "command",
    "command": "jq -r '\"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)% context\"'",
    "padding": 2
  }
}
```
(L3384-L3392)

Field semantics from statusline.md:

- `command` "runs in a shell, so you can also use inline commands instead of a script file" (L56). File-path form: `"command": "~/.claude/statusline.sh"` (L46-L54).
- `padding`: "adds extra horizontal spacing (in characters) to the status line content. Defaults to `0`. This padding is in addition to the interface's built-in spacing" (L67).
- `refreshInterval`:
  > The optional `refreshInterval` field re-runs your command every N seconds in addition to the event-driven updates. The minimum is `1`. Set this when your status line shows time-based data such as a clock, or when background subagents change git state while the main session is idle. Leave it unset to run only on events. (L69)
- `hideVimModeIndicator`: "suppresses the built-in `-- INSERT --` text below the prompt. Set this to `true` when your script renders `vim.mode` itself" (L71).

### 1.2 Where the setting can live and /statusline

> Add a `statusLine` field to your user settings (`~/.claude/settings.json`, where `~` is your home directory) or project settings. (statusline.md L44)

> The `/statusline` command accepts natural language instructions describing what you want displayed. Claude Code generates a script file in `~/.claude/` and updates your settings automatically (L34)

Disable: "Run `/statusline` and ask it to remove or clear your status line (e.g., `/statusline delete`, `/statusline clear`, `/statusline remove it`). You can also manually delete the `statusLine` field from your settings.json." (L75)

Settings reload: "Claude Code reloads settings automatically and runs your script as soon as you save the file." (L126)

### 1.3 When it re-runs, debounce, cancellation

> Your script runs once when a session starts, including when you resume one. After that, it runs again when: (L141)
> * A new assistant message arrives
> * `/compact` finishes
> * The permission mode changes
> * Vim mode toggles
> * You change the `command` in your `statusLine` settings
> * A `refreshInterval` timer elapses, if you set one
> * A rate-limit window in the data your script last received reaches its `resets_at` time
> * A warm prompt cache in the data your script last received reaches its `expires_at` time (L143-L150)

> Claude Code debounces updates at 300ms, so rapid changes batch together and your script runs once after the changes stop. A change to the `command` itself skips the debounce: Claude Code runs the new command right away. If a new update triggers while your script is still running, Claude Code cancels the in-flight script. If you edit your script, the changes appear the next time an update trigger re-runs it. (L152)

> The event-driven triggers can go quiet when the main session is idle, for example while a coordinator waits on background subagents. To keep time-based or externally-sourced segments current during idle periods, set `refreshInterval` to also re-run the command on a fixed timer. (L154)

Note: the trigger list does not include user prompt submission, tool calls, hook events, or external file changes (L141-L150). The docs present the list as the set of re-run triggers ("After that, it runs again when:", L141) but do not separately state that nothing outside it triggers a run.

### 1.4 Output: multi-line, ANSI, OSC 8, COLUMNS/LINES

- "**Multiple lines**: each `echo` or `print` statement displays as a separate row." (L158)
- "**Colors**: use ANSI escape codes like `\033[32m` for green (terminal must support them)." (L159)
- "**Links**: use OSC 8 escape sequences to make text clickable (Cmd+click on macOS, Ctrl+click on Windows/Linux). Requires a terminal that supports hyperlinks like iTerm2, Kitty, or WezTerm." (L160)
- > Claude Code captures your script's output instead of connecting it directly to the terminal, so `tput cols` and language-level width detection cannot read the terminal size from inside the script. Read the `COLUMNS` and `LINES` environment variables instead. Claude Code sets these to the current terminal dimensions before running your script. (L164)
- > The status line runs locally and does not consume API tokens. It temporarily hides during certain UI interactions, including autocomplete suggestions, the help menu, and permission prompts. (L166)
- Layout: "The status line renders in its own row above the built-in footer badges and does not replace them. With a custom status line configured, Claude Code stops showing most of the footer's keyboard hints" (L18).
- Notifications share the row outside fullscreen: "System notifications like MCP server errors and auto-updates display on the right side of the row" and "On narrow terminals, these notifications may truncate your status line output" (L1183-L1187).
- Troubleshooting: "Scripts that exit with non-zero codes or produce no output cause the status line to go blank" and "Slow scripts block the status line from updating until they complete." (L1176-L1177). "Multi-line status lines with escape codes are more prone to rendering issues than single-line plain text" (L1167). Terminal.app does not support OSC 8; `FORCE_HYPERLINK=1 claude` overrides detection (L1145-L1151).
- Tips: "Keep output short: the status bar has limited width" (L1112); mock-input test command at L1111.

### 1.5 stdin JSON data fields (statusline.md L172-L212)

| Field | Description (verbatim or condensed) | Line |
|---|---|---|
| `model.id`, `model.display_name` | Current model identifier and display name | L174 |
| `cwd`, `workspace.current_dir` | Same value; `workspace.current_dir` preferred | L175 |
| `workspace.project_dir` | Directory where Claude Code was launched | L176 |
| `workspace.added_dirs` | Directories added via `/add-dir` or `--add-dir`; empty array if none | L177 |
| `workspace.git_worktree` | Worktree name inside a linked worktree; absent in main working tree | L178 |
| `workspace.repo.host/owner/name` | "Repository identity parsed from the `origin` remote ... Absent outside a git repository or when no `origin` remote is configured" ; "Before v2.1.260, `workspace.repo` was absent for" gitlab subgroup projects | L179 |
| `cost.total_cost_usd` | Estimated session cost; "Resets to $0 when `/clear` starts a new session. Before v2.1.211, the total carried over after `/clear`" | L180 |
| `cost.total_duration_ms`, `cost.total_api_duration_ms` | Wall-clock and API wait time in ms | L181-L182 |
| `cost.total_lines_added`, `cost.total_lines_removed` | Lines of code changed | L183 |
| `context_window.total_input_tokens`, `total_output_tokens` | From most recent API response; input includes cache reads and writes | L184 |
| `context_window.context_window_size` | "200000 by default, or 1000000 for models with extended context" | L185 |
| `context_window.used_percentage`, `remaining_percentage` | Pre-calculated | L186-L187 |
| `context_window.current_usage` | Per-component token counts; `null` before first API call and after `/compact` | L188, L344, L370 |
| `exceeds_200k_tokens` | Fixed 200k threshold regardless of window size | L189 |
| `fast_mode`, `effort.level`, `thinking.enabled` | Session flags | L190-L192 |
| `rate_limits.five_hour/seven_day.used_percentage/resets_at` | "appears only for claude.ai Pro and Max subscribers, or behind a Claude apps gateway that sets a spend limit for you, and only after the first API response in the session"; each window may be independently absent, and a window is dropped once its `resets_at` passes | L193-L194, L339 |
| `rate_limits.spend_limit.*` | Claude apps gateway; "Requires Claude Code v2.1.251 or later" | L195 |
| `prompt_cache` | "Requires Claude Code v2.1.251 or later" | L196, L376 |
| `session_id` | Unique session identifier | L197 |
| `session_name` | Custom `--name`/`/rename` or AI title; default display name such as `my-app-3f` does not populate it | L198 |
| `prompt_id` | "Requires Claude Code v2.1.196 or later"; absent until first user input | L199 |
| `transcript_path` | Path to conversation transcript file | L200 |
| `version` | Claude Code version | L201 |
| `output_style.name`, `vim.mode`, `agent.name` | Misc | L202-L204 |
| `pr.number`, `pr.url`, `pr.review_state`, `pr.kind` | Open PR/MR for current branch; MR data "requires Claude Code v2.1.234 or later" | L205-L207 |
| `worktree.name/path/branch/original_cwd/original_branch` | Only in a worktree session | L208-L212 |

**No plain git branch field.** The table has no `git.branch`/`branch` field for the current checkout; only `worktree.branch` (worktree sessions) and `workspace.git_worktree` exist (L178, L210). Every branch-showing example runs `git branch --show-current` itself (L510, L677, L928). Searched for "branch" across the whole file.

Full JSON schema is at L216-L326 (fence opens at L216; copied fields above; the `prompt_cache` sub-object is L264-L285). Fields that may be absent: L328-L340; fields that may be `null`: L342-L345. "Handle missing fields with conditional access and null values with fallback defaults in your scripts." (L347)

### 1.6 "Cache expensive operations" example (L897-L1029)

> Your status line script runs frequently during active sessions. Commands like `git status` or `git diff` can be slow, especially in large repositories. This example caches git information to a temp file and only refreshes it every 5 seconds. (L899)

> The cache filename needs to be stable across status line invocations within a session, but unique across sessions so concurrent sessions in different repositories don't read each other's cached git state. Process-based identifiers like `$$`, `os.getpid()`, or `process.pid` change on every invocation and defeat the cache. Use the `session_id` from the JSON input instead: it's stable for the lifetime of a session and unique per session. (L901)

Node.js version, verbatim (L986-L1028):

```javascript
#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
    const data = JSON.parse(input);
    const model = data.model.display_name;
    const dir = path.basename(data.workspace.current_dir);
    const sessionId = data.session_id;

    const CACHE_FILE = `/tmp/statusline-git-cache-${sessionId}`;
    const CACHE_MAX_AGE = 5; // seconds

    const cacheIsStale = () => {
        if (!fs.existsSync(CACHE_FILE)) return true;
        return (Date.now() / 1000) - fs.statSync(CACHE_FILE).mtimeMs / 1000 > CACHE_MAX_AGE;
    };

    if (cacheIsStale()) {
        try {
            execSync('git rev-parse --git-dir', { stdio: 'ignore' });
            const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
            const staged = execSync('git diff --cached --numstat', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
            const modified = execSync('git diff --numstat', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
            fs.writeFileSync(CACHE_FILE, `${branch}|${staged}|${modified}`);
        } catch {
            fs.writeFileSync(CACHE_FILE, '||');
        }
    }

    const [branch, staged, modified] = fs.readFileSync(CACHE_FILE, 'utf8').trim().split('|');

    if (branch) {
        console.log(`[${model}] 📁 ${dir} | 🌿 ${branch} +${staged} ~${modified}`);
    } else {
        console.log(`[${model}] 📁 ${dir}`);
    }
});
```

The docs' Node examples use CommonJS `require` with a `#!/usr/bin/env node` shebang (L986-L990); no `.mjs`/ESM example exists. Examples note "Save the script to a file like `~/.claude/statusline.sh` (or `.py`/`.js`)" (L414).

### 1.7 Windows configuration (L1031-L1084)

> On Windows, Claude Code runs status line commands through Git Bash when Git Bash is installed, or through PowerShell when Git Bash is absent. (L1033)

> Git Bash treats unquoted backslashes as escape characters, so a Windows-style path such as `C:\Users\username\script.mjs` reaches the script runner with its separators removed and the command fails without a visible error. Write file paths in the `command` string with forward slashes, as shown in the examples below. The `~` shorthand also works and expands to your Windows home directory. (L1035)

PowerShell form: `"command": "powershell -NoProfile -File C:/Users/username/.claude/statusline.ps1"` (L1044); "This works whether Claude Code routes the command through Git Bash or PowerShell" (L1037). Troubleshooting repeats: use forward slashes (L1124).

### 1.8 Subagent status lines (L1086-L1107; settings-reference L3396-L3413)

> The `subagentStatusLine` setting renders a custom row body for each subagent shown in the agent panel below the prompt. (L1088)

```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  }
}
```
(L1090-L1097)

> The command runs once per refresh tick and receives all visible subagent rows as a single JSON object on stdin. The input includes the base hook fields, a `columns` field with the usable row width, and a `tasks` array. Each task has `id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `model`, `effort`, `contextWindowSize`, `tokenCount`, `tokenSamples`, and `cwd`. (L1099)

`model`/`contextWindowSize` "require Claude Code v2.1.205 or later" (L1101); `effort` "requires Claude Code v2.1.214 or later" (L1103).

> Write one JSON line to stdout per row you want to override, in the form `{"id": "<task id>", "content": "<row body>"}`. The `content` string is rendered as-is, including ANSI colors and OSC 8 hyperlinks. Omit a task's `id` to keep the default rendering for that row; emit an empty `content` string to hide it. (L1105)

> The same trust, `disableAllHooks`, and `allowManagedHooksOnly` gates that apply to `statusLine` apply here. Plugins can ship a default `subagentStatusLine` in their `settings.json`, but unlike hooks, plugin values don't run under `allowManagedHooksOnly` even when the plugin is force-enabled in managed settings `enabledPlugins`. (L1107)

Reference: Scope `Any file`, with the same gate sentence as `statusLine` ("When `allowManagedHooksOnly` is on, or `disableAllHooks` is set outside managed settings, only the managed settings value runs"); "Type: object with `type` set to `"command"` and a `command` string"; "Default: unset, so Claude Code renders the default rows" (settings-reference L3400-L3402). The reference example is an inline `jq -c '.tasks[] | {id, content: ...}'` command (L3404-L3410).

---

## 2. Who can set statusLine; can a plugin drive it?

- `statusLine` scope is `Any file` (settings-reference L3378; index L785), i.e. user, project, local, managed (index definition L578). statusline.md names user or project settings (L44).
- Plugin default settings are limited: "Plugins can include a `settings.json` file at the plugin root to apply default configuration when the plugin is enabled. Currently, only the `agent` and `subagentStatusLine` keys are supported." (plugins.md L269). "Unknown keys are silently ignored." (plugins.md L279). Plugins-reference agrees: "Only the `agent` and `subagentStatusLine` keys are supported" (plugins-reference.md L955). statusline.md confirms plugins can ship `subagentStatusLine` (L1107) and never mentions plugins shipping `statusLine` (searched "plugin": only L1107).
- Trust gate: > Because `statusLine` executes a shell command, Claude Code runs it under the same workspace trust rule as hooks in settings files. ... Until then, the status line stays blank, and `claude --debug` logs `Status line command skipped: workspace trust not accepted`. (statusline.md L1171-L1172)
- Gates (settings-reference L3892-L3899): "Off entirely: when managed settings set `disableAllHooks`, or when the folder isn't trusted"; "Narrowed to managed settings: when `allowManagedHooksOnly` is set, when `disableAllHooks` is `true` outside managed settings after settings precedence applies, or when you start Claude Code with `--safe-mode`"; "Under narrowing, Claude Code runs a managed value if one is deployed. Otherwise it skips your value without warning: the status line is disabled".
- Single value, not a list: `statusLine` is an object (L3379). The docs describe merging for list keys (settings.md L644) and for specific keys whose entries say so, such as `hooks` (settings-reference L3941) and `extraKnownMarketplaces` per marketplace name (L4518); the `statusLine` entry says nothing about merging, so the general rule applies: "Claude Code uses the value from the highest level that sets it" (settings.md L626). Whichever file wins precedence supplies the whole command; there is no documented "add a segment" mechanism.

**Conclusion.** A plugin cannot drive the main status line by itself. The only plugin-shippable status-line key is `subagentStatusLine` (rows in the subagent panel), and even that is skipped under `allowManagedHooksOnly` (L1107). To show presence in the main status line, Synchrobuilder must write a `statusLine` value into one of the user's settings files (user, project, or local), which requires consent and displaces any status line the user already has. `/statusline` is a built-in natural-language command that generates a script in `~/.claude/` and edits settings (L34); the docs do not say plugins can extend or hook it.

---

## 3. settings.md: files, precedence, merging, what to commit, reload

### 3.1 Files and scope (settings.md L403-L408, L424-L427)

| Scope | File | Who it affects | Use it for |
|---|---|---|---|
| User | `~/.claude/settings.json` | You, in every project on this machine | Personal preferences (L405) |
| Shared project | `.claude/settings.json` | "Everyone working in the folder that contains it. In a git repository, commit it so teammates get it" | "Team permissions, hooks, plugins, and the environment variables the project needs" (L406) |
| Project local | `.claude/settings.local.json` | "You, in this one project only. Claude Code keeps it out of git when it creates the file; if you create it by hand, add it to `.gitignore` yourself" | "Personal overrides for one project, and testing before you share" (L407) |
| Managed | `managed-settings.json` and other managed sources | "nothing you set overrides it, apart from a few security-sensitive exceptions" | Security policy (L408) |

Extra: `~/.claude.json` is a fifth file Claude Code writes for itself, holding the sign-in session, MCP server configurations, per-project state such as trust decisions, and the global config keys `/config` writes (L443). Windows: `~/.claude` is `%USERPROFILE%\.claude`; `CLAUDE_CONFIG_DIR` relocates settings, sessions, plugins (L440). Installing creates no settings file (L433).

Local file placement: > If you start Claude Code in a subdirectory of a git repository, it reads and writes that file at the repository root ... In a worktree, it uses the file at the main checkout's root. (L477) Exceptions (outside git, home-dir root, Windows, ownership mismatch): L481. "Before v2.1.211, Claude Code kept the file in the starting directory." (L484) Shared `.claude/settings.json` is read from the session's primary working directory, "so to use a file committed at the repository root, start Claude Code there"; `/cd` re-reading "requires Claude Code v2.1.246 or later" (L486).

Gitignore: > The first time Claude Code writes the file in a git repository that doesn't already ignore it, it adds `**/.claude/settings.local.json` to your global git excludes file (L466). "Its allow rules don't wait for trust while the file stays untracked. ... If the file is tracked by git, the trust step applies to it too" (L467).

### 3.2 Precedence (L626-L640)

> 1. **Managed settings** ... Nothing you set overrides them: a key you pass with `--settings` doesn't override the same managed key (L632)
> 2. **Command line arguments** ... `--settings <file-or-json>` ... takes a key you set here over the same key in local, project, or user settings, and keeps the lower-level value for a key you omit. (L633)
> 3. **Project local settings** (`.claude/settings.local.json`) (L634)
> 4. **Shared project settings** (`.claude/settings.json`) (L635)
> 5. **User settings** (`~/.claude/settings.json`) (L636)

So managed > CLI > local > project > user. "Environment variables aren't a level in this stack ... An `env` block inside a settings file is an ordinary key and follows the levels above." (L638) `--settings` "can set any key your user settings file can set; it can't set `Managed` or `Global config` keys" (L566).

### 3.3 Lists merge (L642-L649)

> When you set the same list key, such as `permissions.allow`, in more than one file, Claude Code combines the lists instead of picking one, so each file can add entries without removing another file's. (L644)

Exceptions: `fallbackModel`, `modelPicker` (v2.1.242+), `availableModels`, `modelSettings` (L646-L649). Hooks specifically: "Hooks merge across files rather than replacing each other, and hooks from managed settings can't be removed from other files." (settings-reference L3941). `allowedHttpHookUrls` and `httpHookAllowedEnvVars`: "Arrays merge across settings files." (L3824, L3968). `extraKnownMarketplaces` same-name entries: highest-precedence file wins whole; "Before v2.1.228, Claude Code merged same-name entries field by field" (L4518).

### 3.4 Safe to commit vs local; trust

> Commit `.claude/settings.json` so everyone who clones the repository gets the same permissions, hooks, telemetry, and plugins. Each teammate can still override it for themselves in their own `.claude/settings.local.json` (L447)

> **The key waits for trust.** `permissions.allow` rules, `permissions.additionalDirectories`, `extraKnownMarketplaces`, and most `env` values apply only after each teammate trusts the folder. Until then they still see prompts and don't get plugins from a marketplace the file declares. `deny` and `ask` rules apply right away. (L717)

> **Claude Code ignores the key in a repository file.** Look for `User, local, or managed`, `User or managed`, `Managed`, or `Global config` in the Scope column of the settings index. Those keys never apply from the shared file (L716)

`permissions.defaultMode` values `auto` and `bypassPermissions` "don't take effect from project or local settings ... Before v2.1.257, `bypassPermissions` took effect from any file." (L699). Security keys where a stricter value wins from any scope: table L730-L740 (includes `isolatePeerMachines` true from any scope, `crossSessionInbound` stricter from project/local, `syncClaudeAiPlugins` false from user/local/managed but not project).

Cloud sessions: user and local files "not read"; shared project file read in single-repo sessions; multi-repo sessions load "only the plugins and marketplaces the file declares, not permission rules, hooks, `env`, or other keys" (L748-L749).

### 3.5 When edits take effect (L582-L591)

> Claude Code watches your settings files and reloads them when they change, so it applies most edits to the running session without a restart, including edits to `permissions`, `hooks`, and credential helpers such as `apiKeyHelper`. Claude Code also loads a settings file you create mid-session if its folder existed when the session started. For the project's `.claude/` folder, it loads the file even when you create the folder in the same session. (L584)

> The reload covers user, project, local, and managed settings, and Claude Code runs the `ConfigChange` hook for each settings-file change it detects, not for managed settings that arrive from MDM or the claude.ai console. (L586)

Those managed sources "reach a running session on a schedule rather than on save" (L586).

Some keys are read once at start (`model`, `effortLevel`, `modelSettings` listed; L588-L591). Broken JSON: "Settings files are strict JSON: a `//` comment or a trailing comma is a syntax error" (L536); a Settings Error dialog offers fix/exit/continue; a Settings Warning skips bad entries "such as a malformed permission rule or an unknown hook event name" (L607-L608). `/status` shows `Setting sources`; `claude doctor` lists rejected entries (L599-L601). `$schema`: `https://json.schemastore.org/claude-code-settings.json` (L540).

---

## 4. settings-reference entries (verbatim definitions)

Scope legend: "`User` is `~/.claude/settings.json`, `Project` is `.claude/settings.json`, `Local` is `.claude/settings.local.json`, and `Managed` is what your organization deploys. `Any file` means all four, and `Global config` means `~/.claude.json`" (L578).

**`statusLine`** and **`subagentStatusLine`**: see section 1.1 and 1.8 (L3374-L3413).

**`hooks`** (L3937-L3962)
> * **Scope**: `Any file`. Hooks merge across files rather than replacing each other, and hooks from managed settings can't be removed from other files.
> * **Type**: object keyed by hook event; each value is an array of `{ "matcher", "hooks" }` groups whose `hooks` entries have a `type` of `"command"`, `"prompt"`, `"agent"`, `"http"`, or `"mcp_tool"`
> * **Default**: unset, so no hooks run (L3941-L3943)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "~/.claude/hooks/check-bash.sh" }
        ]
      }
    ]
  }
}
```
(L3947-L3960)

**`disableAllHooks`** (L3867-L3899)
> Turn off hooks, any custom status line, and any custom file suggestion command. Use it to turn all of these off temporarily without deleting them from your settings. (L3869)
> * **Scope**: `Any file`. Only managed settings can disable managed hooks.
> * **Type**: Boolean ... **Default**: unset, so hooks run (L3871-L3875)
> * **In managed settings**: Claude Code disables every configured hook, including managed ones, and keeps running the hooks the Agent SDK registers in process
> * **In any other settings file**: Claude Code disables user, project, local, and plugin hooks; managed hooks, Agent SDK hooks, and hooks from plugins force-enabled in managed `enabledPlugins` keep running (L3885-L3886)

"Keeping Agent SDK hooks running when managed settings set this key requires Claude Code v2.1.242 or later." (L3888) The status-line/file-suggestion gates are L3892-L3899 (quoted in section 2).

**`allowManagedHooksOnly`** (L3838-L3865): Scope `Managed`; `true`: "only managed hooks run, plus Agent SDK hooks and hooks from plugins your managed settings force-enable"; Default unset (L3842-L3846). Under it: "Force-enabled plugin hooks run ... Claude Code matches on the full `plugin@marketplace` ID"; "Everything else is blocked: user, project, and local hooks, hooks from other plugins, and hooks declared in agent frontmatter"; "Status line and file suggestion narrow to managed settings" (L3859-L3863).

**`allowedHttpHookUrls`** (L3820-L3836): Scope `Any file`, arrays merge; "array of URL patterns, with `*` as a wildcard"; default unset "so any URL is allowed"; "an empty array blocks every HTTP hook" (L3822-L3826). **`httpHookAllowedEnvVars`** (L3964-L3980): Scope `Any file`, arrays merge; outer limit on a hook's own `allowedEnvVars`; default unset (L3968-L3970).

**`enabledPlugins`** (L4454-L4483)
> Turn individual plugins on or off, keyed by `plugin-name@marketplace-name`. A plugin with no entry at any scope falls back to its `defaultEnabled` value. When you enable or disable a plugin with `/plugin` or `claude plugin enable`, Claude Code writes this key for you. (L4456)
> * **Scope**: `Any file` ... **Type**: object mapping `plugin-name@marketplace-name` to a Boolean ... **Default**: unset, so each plugin follows its `defaultEnabled` value (L4458-L4460)

```json
{
  "enabledPlugins": {
    "code-formatter@team-tools": true,
    "deployment-tools@team-tools": true,
    "experimental-features@personal": false
  }
}
```
(L4464-L4472)

> Project settings take precedence over user settings, so setting a plugin to `false` in `~/.claude/settings.json` doesn't disable a plugin that the project's `.claude/settings.json` enables. To opt out of a project-enabled plugin on your machine, set it to `false` in `.claude/settings.local.json` instead. (L4481)

> Enabling a plugin from an external source such as a GitHub repository or npm package in a project's `.claude/settings.json` doesn't install it for other people. On every path that loads plugins, Claude Code reports the plugin as not installed until each user installs it themselves. (L4483)

Managed `false` "is blocked from installation at every scope and hidden from the marketplace" (L4479).

**`extraKnownMarketplaces`** (L4485-L4583)
> * **Scope**: `Any file`. Claude Code honors entries in a repository's `.claude/settings.json` or `.claude/settings.local.json` only after you accept the workspace trust dialog for that folder; in a folder you haven't trusted, including a `-p` run there, it ignores them without a message.
> * **Type**: object mapping a marketplace name to an object with a `source` object and an optional `autoUpdate` Boolean
> * **Default**: unset (L4489-L4491)

```json
{
  "extraKnownMarketplaces": {
    "acme-tools": {
      "source": {
        "source": "github",
        "repo": "acme-corp/claude-plugins"
      }
    }
  }
}
```
(L4495-L4503, first entry only; the closing braces above are added, and the source's second entry `security-plugins` with a `git` `url` source at L4504-L4509 is omitted)

Source types: `github` (`repo`), `git` (`url`), `url` (`url`, optional `headers`, `headersHelper` v2.1.238+), `file` (`path`), `directory` (`path`, "for development only"), `settings` (inline `name` and `plugins`) (L4524-L4529). `autoUpdate`: "third-party marketplaces default to `false`" (L4516). Alias `additionalMarketplaces` on v2.1.232+ (L4578). LFS content never downloaded; `skipLfs` accepted but no effect; "Before v2.1.274, Claude Code downloaded LFS content unless you set `"skipLfs": true`" (L4533-L4535).

**`pluginConfigs`** (L4585-L4607): Scope `User or managed`; "object mapping a plugin ID to an object with an `options` field ... and an optional `mcpServers` field"; default unset (L4589-L4591). Sensitive options go to Keychain or `~/.claude/.credentials.json` (L4587). "Claude Code ignores project and local entries because it substitutes these values into plugin hook, MCP, and LSP configurations, and a cloned repository must not be able to supply them. Before v2.1.207, project and local settings were also read." (L4607)

**`strictKnownMarketplaces`** (L4241-L4378): Scope `Managed`; "array of marketplace source objects"; "Default: unset, so users can add any marketplace. An empty array is a complete lockdown" (L4245-L4247). Enforced "on marketplace add and on plugin install, update, refresh, and auto-update, before any network or filesystem operation" (L4243). Exact matching includes `ref` and `path` (L4320-L4324); owner wildcards `"owner/*"` need v2.1.223+ (L4295). Alias `allowedMarketplaces` (L4261).

**`blockedMarketplaces`** (L4155-L4173): Scope `Managed`; same source forms; default unset; checked "before download, so they never touch the filesystem" (L4157-L4161).

**`syncClaudeAiPlugins`** (L4112-L4130): Scope `User, local, or managed`, and `--settings`; "A repository can't turn it off for you"; Boolean, only `false` honored; default unset so signed-in sessions sync; "Requires Claude Code v2.1.273 or later" (L4114-L4120). Synced plugins load as `<name>@synced` (L4114). "To turn off one synced plugin rather than all of them, set `"<name>@synced": false` in `enabledPlugins`." (L4122)

**`strictPluginOnlyCustomization`** (L4380-L4452): Scope `Managed`; `true` or array of `"skills"`, `"agents"`, `"hooks"`, `"mcp"`; default unset (L4384-L4386). `.hooks`: "Claude Code stops running hooks from user, project, and local `settings.json`, and keeps running plugin hooks and hooks in managed settings." (L4428) `.mcp`: stops `~/.claude.json` and `.mcp.json` servers, keeps plugin MCP servers, `managed-mcp.json` servers, and `managedMcpServers` (L4442). `.skills` (L4398) and `.agents` (L4412) lock the other two surfaces; all four sub-keys are index rows L787-L791.

Other plugin keys: `disableCommandPluginSources` (Managed; default follows `allowManagedHooksOnly`; v2.1.229+; L4193-L4209), `pluginSuggestionMarketplaces` (Managed; L4211-L4225), `pluginTrustMessage` (Managed; string; L4227-L4239), `allowedChannelPlugins` (Managed; L4132-L4153), `disableSideloadFlags` (Managed; rejects `--plugin-dir`, `--plugin-url`, `--agents`, `--mcp-config`; v2.1.193+; L5656-L5664).

**`permissions`** (L1397-L1418): Scope `Any file`; "object with `allow`, `ask`, `deny`, `additionalDirectories`, `blockReadsOutsideWorkingDirectories`, `defaultMode`, `disableBypassPermissionsMode`, and `disableAutoMode`" (L1401-L1402). Rule syntax `Tool` or `Tool(specifier)`; "Claude Code evaluates `deny` rules first, then `ask`, then `allow`, and the first match decides" (L1459). "Claude Code applies `allow` rules from a project's `.claude/settings.json` only after you accept the workspace trust dialog" (L1455). Table L1463-L1468 lists `Bash`, `Bash(npm run *)`, `Read(./.env)`, `WebFetch(domain:example.com)` only. **Skill rules: Not found in settings-reference** (searched `Skill(` and `Skill`; only `disableBundledSkills`, `disableSkillShellExecution`, `syncClaudeAiSkills` matched). The entry defers to the permissions page for "Agent rules" and tool-specific patterns (L1470).

**`skillOverrides`** (L4067-L4092): Scope `Any file`; "The `/skills` menu writes to `.claude/settings.local.json`"; values `"on"`, `"name-only"`, `"user-invocable-only"`, `"off"`; default unset so every skill is `"on"` (L4071-L4077). "Overrides don't apply to plugin skills, which you manage through `/plugin`." (L4090)

**`env`** (L2749-L2794): Scope `Any file`; "object mapping variable names to string values"; default unset (L2753-L2755). "A value here overwrites the same variable exported in your shell, and when more than one settings file sets a variable, the highest-precedence one applies." (L2770) Timing: "From project and local settings: after you trust the workspace, or at startup in `-p` mode, which never shows the trust dialog" (L2778). Project/local cannot set `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_TMPDIR`, `HOME`, `TMPDIR`, `XDG_*`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, `CLAUDE_CODE_PLUGIN_SEED_DIR`, etc.; "Before v2.1.251, project and local settings could set every variable this list names except `HOME`, `XDG_CONFIG_HOME`, and the variables that change how Claude Code starts or syncs." (L2784-L2790). `CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN` ignored from every file (v2.1.224/v2.1.228+; L2792).

**`cleanupPeriodDays`** (L5565-L5579): Scope `Any file`; "number of days, a whole number, minimum `1`"; "**Default**: `30`" (L5569-L5571). "Setting `0` fails validation, so pick a large value such as `3650` for long retention." (L5579)

**`crossSessionInbound`** (L4811-L4832): "Requires Claude Code v2.1.224 or later" (L4813). Scope `Any file`; "A project or local value applies only when it's stricter than the value managed settings, the `--settings` flag, or user settings give." Values `"accept"`, `"hold"`, `"refuse"`; default unset (L4815-L4820). Unrecognized value in user/project/local/`--settings` makes Claude Code hold inbound messages; in managed settings it is treated as `refuse`; "Before v2.1.248, Claude Code ignored an unrecognized value without warning." (L4830-L4832)

**`isolatePeerMachines`** (L4851-L4867): Scope `Any file`; "A `true` from any scope applies, so a checked-in project file can turn the requirement on but not off." Boolean; default unset so cross-machine messages don't prompt (L4855-L4859). "The cross-machine `SendMessage` approval requires Claude Code v2.1.224 or later." (L4867)

**`agent`** (L4794-L4809): Scope `Any file`; string agent name; default unset; `--agent` overrides; "A plugin's own `settings.json` can also supply this key" (L4809).

**`footerLinksRegexes`** (L3105-L3128, relevant alternative to a status line): Scope `User or managed`; array of `{type:"regex", pattern, url, label}`; renders clickable badges when a regex matches tool results or Claude's responses. Not settable from project files.

---

## 5. Disabling one plugin's hooks; project hooks and trust

- Per-plugin hook disabling: **Not found in docs.** Searched settings-reference and settings.md for "plugin's hooks", "plugin hooks", "hooks from plugins", "per-plugin". The only controls are whole-plugin `enabledPlugins` `false` (L4456-L4481; local file to opt out of a project-enabled plugin, L4481), `disableAllHooks` (disables plugin hooks except force-enabled ones, L3886), and `allowManagedHooksOnly` (blocks "hooks from other plugins", L3860). Nothing lets a user keep a plugin enabled but switch off its hooks.
- Project-settings hooks and trust: settings.md says hooks are among what the shared file carries (L406, L447) and that "Some of what you commit waits until each teammate trusts the folder" (L449), but its explicit trust list names `permissions.allow`, `permissions.additionalDirectories`, `extraKnownMarketplaces`, and `env` (L717), not hooks. The statusline docs state the rule indirectly: `statusLine` runs "under the same workspace trust rule as hooks in settings files" (statusline.md L1171; settings-reference L3896 "the same workspace trust rule as hooks in settings files"), which implies hooks in settings files are trust-gated; the precise rule lives on the permissions page (`#what-runs-before-you-trust-a-folder`), not in these three files.
- Plugin hooks under `strictPluginOnlyCustomization.hooks` keep running while user/project/local hooks stop (L4428), which favors shipping hooks in the plugin rather than in a committed `.claude/settings.json`.

---

## Implications for Synchrobuilder

1. **Presence in the status line requires editing user settings.** A plugin cannot ship `statusLine` (plugins.md L269; plugins-reference L955); only `subagentStatusLine` and `agent` are honored. `/synchrobuilder:setup` could offer, with consent, to write `statusLine` into `~/.claude/settings.json` (or `.claude/settings.local.json`), pointing at `node <plugin path>/statusline.mjs`. That replaces any status line the user already has, since the key is a single object whose entry documents no merging, so the highest-precedence file's value applies whole (settings.md L626, L644; settings-reference L3379). A wrapper that chains the user's previous command is an experiment, not a documented feature.
2. **A status line script must read only the local snapshot.** It runs on every assistant message, on `/compact`, and on every `refreshInterval` tick, is cancelled when a new trigger fires, and a non-zero exit or empty output blanks the row (statusline.md L141-L152, L1176-L1178). Follow the cache pattern keyed by `session_id` (L901), keep to one plain-text line where possible (L1112, L1167), and read `COLUMNS` for width (L164).
3. **Refresh cadence.** Presence changes come from the 30-60 s sync loop; set `refreshInterval` (minimum 1 s, L69) to something like 15-30 s so idle sessions still update (L154). Hooks are not a status-line trigger (L143-L150).
4. **No branch in stdin.** The status line gets no plain git branch field; if presence should show the branch, the script must run git itself or read it from the snapshot the sync loop already wrote (section 1.5).
5. **Windows command form.** Use forward slashes and `node` on PATH: `"command": "node C:/Users/.../statusline.mjs"`; on Windows the command goes through Git Bash or PowerShell (L1033-L1035). A `.mjs` path appears in the docs' own example of what breaks with backslashes (L1035).
6. **Which settings to commit.** `enabledPlugins` and `extraKnownMarketplaces` in `.claude/settings.json` are the documented way to share the plugin with a team (L4477, L4487), but enabling from a GitHub source "doesn't install it for other people" (L4483), and `extraKnownMarketplaces` from a repo file waits for the trust dialog: "in a folder you haven't trusted, including a `-p` run there, it ignores them without a message" (L4489). `/synchrobuilder:ci` in `-p` mode on a fresh, untrusted checkout therefore cannot rely on a repo-declared marketplace; the docs do not say it is ignored in a `-p` run inside an already-trusted folder.
7. **Plugin config values** must go through `pluginConfigs` in user settings; project/local entries are ignored since v2.1.207 (L4607). Team identity mapping belongs in `.synchrobuilder/team.json`, not in settings.
8. **`env` limits.** Project/local `env` cannot set `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PLUGIN_CACHE_DIR`, etc. (L2786-L2788); the audit command should flag such keys as non-portable.
9. **Audit rules from these docs**: strict JSON (no comments/trailing commas, L536); scope-restricted keys never apply from `.claude/settings.json` (L716); `permissions.defaultMode` `auto`/`bypassPermissions` ignored from project/local since v2.1.257 (L699); `cleanupPeriodDays` minimum 1, `0` fails validation (L5570, L5579); `crossSessionInbound` must be one of three strings (L4830).
10. **Doctor checks**: status line blank: one documented cause is trust not accepted (`claude --debug` logs `Status line command skipped: workspace trust not accepted`, L1172), others are a non-zero exit or empty output (L1176); `disableAllHooks` set outside managed (L1125), `allowManagedHooksOnly` narrowing (L1126), `claude --debug` logs the first invocation's exit code and stderr (L1127).
11. **Mute design.** There is no per-plugin hook off-switch (section 5). `/synchrobuilder:mute` must be implemented inside the plugin's own hook scripts (e.g. a local flag file the hooks check), not via settings.

## Conflicts with the brief

| Brief says | Docs say | Source |
|---|---|---|
| "Status line should show presence IF the docs confirm plugins can drive the status line." | Plugins can only ship `agent` and `subagentStatusLine`; `statusLine` must come from a user/project/local/managed settings file. | plugins.md L269; plugins-reference.md L955; settings-reference.md L3378; statusline.md L1107 |
| Hooks/scripts are `.mjs` invoked as `node "<path>"`; no bash anywhere. | `statusLine.command` "runs in a shell" (L56) and on Windows through Git Bash or PowerShell (L1033); a `node ...` command is possible but still shell-launched, and the docs' own Node examples are CommonJS `.js` with `require` (L986-L990). Not a contradiction, but the shell layer is unavoidable for the status line. | statusline.md L56, L986-L1028, L1033-L1035 |
| Hooks before edits and on every prompt must be under 50 ms. | The status line has no documented time budget, but "Slow scripts block the status line from updating" and in-flight scripts are cancelled on the next trigger (L1177-L1178); the 300 ms debounce (L152) is the only timing number. | statusline.md L152, L1177-L1178 |
| `/synchrobuilder:mute` (presumably to silence the plugin's hooks). | No documented way to disable one plugin's hooks while it stays enabled; only `enabledPlugins: false`, `disableAllHooks`, `allowManagedHooksOnly`. | settings-reference.md L3860, L3886, L4481 |
| Install page: `/plugin marketplace add <owner>/<repo>` then `/plugin install synchrobuilder@<marketplace>`. | These three files mention `/plugin marketplace add` (L4378) and `claude plugin marketplace add anthropics/claude-plugins-official` (L4348) and `claude plugin enable` (L4456); the exact `/plugin install` syntax is not in these files (owned by the marketplaces note). | settings-reference.md L4348, L4378, L4456 |
| `.mcp.json` only if needed. | `strictPluginOnlyCustomization.mcp` blocks `.mcp.json` servers but keeps plugin MCP servers (L4442): if MCP is used, ship it in the plugin, not as a repo `.mcp.json`. | settings-reference.md L4442 |

## Open questions

1. Does a `statusLine.command` of the form `node "/abs/path/statusline.mjs"` work on macOS, Linux, and Windows (Git Bash and PowerShell paths) with an ESM file? Docs only show `.sh`, `.py`, CommonJS `.js`, and `.ps1`.
2. What is the actual wall-clock cost of a `node` cold start per status-line refresh on each OS, and does it cause visible lag or cancellation at the 300 ms debounce?
3. Can a plugin-installed status line chain the user's previous `statusLine.command` (read it from settings at setup time and exec it, appending presence) without breaking ANSI/OSC output? Not documented.
4. Does `${CLAUDE_PLUGIN_ROOT}` or any plugin variable expand inside `statusLine.command` written to user settings? These files do not mention it; likely not, so setup must write an absolute path that breaks on plugin update if the install path is versioned.
5. Does the status line re-run when a hook's `additionalContext`/systemMessage arrives, or only on the listed triggers? The trigger list (L141-L150) suggests no; verify.
6. Trust gating of hooks declared in a committed `.claude/settings.json` vs plugin hooks: confirm on a fresh clone in v2.1.218 what runs before the trust dialog (permissions page owns the rule).
7. On v2.1.218 specifically: `pluginConfigs` project/local ignore (v2.1.207+) applies; `crossSessionInbound` warning (v2.1.248) and `env` restrictions (v2.1.251), `permissions.defaultMode` project/local restriction (v2.1.257), `syncClaudeAiPlugins` (v2.1.273), and `workspace.repo` gitlab fix (v2.1.260) do not. Audit rules should be version-aware.
