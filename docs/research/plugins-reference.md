# Research note: Plugins reference (Claude Code)

## Source

- https://code.claude.com/docs/en/plugins-reference — fetched 2026-09-18 as raw Markdown from code.claude.com/docs/en/plugins-reference.md (local copy: 1493 lines; lines 1-4 are an index preamble, content starts at the `# Plugins reference` title on L5).
- The highest version marker in the file is v2.1.273 (L428); the latest npm release on 2026-09-18 is 2.1.276 (`npm view @anthropic-ai/claude-code version`), so behavior added in 2.1.274-2.1.276 is not covered here. The local CLI used for experiments is 2.1.218 (`claude --version`).
- All citations below are `(plugins-reference.md Lx-Ly)`. Table rows are quoted with their column padding collapsed; wording is unchanged.

## 1. plugin.json manifest schema

The manifest is optional: "If omitted, Claude Code auto-discovers components in default locations and derives the plugin name from the directory name." (L453). Complete schema verbatim (L457-L490):

```json
{
  "name": "plugin-name",
  "displayName": "Plugin Name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "metadata": { "catalogId": "cat-123", "tier": "pro" },
  "skills": "./custom/skills/",
  "commands": ["./custom/commands/special.md"],
  "agents": ["./custom/agents/reviewer.md"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json",
  "experimental": {
    "themes": "./themes/",
    "monitors": "./monitors.json",
    "evals": "quality/evals"
  },
  "dependencies": [
    "helper-lib",
    { "name": "secrets-vault", "version": "~2.1.0" }
  ]
}
```

**Required**: "If you include a manifest, `name` is the only required field." (L494). Name rule verbatim (L498):

> `name` | string | Unique identifier in kebab-case, with no spaces, control characters, or bidirectional-formatting characters. When a marketplace entry lists the plugin under a different name, the marketplace entry name is what `enabledPlugins` keys and `/plugin` use | `"deployment-tools"`

> This name is used for namespacing components. For example, in the UI, the agent `agent-creator` for the plugin with name `plugin-dev` will appear as `plugin-dev:agent-creator`. (L500-L502)

**Metadata fields** (L532-L544), key rows verbatim:

> `displayName` | string | Human-readable name shown in the `/plugin` picker and other UI surfaces. For a marketplace-installed plugin, a `displayName` on the marketplace entry takes precedence over this value. When no display name is set in either place, users see `name`. Unlike `name`, may contain spaces and any casing. Not used for namespacing or lookup. (L535)

> `version` | string | Optional. Semantic version. Setting this pins the plugin to that version string, so users only receive updates when you bump it, except for a `command` source or a plugin loaded in place; see Version management. If also set in the marketplace entry, `plugin.json` wins. If omitted, the version comes from the next source in Version management. (L536)

Other metadata fields: `$schema` (ignored at load time, L534), `description`, `author` (object), `homepage`, `repository`, `license` (`"MIT"`, `"Apache-2.0"`), `keywords` (array), `metadata` (free-form object, not read by Claude Code; before v2.1.222 treated as unrecognized, L543), `defaultEnabled` (boolean, defaults `true`, L544). `defaultEnabled: false` ships a plugin that installs disabled (L548). It is only the fallback: a user's `enabledPlugins` entry at any scope takes precedence and "persists across plugin updates and reinstalls", and a dependency requirement writes `true` at install/enable time (L550-L553). The same field in the marketplace entry "takes precedence over the value in `plugin.json`" (L555).

**Component path fields** (L559-L574): `skills` (string|array, "Adds to the default `skills/` scan"), `commands` ("replaces default `commands/`"), `agents` ("replaces default `agents/`"), `workflows` (replaces), `hooks` (string|array|object, "Hook config paths or inline config"), `mcpServers` (string|array|object), `outputStyles` (replaces), `lspServers` (string|array|object), `experimental.themes`, `experimental.monitors`, `experimental.evals`, `userConfig` (object), `channels` (array), `dependencies` (array).

**Adds-to vs replaces** verbatim (L677-L679):

> * **Replaces the default**: `commands`, `agents`, `workflows`, `outputStyles`, `experimental.themes`, `experimental.monitors`. For example, when the manifest specifies `commands`, the default `commands/` directory is not scanned. To keep the default and add more, list it explicitly: `"commands": ["./commands/", "./extras/"]`
> * **Adds to the default**: `skills`. The default `skills/` directory is always scanned, and directories listed in `skills` are loaded alongside it. Exception: for a marketplace entry whose `source` resolves to the marketplace root, declaring specific subdirectories replaces the default `skills/` scan
> * **Own merge rules**: hooks, MCP servers, and LSP servers. See each section for how multiple sources combine

When both a default folder and the manifest key exist, Claude Code warns about the ignored folder in `claude plugin list` and `/plugin` detail view; no warning if the key points into the default folder (L681).

**Path behavior rules** verbatim (L685-L694):

> * All paths must be relative to the plugin root and start with `./`, except that the `skills` field also accepts `"."`
>   * Both `"."` and `"./"` denote the plugin root itself
>   * Before v2.1.221, `"."` failed manifest validation and the plugin didn't load, so use `"./"` to support earlier versions
> * Components from custom paths use the same naming and namespacing rules
> * Multiple paths can be specified as arrays
> * A skill path can point to a directory that contains a `SKILL.md` directly, for example `"skills": ["."]` for the plugin root
>   * Claude Code takes the skill's invocation name from the frontmatter `name` field in `SKILL.md`, so the name stays stable whatever the install directory is named
>   * If `name` isn't set in the frontmatter, Claude Code falls back to the directory basename

> A plugin that has a `SKILL.md` at its root, no `skills/` subdirectory, and no `skills` manifest field is automatically loaded as a single-skill plugin. (L694)

**Unrecognized fields** (L506-L524): "Claude Code ignores top-level fields it does not recognize." (L506); `claude plugin validate` reports them as warnings, suggests near-miss names, and the plugin still loads (L512-L515). Wrong-typed recognized fields: "**Most fields**: the plugin fails to load" (L519); "**`experimental` and `metadata`**: Claude Code ignores a non-object value, and `claude plugin validate` reports a warning." (L520). `--strict` turns warnings into errors for CI (L522-L528).

**Experimental components**: "Components under the `experimental` key, `themes` and `monitors`, have a manifest schema that may change between releases while they stabilize. Where you declare them is a separate migration: the top level still works, `claude plugin validate` warns, and a future release will require `experimental.*`." (L578)

## 2. Standard plugin layout and file locations

Layout verbatim (L892-L931):

```text
enterprise-plugin/
├── .claude-plugin/           # Metadata directory (optional)
│   └── plugin.json             # plugin manifest
├── skills/                   # Skills
│   ├── code-reviewer/
│   │   └── SKILL.md
│   └── pdf-processor/
│       ├── SKILL.md
│       └── scripts/
├── commands/                 # Skills as flat .md files
│   ├── status.md
│   └── logs.md
├── agents/                   # Subagent definitions
│   ├── security-reviewer.md
│   ├── performance-tester.md
│   └── compliance-checker.md
├── workflows/                # Workflow scripts
│   └── release-audit.js
├── output-styles/            # Output style definitions
│   └── terse.md
├── themes/                   # Color theme definitions
│   └── dracula.json
├── monitors/                 # Background monitor configurations
│   └── monitors.json
├── hooks/                    # Hook configurations
│   ├── hooks.json           # Main hook config
│   └── security-hooks.json  # Additional hooks
├── bin/                      # Plugin executables added to PATH
│   └── my-tool               # Invokable as bare command in Bash tool
├── settings.json            # Default settings for the plugin
├── .mcp.json                # MCP server definitions
├── .lsp.json                # LSP server configurations
├── scripts/                 # Hook and utility scripts
│   ├── security-scan.sh
│   ├── format-code.py
│   └── deploy.js
├── LICENSE                  # License file
└── CHANGELOG.md             # Version history
```

> The `.claude-plugin/` directory contains the `plugin.json` file. All other directories (commands/, agents/, skills/, workflows/, output-styles/, themes/, monitors/, hooks/) must be at the plugin root, not inside `.claude-plugin/`. (L934)

> A `CLAUDE.md` file at the plugin root is not loaded as project context. Plugins contribute context through skills, agents, and hooks rather than CLAUDE.md. To ship instructions that load into Claude's context, put them in a skill. (L937)

File locations reference table verbatim (L941-L955):

| Component | Default Location | Purpose |
| :-- | :-- | :-- |
| **Manifest** | `.claude-plugin/plugin.json` | Plugin metadata and configuration (optional) |
| **Skills** | `skills/` | Skills with `<name>/SKILL.md` structure |
| **Commands** | `commands/` | Skills as flat Markdown files. Use `skills/` for new plugins |
| **Agents** | `agents/` | Subagent Markdown files |
| **Workflows** | `workflows/` | Workflow script files |
| **Output styles** | `output-styles/` | Output style definitions |
| **Themes** | `themes/` | Color theme definitions |
| **Hooks** | `hooks/hooks.json` | Hook configuration |
| **MCP servers** | `.mcp.json` | MCP server definitions |
| **LSP servers** | `.lsp.json` | Language server configurations |
| **Monitors** | `monitors/monitors.json` | Background monitor configurations |
| **Executables** | `bin/` | Executables added to the Bash tool's `PATH` and invokable as bare commands while the plugin is enabled. You can't include this directory in a plugin you distribute through claude.ai organization settings |
| **Settings** | `settings.json` | Default configuration applied when the plugin is enabled. Only the `agent` and `subagentStatusLine` keys are supported |

## 3. Environment variables

Table verbatim (L715-L719):

| Variable | Resolves to | Use it for |
| :-- | :-- | :-- |
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to the plugin's installation directory | Scripts, binaries, and config files bundled with the plugin |
| `${CLAUDE_PLUGIN_DATA}` | Persistent directory that survives plugin updates, created on first reference | Installed dependencies such as `node_modules` or Python virtual environments, generated code, and caches |
| `${CLAUDE_PROJECT_DIR}` | The project root | Project-local scripts and config files |

> All three are exported as environment variables to hook processes and to MCP and LSP server subprocesses. They aren't present in the environment of commands Claude runs through the Bash tool, in the main session or in a subagent. In plugin content, write the placeholder instead, and Claude Code substitutes the path inline when it loads the content. (L721)

Where placeholders resolve (L723-L729): Skill and agent content: "Anywhere the placeholder appears"; Hook and monitor commands: "Anywhere the placeholder appears"; MCP `stdio` servers: `command`, `args`, `env`; MCP `http`, `sse`, `ws` servers: `url`, `headers`, `headersHelper`; LSP servers: `command`, `args`, `env`, `workspaceFolder`.

> In hook commands, use exec form with `args` so each path is passed as one argument with no quoting. In shell-form hooks and monitor commands, wrap the variables in double quotes, as in `"${CLAUDE_PROJECT_DIR}/scripts/server.sh"`. (L731)

Shell-form example (L733-L748): `"command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/process.sh"`.

> For a copied plugin, `${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates. The previous version's directory remains on disk for a grace period after an update, but treat it as ephemeral and don't write state there. For a plugin loaded in place from a local-directory marketplace, the variable points at the stable source directory. (L750)

> When a copied plugin updates mid-session, hook commands, monitors, MCP servers, and LSP servers keep using the previous version's path. Run `/reload-plugins` to switch hooks, MCP servers, and LSP servers to the new path; monitors require a session restart. In a session without an interactive terminal, the reload leaves plugin MCP servers on the old path until the next session. (L752)

MCP servers can call `roots/list` to read the session's working directories at runtime (L756).

## 4. Persistent data directory

> The `${CLAUDE_PLUGIN_DATA}` directory resolves to `~/.claude/plugins/data/{id}/`, where `{id}` is the plugin identifier with characters outside `a-z`, `A-Z`, `0-9`, `_`, and `-` replaced by `-`. For a plugin installed as `formatter@my-marketplace`, the directory is `~/.claude/plugins/data/formatter-my-marketplace/`. (L760)

Common use: installing language dependencies once and reusing across sessions and updates; "For a marketplace-installed plugin, you may not need it at all: Claude Code installs eligible Node.js package dependencies automatically when it caches the plugin." (L762). Because it outlives versions, compare bundled manifest against a copy in the data directory to detect dependency changes (L764). Doc example `SessionStart` hook (L768-L783) uses `diff -q ... || (cd "${CLAUDE_PLUGIN_DATA}" && cp ... && npm install) || rm -f ...` and an MCP server with `"env": {"NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"}` (L789-L801).

> The data directory is deleted automatically when you uninstall the plugin from the last scope where it is installed. The `/plugin` interface shows the directory size and prompts before deleting. The CLI deletes by default; pass `--keep-data` to preserve it. (L803)

## 5. Plugin caching and file resolution

Plugins are specified via `claude --plugin-dir` / `--plugin-url` (session only), a marketplace (installed), or claude.ai sync into `~/.claude/plugins/synced/` (L809-L813).

> For security and verification purposes, Claude Code copies *marketplace* plugins to the user's local **plugin cache** (`~/.claude/plugins/cache`), unless the plugin loads in place. A `command` source in link mode loads in place through links in the cache entry. A relative path source in a marketplace added from a local directory loads in place from the marketplace folder. (L815)

In-place plugins: edits take effect at next session start or `/reload-plugins`, no version bump needed; Node deps are NOT installed into the source dir (L817). Copied plugins: "each installed version is a separate directory in the cache, grouped by marketplace and plugin and named for the resolved version" (L819). On update/uninstall the previous directory is orphaned and removed "in a background sweep roughly 14 days later"; sweep runs only while at least one plugin is installed (L821). Symlinked development checkouts placed as a cache version entry are never orphaned or removed (L823). Glob/Grep skip orphaned dirs (L825).

**Node.js package dependencies** verbatim (L829-L856):

> When Claude Code copies a plugin into the cache, it also installs the plugin's Node.js package dependencies there, so the plugin's hooks and MCP servers can load them. This section covers the npm and Bun packages a plugin declares in its own `package.json`. (L829)

> Claude Code runs the install inside the copied version directory each time it creates one: when you install a plugin, when Claude Code updates a plugin to a new version, and at session start when an enabled plugin isn't cached yet, such as on a new machine. The install runs only when the plugin's root directory contains both a `package.json` and a supported lockfile: (L831)

| Lockfile | Command |
| :-- | :-- |
| `bun.lock` or `bun.lockb` | `bun install --frozen-lockfile --ignore-scripts` |
| `npm-shrinkwrap.json` or `package-lock.json` | `npm ci --ignore-scripts` |

> If a plugin contains more than one of these lockfiles, Claude Code uses the first match, checking in order: `bun.lock`, `bun.lockb`, `npm-shrinkwrap.json`, `package-lock.json`. (L838)

> Claude Code skips `yarn.lock` and `pnpm-lock.yaml` because Yarn and pnpm support resolution-time configuration hooks that bypass `--ignore-scripts`. When a `bunfig.toml` sits beside the matched bun lockfile, Claude Code skips the install entirely [...] (L840)

> Ship an npm lockfile for the widest reach. Claude Code runs the matched lockfile's package manager from the user's PATH and doesn't fall back to the other lockfile if it's missing. For a plugin distributed through an npm source, use `npm-shrinkwrap.json`; npm excludes `package-lock.json` from published packages. (L842)

Constraints (L846-L848): "**Frozen resolution**", "**No lifecycle scripts:** `--ignore-scripts`", "**60-second timeout:** Claude Code stops an install that runs longer and treats it as failed." "Claude Code fetches an npm-source plugin before this dependency install, and none of the package's own install scripts run during the fetch." (L850)

> A failed or skipped install never blocks the plugin. [...] A plugin with a `package.json` and no lockfile is skipped without a log entry. A timed-out install can leave a partial `node_modules` tree in the cached copy. (L852)

> You can't turn the automatic install off; no setting or environment variable disables it. (L854)

**Path traversal limitations** (L860-L866): Claude Code "rejects a component path that resolves outside the plugin root, whether the path is declared in `plugin.json` or in a marketplace entry", including `../shared-utils` and symlinks leading outside (L860). "On macOS and Linux, Claude Code also rejects a component path that contains a backslash anywhere in it [...] Write component paths with forward slashes" (L862). Rejection yields `path escapes plugin directory` and the plugin loads without that component (L864). Files outside the plugin dir are not copied into the cache, so scripts reading above the plugin root won't find them (L866).

**Symlinks** (L870-L882): within the plugin dir: preserved as relative symlink; elsewhere in same marketplace: dereferenced and copied; outside marketplace: skipped. For `--plugin-dir`, local path, or `command` copy-mode plugins, only symlinks within the plugin dir are preserved (L876).

## 6. Namespacing of skills, commands, agents; shorter prefix?

- "Plugins add skills to Claude Code, creating `/name` shortcuts that you or Claude can invoke." (L19). Location: `skills/` or `commands/`, or a single root `SKILL.md` (L21); "Skills are directories with `SKILL.md`; commands are simple markdown files" (L23).
- Namespacing is by the manifest `name`: "This name is used for namespacing components. For example, in the UI, the agent `agent-creator` for the plugin with name `plugin-dev` will appear as `plugin-dev:agent-creator`." (L500-L502). Agents: `agents/reviewer.md` in `my-plugin` loads as `my-plugin:reviewer` (L74); typeahead shows `my-plugin:code-reviewer` (L84). `plugin init --with skills` scaffolds "An extra namespaced `<name>:example` skill" (L994); the init `<name>` "Becomes the skill namespace" (L975).
- Skill invocation name comes from `SKILL.md` frontmatter `name`, else directory basename (L691-L692, L39). For a root-`SKILL.md` single-skill plugin that is copied into the cache, the fallback directory name "is a version string that changes on every update" (L39), so always set frontmatter `name`. "Components from custom paths use the same naming and namespacing rules" (L688).
- `displayName` is "Not used for namespacing or lookup." (L535).
- Marketplace entry name: "When a marketplace entry lists the plugin under a different name, the marketplace entry name is what `enabledPlugins` keys and `/plugin` use" (L498). Whether it also changes the command prefix is not stated here.
- **Shorter prefix / aliases (e.g. `/sb:audit`)**: Not found in docs. Searched `alias`, `prefix`, `namespace`, `invocation`, `displayName`. The only "alias" hits are CLI subcommand aliases (`claude plugin new`, L988; `remove`/`rm`, L1090; `autoremove`, L1115). No manifest or frontmatter field renames or shortens the `<plugin-name>:` prefix. The only documented lever is the plugin `name` itself (kebab-case, L498). Caveat: this file never writes out the slash form `/plugin-name:skill-name` for skills (grep for `/x:y` finds nothing); the `<name>:<component>` form is shown only for an agent in the UI (L500-L502) and for the scaffolded `<name>:example` skill (L994), and L19 says plugins create "`/name` shortcuts". The exact slash syntax must come from skills.md.

## 7. Hooks component

- "**Location**: `hooks/hooks.json` in plugin root, or inline in plugin.json" (L92). Manifest `hooks` is "string|array|object — Hook config paths or inline config", example `"./my-extra-hooks.json"` (L565). `hooks/hooks.json` may carry a top-level `$schema` key that Claude Code ignores (L96).
- Format verbatim (L100-L116):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/format-code.sh"
          }
        ]
      }
    ]
  }
}
```

- Hook types: `command`, `http`, `mcp_tool`, `prompt`, `agent` (L158-L162). Events table L120-L154 includes `SessionStart` ("When a session begins or resumes"), `UserPromptSubmit` ("When you submit a prompt, before Claude processes it"), `PreToolUse` ("Before a tool call executes. Can block it"), `PostToolUse` ("After a tool call succeeds"), `PostToolBatch`, `Notification`, `Stop`, `SessionEnd` ("When a session terminates"), `FileChanged` ("When a watched file changes on disk. The `matcher` field specifies which filenames to watch", L145), `Setup` (L123), `PreCompact`/`PostCompact`, `CwdChanged`, `ConfigChange`, `TeammateIdle`, etc.
- Multiple hook files: the layout shows `hooks/hooks.json # Main hook config` and `hooks/security-hooks.json # Additional hooks` (L917-L919), and `hooks` accepts an array of paths (L565). L679 says hooks have "Own merge rules [...] See each section for how multiple sources combine", but the Hooks section (L88-L164) does not describe the merge semantics. Not found in docs (searched `combine`, `merge`).
- Individual disabling of plugin hooks by the user: Not found in docs (searched `disable`, `disableAllHooks`). Only whole-plugin `claude plugin disable` is documented (L1139-L1162).
- Bundled MCP server targeting from hooks: see section 8 (L164).

## 8. MCP servers component

- "**Location**: `.mcp.json` in plugin root, or inline in plugin.json" (L170); "Standard MCP server configuration" (L172). Example verbatim (L176-L192):

```json
{
  "mcpServers": {
    "plugin-database": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": {
        "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data"
      }
    },
    "plugin-api-client": {
      "command": "npx",
      "args": ["@company/mcp-server", "--plugin-mode"]
    }
  }
}
```

- Integration behavior (L196-L199): servers "start automatically when the plugin is enabled"; "appear as standard MCP tools"; `/reload-plugins` keeps live connections of unchanged servers.
- Scoped names verbatim (L164):

> Hooks that target the plugin's own bundled MCP server must use its scoped names. Tool matchers and `if` fields take the scoped tool name `mcp__plugin_<plugin-name>_<server-name>__<tool>`, and an `mcp_tool` hook's `server` field takes `plugin:<plugin-name>:<server-name>`. A matcher written against the bare server key never fires.

- Placeholders resolve in stdio `command`, `args`, `env` (L727). Node example: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]` (L793-L794). Project-scope `@skills-dir` plugin MCP servers "go through the same per-server approval as a project `.mcp.json`" (L397).

## 9. Monitors component (verbatim, L291-L339)

> Plugins can declare background monitors that Claude Code starts automatically when the plugin is active. Each monitor runs a shell command for the lifetime of the session and delivers every stdout line to Claude as a notification, so Claude can react to log entries, status changes, or polled events without being asked to start the watch itself. (L293)

> Plugin monitors use the same mechanism as the Monitor tool and share its availability constraints. They run only in interactive CLI sessions, run unsandboxed at the same trust level as hooks, and are skipped on hosts where the Monitor tool is unavailable. (L295)

"**Location**: `monitors/monitors.json` in the plugin root, or inline in `plugin.json`" (L297); "**Format**: JSON array of monitor entries" (L299). Example (L303-L317):

```json
[
  {
    "name": "deploy-status",
    "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/poll-deploy.sh",
    "description": "Deployment status changes"
  },
  {
    "name": "error-log",
    "command": "tail -F ./logs/error.log",
    "description": "Application error log",
    "when": "on-skill-invoke:debug"
  }
]
```

> To declare monitors inline, set `experimental.monitors` in `plugin.json` to the same array. To load from a non-default path, set `experimental.monitors` to a relative path string such as `"./config/monitors.json"`. Monitors are an experimental component. (L319)

Required fields (L323-L327): `name` — "Identifier unique within the plugin. Prevents duplicate processes when the plugin reloads or a skill is invoked again"; `command` — "Shell command run as a persistent background process in the session working directory"; `description` — "Short summary of what is being watched. Shown in the task panel and in notification summaries".

> `when` | Controls when the monitor starts. `"always"` starts it at session start and on plugin reload, and is the default. `"on-skill-invoke:<skill-name>"` starts it the first time the named skill in this plugin is dispatched (L333)

> The `command` value supports the path substitutions `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, and `${CLAUDE_PROJECT_DIR}`, plus any `${ENV_VAR}` from the environment. Prefix the command with `cd "${CLAUDE_PLUGIN_ROOT}" && ` if the script needs to run from the plugin's own directory. (L335)

> A monitor `command` can't reference `${user_config.*}` values. The command runs through a shell, so Claude Code rejects the monitor with an error instead of substituting the value. Monitor processes don't receive `CLAUDE_PLUGIN_OPTION_<KEY>` environment variables, so have the monitor script read the value from a config file it owns. (L337)

> If you disable a plugin mid-session, Claude Code doesn't stop monitors that are already running; they stop when the session ends. (L339)

Also: project-scope `@skills-dir` plugins: "Background monitors do not load" (L399); monitors keep the old path after a mid-session update and "require a session restart" (L752).

## 10. Installation scopes, skills-directory plugins, synced plugins

Scopes table verbatim (L365-L370):

| Scope | Settings file | Use case |
| :-- | :-- | :-- |
| `user` | `~/.claude/settings.json` | Personal plugins available across all projects (default) |
| `project` | `.claude/settings.json` | Team plugins shared via version control |
| `local` | `.claude/settings.local.json` | Project-specific plugins, gitignored when Claude Code saves a setting to it |
| `managed` | Managed settings | Managed plugins (read-only, update only) |

**Skills-directory plugins** (L378-L415): "Any folder under a skills directory that contains a `.claude-plugin/plugin.json` manifest is loaded as a plugin named `<name>@skills-dir` on the next session, with no marketplace and no install step. [...] the plugin is discovered in place rather than copied into the plugin cache." (L378). `~/.claude/skills/` = personal scope, loads in every project; `<cwd>/.claude/skills/` = project scope, loads only after the workspace trust dialog (L390-L393). Project-scope restrictions: MCP servers need per-server approval, LSP after trust, "Background monitors do not load" (L397-L399); "Personal-scope plugins have none of these restrictions." (L401). Project `@skills-dir` plugins load only from the primary working directory's `.claude/skills/` and don't walk up to the repo root (L404). Hot reload: "Changes you make to a skill's `SKILL.md` take effect immediately in the current session. Changes to the plugin's other components, such as `hooks/`, `.mcp.json`, `agents/`, and `output-styles/`, do not. Run `/reload-plugins` or restart Claude Code to pick those up." (L409). Disable: `claude plugin disable my-tool@skills-dir` (L414); no uninstall step (L411).

**Synced plugins** (L419-L445): loaded as `<name>@synced` from `~/.claude/plugins/synced/`, same trust as marketplace plugins (L423); terminal-session sync requires v2.1.273+ (L428); `install`/`update`/`uninstall` don't apply (L440); `syncClaudeAiPlugins: false` stops syncing (L441); a same-named plugin from any other source wins over the synced copy (L445).

## 11. userConfig

Example (L584-L600) declares `api_endpoint` (`type: string`, `title`, `description`) and `api_token` with `"sensitive": true`. "Keys must be valid identifiers." (L602). Fields (L606-L614): `type` (Yes) "One of `string`, `number`, `boolean`, `directory`, or `file`"; `title` (Yes); `description` (Yes); `sensitive` (No) "If `true`, masks input and stores the value in secure storage instead of `settings.json`"; `required`; `default`; `options` (string picker, v2.1.271+); `multiple`; `min`/`max`.

> Each value is available for substitution as `${user_config.KEY}` in MCP and LSP server configs and hook commands. Non-sensitive values can also be substituted in skill and agent content. All values are exported to hook processes as `CLAUDE_PLUGIN_OPTION_<KEY>` environment variables, where `<KEY>` is the option key uppercased. (L618)

> Fields that run in a shell reject `${user_config.*}`: substituting a configured value into a shell command would let the shell run whatever that value contains, so the component fails with an error instead. (L620)

Rejected fields and alternatives (L624-L626): shell-form hook commands: "Use exec form with `args`, or read `CLAUDE_PLUGIN_OPTION_<KEY>` from the hook's environment"; monitor commands and MCP `headersHelper`: "Read the value from a config file in the script". "Before v2.1.207, these fields substituted `${user_config.KEY}` values" (L628). Non-sensitive values live under `pluginConfigs[<plugin-id>].options` in user `settings.json` (L630); sensitive values in macOS Keychain (~2 KB total shared limit) or `~/.claude/.credentials.json` (L632). `pluginConfigs` is read only from user settings, `--settings`, and managed settings; project and local settings are ignored (L634-L642). "Except `sensitive` fields and `multiple` lists", each field of each enabled plugin appears as a row in `/config` (v2.1.269+, L616). `claude plugin install --config <key=value>` sets options (L1034).

## 12. Channels

"The `channels` field lets a plugin declare one or more message channels that inject content into the conversation. Each channel binds to an MCP server that the plugin provides." (L646). Each entry has a required `server` that "must match a key in the plugin's `mcpServers`" and an optional per-channel `userConfig` with the same schema as the top-level field (L671); the example binds a `telegram` server with `bot_token` (sensitive) and `owner_id` (L648-L669). `plugin init --with channel` scaffolds "a stdio server (`server.ts`), its `.mcp.json`, and a `package.json`" (L1000).

## 13. CLI commands reference

**plugin init** (L963-L1015): "Scaffold a new plugin at `~/.claude/skills/<name>/`. On the next Claude Code session it loads automatically as `<name>@skills-dir`" (L965). Usage: `claude plugin init <name> [options]` (L970). `<name>`: "Becomes the skill namespace and the directory name under `~/.claude/skills/`, so it cannot contain spaces or path separators." (L975). Options (L979-L986): `--description <text>`; `--author <name>` (default `git config user.name`); `--author-email <email>` (default `git config user.email`); `--with <components...>` "Valid values: `skills`, `agents`, `hooks`, `mcp`, `lsp`, `output-style`, `channel`"; `-f, --force`; `-h, --help`. Alias `claude plugin new` (L988). Blocked by `strictKnownMarketplaces` or `{"source": "skills-dir"}` in `blockedMarketplaces` (L1002).

**plugin install** (L1017-L1065): `claude plugin install <plugin> [options]` (L1022); `<plugin>`: "Plugin name or `plugin-name@marketplace-name` for a specific marketplace" (L1027). Options (L1033-L1038): `-s, --scope <scope>` "Installation scope: `user`, `project`, or `local`" default `user`; `--config <key=value>`; `-y, --yes` (accept marketplace-declared command; "Required when stdin or stdout isn't a TTY, unless you pass `--accept-command`. Has no effect inside a Claude Code session"); `--accept-command <sha256>` (v2.1.271+); `--json` (v2.1.268+); `-h, --help`. Examples: `claude plugin install formatter@my-marketplace`, `... --scope project`, `... --scope local` (L1058-L1064). `--json` result always has `command`, `outcome` (`ok`/`failed`), `message` (L1044-L1046).

**plugin uninstall** (L1067-L1096): `claude plugin uninstall <plugin> [options]` (L1072). Options (L1083-L1088): `-s, --scope <scope>` default `user`; `--keep-data` "Preserve the plugin's persistent data directory"; `--prune`; `-y, --yes`; `--json`; `-h, --help`. Aliases `remove`, `rm` (L1090). "By default, uninstalling from the last remaining scope also deletes the plugin's `${CLAUDE_PLUGIN_DATA}` directory." (L1092). Before v2.1.212 the qualified form could uninstall a same-named plugin from another marketplace (L1095).

**plugin prune** (L1098-L1117): `claude plugin prune [options]` (L1103). Options: `-s, --scope <scope>` default `user`; `--dry-run`; `-y, --yes`; `-h, --help` (L1110-L1113). Alias `autoremove` (L1115).

**plugin enable** (L1119-L1137): `claude plugin enable <plugin> [options]` (L1124); `<plugin>` may be `plugin-name@synced` (L1129). Options: `-s, --scope <scope>` "When omitted, Claude Code detects the scope where the plugin is installed" default Auto-detect; `--json` (v2.1.268+); `-h, --help` (L1135-L1137).

**plugin disable** (L1139-L1162): `claude plugin disable [plugin] [options]` (L1148). Options: `-a, --all` "Disable all enabled plugins. Can't be combined with `--scope`"; `-s, --scope <scope>` Auto-detect; `--json`; `-h, --help` (L1159-L1162). For a marketplace-installed target, fails when another enabled plugin depends on it (L1143); for an org-required synced plugin, "fails and saves nothing" (L1145).

**plugin update** (L1164-L1188): `claude plugin update <plugin> [options]` (L1169). Options: `-s, --scope <scope>` "`user`, `project`, `local`, or `managed`" default `user`; `-y, --yes`; `--accept-command <sha256>`; `--json`; `-h, --help` (L1180-L1184). Bare names resolve against installed plugins; ambiguity is refused; "Before v2.1.246, Claude Code accepted only the qualified form" (L1187).

**plugin list** (L1192-L1214): `claude plugin list [options]` (L1197). Options: `--json` (rows carry `errors`/`notes`; `errorDetails`/`noteDetails` on v2.1.268+); `--available` "Requires `--json`"; `-h, --help` (L1204-L1206). Inline `/plugin list` covers marketplace-installed plugins only; `--plugin-dir` plugins appear in `claude plugin list` only as `claude --plugin-dir <dir> plugin list` (L1208-L1214).

**plugin details** (L1216-L1265): `claude plugin details <name>` (L1221); only option is `-h, --help` (L1232); shows component inventory (Skills incl. `commands/`, Agents, Hooks, MCP servers, LSP servers) and "Always-on" vs "On-invoke" token costs (L1218, L1236-L1237); hooks are "harness-only — no model context cost" (L1249).

**plugin validate** (L1267-L1299): `claude plugin validate <path> [options]` (L1274); exits 0 pass, 1 fail, 2 run error (L1271). Options: `--strict` "Treat warnings as errors and exit 1 on them"; `--json` (v2.1.259+); `-h, --help` (L1285-L1287). `/plugin validate <path>` runs inline (L1299). Plugin without manifest: `claude plugin validate ./my-plugin/agents` requires v2.1.233+ (L82).

**plugin eval** (brief, L1301-L1331): `claude plugin eval [target] [options]`; requires v2.1.269+; runs eval cases in isolated sessions with/without the plugin; key options `--runs`, `-j`, `--model`, `--threshold` (default `1.0`), `--max-cost-usd`, `--allow-tools`, `--trust-plugin`, `--json [path]`, `--no-publish`. `claude plugin eval init [name]` (L1338) creates a suite.

**plugin tag** (L1350-L1371): "Create a release git tag for a plugin. By default the command tags the plugin in the current directory" (L1352). `claude plugin tag [path] [options]` (L1355). Options (L1366-L1371): `--push`; `--dry-run`; `-f, --force` "Create the tag even if the working tree is dirty or the tag already exists"; `-m, --message <msg>` "Use `%s` as a placeholder for the version"; `--remote <name>` default `origin`; `-h, --help`.

## 14. Debugging and development tools

- `claude --debug` shows which plugins load, manifest errors, skill/agent/hook registration, MCP initialization (L1379-L1386).
- `--plugin-dir`: loads a plugin "for the duration of a session" (L811); identity `<name>@inline` (L427); only in-plugin symlinks preserved (L876); listing needs the flag before the subcommand (L1212). No usage line beyond `claude --plugin-dir <dir> plugin list` (L1212) appears in this file.
- `/reload-plugins`: picks up non-SKILL.md component changes (L409); keeps unchanged MCP connections (L199); switches hooks/MCP/LSP to a new version path, monitors need restart (L752).
- Common issues table (L1390-L1397): "Plugin not loading / Invalid `plugin.json` / Run `claude plugin validate ./my-plugin`"; "Skills not appearing / Wrong directory structure / Ensure `skills/` or `commands/` is at the plugin root, not inside `.claude-plugin/`"; "Hooks not firing / Script not executable / Run `chmod +x script.sh`"; "MCP server fails / Missing `${CLAUDE_PLUGIN_ROOT}` / Use variable for all plugin paths"; "Path errors / Absolute paths used / Make paths relative, starting with `./`"; "LSP `Executable not found in $PATH`".
- Example error messages (L1403-L1411):

> * `Invalid JSON syntax: Unexpected token } in JSON at position 142`: check for missing commas, extra commas, or unquoted strings
> * `Plugin <name> has an invalid manifest file at .claude-plugin/plugin.json. Validation errors: name: Invalid input: expected string, received undefined`: a required field is missing
> * `Plugin <name> has a corrupt manifest file at .claude-plugin/plugin.json. JSON parse error: ...`: JSON syntax error. Before v2.1.246, Claude Code also produced this error for a `plugin.json` saved as UTF-8 with a leading byte-order mark (BOM), even when the JSON was otherwise valid.
> * `Warning: No commands found in plugin my-plugin custom directory: ./cmds. Expected .md files or SKILL.md in subdirectories.`
> * `Plugin directory not found at path: ./plugins/my-plugin. Check that the marketplace entry has the correct path.`
> * `Plugin my-plugin has conflicting manifests: both plugin.json and marketplace entry specify components.`

- Hook troubleshooting (L1415-L1426): chmod +x; "Verify the shebang line: First line should be `#!/bin/bash` or `#!/usr/bin/env bash`"; use `"command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/your-script.sh"`; event names are case-sensitive; matcher `"Write|Edit"`.
- Directory structure mistakes (L1443-L1453): "Components must be at the plugin root, not inside `.claude-plugin/`. Only `plugin.json` belongs in `.claude-plugin/`."

## 15. Distribution and versioning

> Claude Code uses the plugin's version as the cache key that determines whether an update is available. When you run `/plugin update` or auto-update fires, Claude Code computes the current version and skips the update if it matches what's already installed. A plugin loaded in place from a local-directory marketplace loads its current source files at every session start, whatever its version string says. (L1461)

Resolution order for all sources except `command` (L1463-L1469): 1. `version` in `plugin.json`; 2. `version` in the marketplace entry; 3. "The git commit SHA of the plugin's source, for `github`, `url`, `git-subdir`, and relative-path sources in a git-hosted marketplace"; 4. SHA-256 digest for `archive` sources (first 12 chars); 5. `unknown` for `npm` sources or non-git local directories. `command` sources always use a 12-char content hash, or `<version>-<hash>` (L1471).

> **Explicit version** | Set `"version": "2.1.0"` in `plugin.json` | Users get updates only when you bump this field. Pushing new commits without bumping it has no effect, and `/plugin update` reports "already at the latest version". [...] | Published plugins with stable release cycles (L1477)
> **Commit-SHA version** | Omit `version` from both `plugin.json` and the marketplace entry | Users get updates whenever the source's resolved commit changes | Internal or team plugins under active development (L1478)
> **Digest version** | Use an `archive` source and omit `version` from both `plugin.json` and the marketplace entry | With a `sha256` pin, users get updates when you change the pin. Without one, users get updates whenever the hosted zip file's bytes change | Plugins published as zip files to a static server or artifact repository (L1479)

Semver guidance and `CHANGELOG.md` (L1481). `claude plugin tag` creates release tags used for dependency version resolution (L1352, L819).

## Implications for Synchrobuilder

1. **Command prefix is fixed to the manifest `name`.** Every skill/agent is exposed as `<name>:<skill>` (L500-L502, L994). No alias/prefix field exists in this file (section 6). The only way to get `/sb:audit` is to name the plugin `sb`; `displayName` can still read "Synchrobuilder" in `/plugin` UI (L535). Decision needed: keep `synchrobuilder` (clear) or rename to `sb` (short).
2. **Use `skills/<name>/SKILL.md`, not `commands/`.** Docs say "Use `skills/` for new plugins" (L945). Use the frontmatter `name` field for stable invocation names (L691).
3. **Hooks must be exec-form or double-quoted paths.** `"${CLAUDE_PLUGIN_ROOT}"` path changes on every update for a copied (marketplace) plugin (L750); never write state under it. The brief's `node "<path>"` shell-form matches L731; exec form with `args` is the doc's preferred form. Inference, not stated in the docs: the troubleshooting advice about `chmod +x` and bash shebangs (L1394, L1418) is written for `.sh` scripts and would not apply to `node <file>` invocations; but the invocation line itself still runs through a shell in shell form (see Conflicts table).
4. **Node dependencies**: Claude Code runs `npm ci --ignore-scripts` (60 s timeout, cannot be disabled) only if `package.json` plus `package-lock.json`/`npm-shrinkwrap.json` are at the plugin root (L831-L848). With the brief's "minimal dependencies" goal, either ship no `package.json` at all (install skipped silently, L852) or ship a lockfile with zero deps. Do not rely on `${CLAUDE_PLUGIN_DATA}` npm installs unless needed.
5. **Local state location**: the snapshot cache, mute list, and logs belong in `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/synchrobuilder-<marketplace>/`, L760), which survives updates and is deleted on last-scope uninstall unless `--keep-data` (L803). It is exported to hook processes and MCP servers but NOT to Bash-tool commands (L721), so skills that shell out must have paths substituted inline in SKILL.md content (L725).
6. **Background sync loop options**: (a) a plugin monitor (`monitors/monitors.json`, `"when": "always"`, L333) runs a persistent process for the session lifetime and pipes stdout lines to Claude as notifications (L293), giving a "sooner than next prompt" notify channel; but monitors are experimental (L319), interactive-only and skipped where the Monitor tool is unavailable (L295), do not load for project-scope `@skills-dir` plugins (L399), keep running after plugin disable (L339), and run through a shell (L337) so the command should be `node "${CLAUDE_PLUGIN_ROOT}/monitors/sync.mjs"`. (b) A stdio MCP server started with the plugin (L196) can also host a long-lived loop. Either way, hooks stay local-file-read only.
7. **Presence in the status line**: plugin `settings.json` supports only `agent` and `subagentStatusLine` keys (L955). Nothing in this file lets a plugin set the main `statusLine`; treat as unconfirmed here and check statusline.md.
8. **Privacy of userConfig**: `CLAUDE_PLUGIN_OPTION_<KEY>` env vars reach hook processes (L618), so a `handle` override could be a userConfig string; but shell-form hooks cannot substitute `${user_config.*}` (L620-L624). `.synchrobuilder/team.json` + `/synchrobuilder:iam` stays the primary identity path.
9. **Versioning**: set explicit semver `version` in `plugin.json`; users update only on bumps (L1477). Use `claude plugin tag --push` for releases (L1355-L1370). Validate in CI with `claude plugin validate ./plugins/synchrobuilder --strict` (L527).
10. **Install UX**: the marketplace-qualified form `claude plugin install synchrobuilder@<marketplace>` and `--scope project` for teams (L1058-L1061) are confirmed; `/plugin marketplace add` syntax is not in this file (see plugin-marketplaces.md).
11. **Local dev**: `claude --plugin-dir <dir>` for session-only loading (L811), or a local-directory marketplace which loads in place with hot reload via `/reload-plugins` (L817, L409).
12. **Path hygiene**: forward slashes only in manifest paths (L862), everything under plugin root (L860), no `CLAUDE.md` at plugin root (L937).

## Conflicts with the brief

| Brief claim | What the docs say | Source |
| :-- | :-- | :-- |
| Commands could use a shorter prefix like `/sb:audit` | Namespace is the manifest `name`; no alias/prefix/rename field exists; `displayName` is "Not used for namespacing or lookup" | L500-L502, L535, L975 |
| Status line should show presence "if plugins can drive the status line" | Plugin `settings.json` supports only `agent` and `subagentStatusLine`; no main status line key documented for plugins | L955 |
| "/synchrobuilder:notify landing in the teammate's next prompt (sooner if plugin monitors allow)" | Monitors are experimental, interactive-CLI-only, unsandboxed, skipped where the Monitor tool is unavailable, don't load for project-scope skills-dir plugins, and keep running after plugin disable | L295, L319, L339, L399 |
| Hooks/scripts invoked as `node "<path>"` (shell form) | Docs recommend exec form with `args`; shell form is allowed if paths are double-quoted. Not a conflict, but the doc's preferred form differs | L731 |
| "NO bash/PowerShell/cmd anywhere in shipped code" | Monitor `command` "runs through a shell" by design, and hook shell-form commands go through a shell; the plugin author's script can still be Node, but the invocation line itself is a shell command | L326, L337, L620 |
| Minimal dependencies | If any `package.json` + npm lockfile ships, Claude Code auto-runs `npm ci --ignore-scripts` with a 60 s timeout; cannot be disabled | L831-L854 |
| Expected install "/plugin install synchrobuilder@<marketplace>" | Only the CLI form `claude plugin install <plugin>@<marketplace>` is documented here; the slash-command form and `/plugin marketplace add` are not in this file | L1022, L1058 |

## Open questions

1. Does the marketplace entry `name` (which `enabledPlugins` keys use, L498) also change the `<name>:` command prefix when it differs from `plugin.json` `name`? If yes, a marketplace entry named `sb` with a plugin named `synchrobuilder` might yield `/sb:audit`. Needs an experiment.
2. How do multiple hook files (`hooks/hooks.json` + `hooks/security-hooks.json`, L919) and inline `hooks` in `plugin.json` actually merge (L679 promises rules the Hooks section doesn't give)? Test whether duplicates fire twice.
3. Can a user disable one plugin hook without disabling the plugin? Not documented; test with `disableAllHooks`/settings overrides on v2.1.218.
4. Is `${CLAUDE_PLUGIN_DATA}` created lazily "on first reference" (L718) before the first hook runs, i.e. can a `SessionStart` hook rely on the directory existing?
5. On Windows, is a hook `command` of `node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"` executed via cmd.exe or PowerShell, and does the double-quote guidance (L731) hold there?
6. Does a plugin monitor get `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` in its process environment (L721 says hooks, MCP, LSP; monitors get inline substitution per L335) — needed to decide whether the sync loop script can find its data dir without argv.
7. Is the 60 s dependency-install timeout (L848) hit on slow networks for a plugin with an empty lockfile, and does a failed install leave a warning users notice?
8. Does `claude plugin validate --strict` on v2.1.218 accept `experimental.monitors` without warnings, and does `"."` in `skills` fail on that version (L687 says fixed in v2.1.221)?
9. Confirm on v2.1.218 whether Boolean frontmatter shorthand (`yes`/`no`) is accepted (L41 says the change landed in v2.1.218).
