# Research note: Plugins guide, plugin hints, plugin relevance, plugin dependencies, plugin evals

## Source

Raw Markdown downloaded on 2026-09-18 from `code.claude.com/docs/en/<page>.md`:

- https://code.claude.com/docs/en/plugins (local: `docs-raw/plugins.md`, 483 lines, cited as `plugins.md`)
- https://code.claude.com/docs/en/plugin-hints (local: `docs-raw/plugin-hints.md`, 156 lines, cited as `plugin-hints.md`)
- https://code.claude.com/docs/en/plugin-relevance (local: `docs-raw/plugin-relevance.md`, 170 lines, cited as `plugin-relevance.md`)
- https://code.claude.com/docs/en/plugin-dependencies (local: `docs-raw/plugin-dependencies.md`, 245 lines, cited as `plugin-dependencies.md`)
- https://code.claude.com/docs/en/plugin-evals (local: `docs-raw/plugin-evals.md`, 629 lines; only L5-L77 (intro, requirements, "How an eval run works", first-suite steps) read for this note, cited as `plugin-evals.md`)

The docs themselves do not state which Claude Code version they describe. Environment facts checked on 2026-09-18 (not from the docs): `npm view @anthropic-ai/claude-code version` printed `2.1.276`; the local `claude --version` printed `2.1.218 (Claude Code)`. Version markers quoted below (v2.1.172, v2.1.196, v2.1.242, v2.1.265, v2.1.269) come from the docs themselves.

Line numbers refer to the raw files; the first 4 lines of each raw file are an index preamble and content starts at the `# ` title on line 5.

---

## 1. plugins.md (Create plugins)

### 1.1 Standalone vs plugin

Two approaches exist: standalone `.claude/` config gives `/hello`, plugins give `/plugin-name:hello` (plugins.md L15-L20). Plugins are "self-contained directories with skills, agents, hooks, or a `.claude-plugin/plugin.json` manifest" and are "Best for: Sharing with teammates, distributing to community, versioned releases, reusable across projects" (plugins.md L20).

### 1.2 Quickstart flow

The quickstart creates a manifest, adds a skill, and tests with `--plugin-dir` (plugins.md L26-L28). Steps:

1. Create the plugin directory anywhere; "The location doesn't matter for this quickstart because you'll point Claude Code at the directory with `--plugin-dir`" (plugins.md L37-L45).
2. Create `.claude-plugin/plugin.json` (plugins.md L47-L67). Verbatim example:

```json
{
  "name": "my-first-plugin",
  "description": "A greeting plugin to learn the basics",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

   Manifest fields (plugins.md L69-L76):

   > `name` | Unique identifier and skill namespace. Skills are prefixed with this (e.g., `/my-first-plugin:hello`). (plugins.md L71)

   > `version` | Optional. If set, users only receive updates when you bump this field, except for a `command` source or a plugin loaded in place; see version management. If omitted, the version comes from the next source in version management. (plugins.md L73)

   `description` is "Shown in the plugin manager" (L72); `author` is optional (L74); `homepage`, `repository`, `license` are in the full schema on the plugins-reference page (L76).

3. Add a skill at `skills/<name>/SKILL.md`; "The folder name becomes the skill name, prefixed with the plugin's namespace" (plugins.md L79-L97). Example SKILL.md frontmatter uses `description:` and `disable-model-invocation: true` (plugins.md L90-L97).
4. Test: `claude --plugin-dir ./my-first-plugin`, then `/my-first-plugin:hello`; "Run `/help` and open the **Custom commands** tab to see your skill listed under the plugin namespace." (plugins.md L100-L113).

   > **Why namespacing?** Plugin skills are always namespaced (like `/my-first-plugin:hello`) to prevent conflicts when multiple plugins have skills with the same name. (plugins.md L116)

   > To change the namespace prefix, update the `name` field in `plugin.json`. (plugins.md L118)

5. Skill arguments: `$ARGUMENTS` "captures any text the user provides after the skill name"; run `/reload-plugins` to pick up changes (plugins.md L122-L143).

### 1.3 Develop a plugin in your skills directory

`claude plugin init my-tool` scaffolds `~/.claude/skills/my-tool/` with a manifest and starter `SKILL.md`; "On the next session it loads as `my-tool@skills-dir` with no marketplace or install step." (plugins.md L151-L161). Auto-load rules, scopes, and the workspace-trust requirement are on the plugins-reference page (L161).

### 1.4 Plugin structure overview

Plugins can include "custom agents, hooks, MCP servers, LSP servers, and background monitors" (plugins.md L165).

> **Common mistake**: Don't put `commands/`, `agents/`, `skills/`, or `hooks/` inside the `.claude-plugin/` directory. Only `plugin.json` goes inside `.claude-plugin/`. All other directories must be at the plugin root level. (plugins.md L168)

> The plugin root is the individual plugin's own directory, such as `my-first-plugin/` from the quickstart. It is never `~/.claude/`. For example, Claude Code doesn't read a `.mcp.json` placed at `~/.claude/.mcp.json`. (plugins.md L170)

Directory table (plugins.md L173-L184), all at plugin root:

| Directory | Purpose (verbatim) |
| :-- | :-- |
| `.claude-plugin/` | "Contains `plugin.json` manifest (optional if components use default locations)" (L175) |
| `skills/` | "Skills as `<name>/SKILL.md` directories" (L176) |
| `commands/` | "Skills as flat Markdown files. Use `skills/` for new plugins" (L177) |
| `agents/` | "Custom agent definitions" (L178) |
| `hooks/` | "Event handlers in `hooks.json`" (L179) |
| `.mcp.json` | "MCP server configurations" (L180) |
| `.lsp.json` | "LSP server configurations for code intelligence" (L181) |
| `monitors/` | "Background monitor configurations in `monitors.json`" (L182) |
| `bin/` | "Executables added to the Bash tool's `PATH` while the plugin is enabled. You can't include this directory in a plugin you distribute through claude.ai organization settings" (L183) |
| `settings.json` | "Default settings applied when the plugin is enabled" (L184) |

> A plugin that ships exactly one skill can place `SKILL.md` directly at the plugin root instead of creating a `skills/` directory. Claude Code loads it as a single skill and uses the frontmatter `name` field for the invocation name. Use the `skills/` layout for plugins that may grow to more than one skill. (plugins.md L186)

### 1.5 Add Skills

"Skills are model-invoked: Claude automatically uses them based on the task context." (plugins.md L194). Include a `description` so Claude knows when to use the skill (L207-L219). After install, "if it reports `Run /reload-plugins to activate.`" see the discover-plugins page (L221).

### 1.6 Add LSP servers

`.lsp.json` at plugin root; "Users installing your plugin must have the language server binary installed on their machine." (plugins.md L229-L243). A server that fails to start shows in the `/plugin` Errors tab, e.g. `Executable not found in $PATH`; invalid entries are skipped, `claude --debug` shows why (L245).

### 1.7 Add background monitors (verbatim)

> Background monitors let your plugin watch logs, files, or external status in the background and notify Claude as events arrive. Claude Code starts each monitor automatically when the plugin is active, so you don't need to instruct Claude to start the watch. (plugins.md L251)

> Add a `monitors/monitors.json` file at the plugin root with an array of monitor entries: (plugins.md L253)

```json
[
  {
    "name": "error-log",
    "command": "tail -F ./logs/error.log",
    "description": "Application error log"
  }
]
```
(plugins.md L255-L263)

> Each stdout line from `command` is delivered to Claude as a notification during the session. For the full schema, including the `when` trigger and variable substitution, see Monitors. (plugins.md L265)

The full schema (`when`, variable substitution) is on the plugins-reference page, not in this file (L265).

### 1.8 Ship default settings with your plugin (verbatim)

> Plugins can include a `settings.json` file at the plugin root to apply default configuration when the plugin is enabled. Currently, only the `agent` and `subagentStatusLine` keys are supported. (plugins.md L269)

> Setting `agent` activates one of the plugin's custom agents as the main thread, applying its system prompt, tool restrictions, and model. This lets a plugin change how Claude Code behaves by default when enabled. (plugins.md L271)

```json
{
  "agent": "security-reviewer"
}
```
(plugins.md L273-L277)

> This example activates the `security-reviewer` agent defined in the plugin's `agents/` directory. Settings from `settings.json` take priority over `settings` declared in `plugin.json`. Unknown keys are silently ignored. (plugins.md L279)

**Can it set `statusLine`?** Not in this doc. Only `agent` and `subagentStatusLine` are listed as supported (L269); `statusLine` (the main status line key) is not mentioned anywhere in plugins.md (searched for `statusLine`, `status line`). Since "Unknown keys are silently ignored" (L279), a `statusLine` key in a plugin `settings.json` would be ignored per this doc. Note L279 also reveals a `settings` field in `plugin.json` exists (schema on the plugins-reference page).

### 1.9 Organize complex plugins

> For plugins with many components, organize your directory structure by functionality. For complete directory layouts and organization patterns, see Plugin directory structure. (plugins.md L283)

No further detail in this file.

### 1.10 Test your plugins locally

> Use the `--plugin-dir` flag to test plugins during development. This loads your plugin directly without requiring installation. (plugins.md L287)

```bash
claude --plugin-dir ./my-plugin
```
(plugins.md L289-L291)

> The flag also accepts a `.zip` archive of the plugin directory. (plugins.md L293; example `claude --plugin-dir ./my-plugin.zip` L295-L297)

> When a `--plugin-dir` plugin has the same name as an installed marketplace plugin, the local copy takes precedence for that session. This lets you test changes to a plugin you already have installed without uninstalling it first. The exception is plugins that managed settings force-enable or force-disable: `--plugin-dir` cannot override those. (plugins.md L299)

> As you make changes to your plugin, run `/reload-plugins` to pick up the updates without restarting. This reloads plugins, skills, agents, hooks, plugin MCP servers, and plugin LSP servers; in a session without an interactive terminal, plugin MCP server changes wait for your next session. (plugins.md L301)

Test checklist (plugins.md L303-L305): try skills with `/plugin-name:skill-name`; check agents in `/context` under Custom Agents or @-mention by scoped name; "Trigger the event each hook matches, such as asking Claude to edit a file for a `PostToolUse` hook, and confirm its effect. Claude Code records which hooks matched, their exit codes, and their output in the debug log" (L305).

Multiple plugins: repeat the flag, `claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two` (plugins.md L308-L312).

Evals pointer: `claude plugin eval` runs test prompts "several times with and without the plugin loaded" (plugins.md L317).

Folder of plugins (plugins.md L319-L322):

> To load several plugins from one place, pass a folder that holds them, such as `--plugin-dir ./plugins`. Loading a folder of plugins requires Claude Code v2.1.265 or later. (L319)

> **What loads**: if the folder has no manifest or plugin components at its top level, Claude Code treats it as a folder of plugins. Each immediate subfolder that has a `.claude-plugin/plugin.json` manifest loads as a separate plugin. Claude Code skips everything else in the folder without reporting an error, including plugins that have no manifest. (L321)

> **Changes during an interactive session**: a subfolder you add loads as a new plugin once its manifest is in place, and when you remove a subfolder, its plugin unloads. Claude Code prints a line in the session for each change. If applying a change mid-conversation would invalidate the prompt cache, Claude Code holds it, and the line says to run `/reload-plugins` to apply it. (L322)

`--plugin-url` loads a hosted `.zip` "for that session only"; on fetch failure it "starts without the plugin and records a plugin load error" in the `/plugin` Errors tab (plugins.md L324). Repeat the flag or pass space-separated URLs in one quoted argument (L326-L336).

Limits of `--plugin-dir` found in this doc: cannot override managed force-enable/force-disable (L299); non-interactive sessions defer MCP server changes (L301); folder mode needs v2.1.265+ (L319); every `--plugin-dir` plugin is identified as `<name>@inline` (plugin-dependencies.md L120); dependency version constraints are not checked against a `--plugin-dir` copy (plugin-dependencies.md L114).

### 1.11 Debug plugin issues (verbatim)

> 1. **Check the structure**: Ensure your directories are at the plugin root, not inside `.claude-plugin/`
> 2. **Test components individually**: Check each skill, agent, and hook separately
> 3. **Use validation and debugging tools**: See Debugging and development tools for CLI commands and troubleshooting techniques (plugins.md L342-L344)

### 1.12 Share your plugins

Steps: add a `README.md`; choose a versioning strategy (explicit `version` or the fallback); "Create or use a marketplace: Distribute through plugin marketplaces for installation"; test with others (plugins.md L350-L353). "To keep a plugin internal to your team, host the marketplace in a private repository." (L355).

Community marketplace (plugins.md L357-L377):

> **`claude-plugins-official`**: a curated set of plugins maintained by Anthropic. Claude Code registers it automatically the first time you start Claude Code interactively. (L361, first sentences)

> **`claude-community`**: the public community marketplace where third-party submissions land after review. Users add it with `/plugin marketplace add anthropics/claude-plugins-community` and install from it as `@claude-community`. (L362)

Submission forms: claude.ai (requires Team/Enterprise org + directory access) or Console `platform.claude.com/plugins/submit` for individuals (L364-L369).

> Run `claude plugin validate ./your-plugin` locally before you submit ... When validation passes, Claude Code prints `✔ Validation passed`, or `✔ Validation passed with warnings` if there are warnings. Warnings don't fail validation; add `--strict` to treat them as errors. (L371)

Approved plugins are pinned to a commit SHA in `anthropics/claude-plugins-community`; catalog syncs nightly (L373). Official marketplace: "There is no application process" (L375). Official listing enables CLI hints (L377).

### 1.13 Migration notes (convert `.claude/` to a plugin)

Create `my-plugin/.claude-plugin/plugin.json` alongside `.claude/` (plugins.md L386-L401); copy `.claude/commands`, `.claude/agents`, `.claude/skills` to the plugin root (L404-L415); hooks go in `hooks/hooks.json`: "Copy the `hooks` object from your `.claude/settings.json` or `settings.local.json`, since the format is the same. The command receives hook input as JSON on stdin" (L425). Verbatim hooks example:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "jq -r '.tool_input.file_path' | xargs npm run lint:fix" }]
      }
    ]
  }
}
```
(plugins.md L427-L438)

What changes table (L454-L459): `.claude/commands/` becomes `plugin-name/commands/`; `settings.json` hooks become `hooks/hooks.json`; install via `/plugin install`.

> After migrating, remove the original files from `.claude/` to avoid duplicates. Project and user `.claude/agents/` definitions override same-named plugin agents, so the plugin version only takes effect once the originals are removed. Plugin skills are namespaced as `/plugin-name:skill-name`, so the original `/skill-name` and the plugin copy both remain available rather than one overriding the other. (plugins.md L462)

---

## 2. plugin-hints.md (Recommend your plugin from your CLI)

### 2.1 What hints are

> If you maintain a CLI or SDK and have a plugin in the official Anthropic marketplace, your tool can prompt Claude Code users to install that plugin. Your CLI writes a one-line marker to stderr when it detects it is running inside Claude Code. Claude Code reads the marker, strips it from the output, and shows the user a one-time install prompt. (plugin-hints.md L9)

Mechanism: `CLAUDECODE=1` is set "for every command it runs through the Bash and PowerShell tools, and for hook commands. From v2.1.172 it also sets `CLAUDE_CODE_CHILD_SESSION` to `1` in those same subprocesses." (L17). "In hook commands the hint tag is stripped and ignored. Only Bash and PowerShell tool output triggers the install prompt." (L17). Processing: scan and remove hint lines before the model sees output; check the hint targets an official marketplace plugin; check not already installed/prompted; show prompt naming the emitting command (L21-L24). "Claude Code never installs a plugin automatically. The user always confirms." (L26).

### 2.2 Exact schema

```text
<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />
```
(plugin-hints.md L122-L124)

| Attribute | Required | Description |
| :-- | :-- | :-- |
| `v` | Yes | "Protocol version. `1` is the only supported value" (L128) |
| `type` | Yes | "Hint kind. `plugin` is the only supported value" (L129) |
| `value` | Yes | "Plugin identifier in `name@marketplace` form" (L130) |

> Attribute values may be quoted with double quotes or left unquoted. Unquoted values cannot contain whitespace. Escape sequences are not supported. (L132)

Node.js example (L40-L46):

```javascript
if (process.env.CLAUDECODE) {
  process.stderr.write(
    '<claude-code-hint v="1" type="plugin" value="example-cli@claude-plugins-official" />\n',
  )
}
```

Requirements (L136-L141): the tag must occupy its own line (leading/trailing whitespace allowed); "the `value` must reference a plugin in an Anthropic-controlled marketplace such as `claude-plugins-official`. Hints that point to other marketplaces are silently dropped." (L139). "The hint line is always removed from the output before it reaches the model, even when the version or type is unrecognized, so the marker is never counted toward token usage." (L141). Recommended: write to stderr (stdout also scanned, L145); gate on `CLAUDECODE` or `CLAUDE_CODE_CHILD_SESSION` (L146).

`CLAUDE_CODE_CHILD_SESSION` is "set only in subprocesses Claude Code itself spawns, such as tool calls, hook commands, and status line commands" (L35); `CLAUDECODE` also reaches tmux, stdio MCP subprocesses, and IDE integrated terminals (L34).

### 2.3 When hints show

Prompt shown once per plugin regardless of answer (L111); at most one hint prompt per session across all CLIs (L112); main interactive session only, never for subagent commands, `-p` mode, or Agent SDK, though "Claude Code still strips the hint line from the command output in all of these cases" (L113); never when `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set or on Bedrock/Google Cloud Agent Platform opt-outs (L114). "If the user doesn't respond within 30 seconds, Claude Code dismisses the prompt as **No**." (L107). "Selecting **Yes** installs the plugin to user scope." (L116).

> The hint protocol only takes effect for plugins listed in the official Anthropic marketplace, `claude-plugins-official`. Anthropic curates that marketplace at its discretion, and the in-app submission forms add plugins to the community marketplace instead, which the hint protocol does not check. (L150)

### 2.4 Could a hint tell users a short command form exists?

Not found in docs. `type` accepts only `plugin` (L129) and `value` is only a `name@marketplace` identifier (L130); the prompt text is fixed ("Plugin recommendation ... Would you like to install it?", L89-L105). There is no free-text hint, no alias mechanism, and hints only fire for official-marketplace plugins (L30, L139). Searched for "alias", "short", "prefix".

### 2.5 statusLine mention

The only mention is that `CLAUDE_CODE_CHILD_SESSION` is set in "status line commands" (plugin-hints.md L35). Nothing about plugins driving the status line.

---

## 3. plugin-relevance.md (Recommend plugins for your org)

### 3.1 What this page covers, and what it does not

This page is about **install suggestions** for not-yet-installed marketplace plugins, not about which skills/commands of an installed plugin are loaded or shown to the model:

> Add a `relevance` block to a plugin's entry in `marketplace.json`, then allowlist the marketplace in managed settings. When a user's session matches one of the declared signals, Claude Code surfaces an install suggestion for that plugin. (plugin-relevance.md L9)

> Marketplace-declared suggestions are opt-in per marketplace through managed settings. No marketplace's `relevance` declarations produce suggestions until an administrator adds it to the allowlist, including the official Anthropic marketplace. (L11)

L11 continues: Claude Code "also includes one built-in suggestion that is independent of this allowlist; that tip and all marketplace-declared tips are disabled when `spinnerTipsEnabled` is set to `false`."

**How Claude Code decides which plugin skills/commands are loaded or shown to the model:** Not found in these docs. plugin-relevance.md only governs marketplace install suggestions. The loading-related statements found in the assigned files are: skills are "model-invoked: Claude automatically uses them based on the task context" (plugins.md L194), `disable-model-invocation: true` in SKILL.md frontmatter (plugins.md L93, undocumented effect in this file), skills listed under `/help` Custom commands (plugins.md L113), a single root `SKILL.md` loaded "as a single skill" using the frontmatter `name` (plugins.md L186), and the folder-mode note that a plugin change applied mid-conversation may "invalidate the prompt cache", in which case Claude Code holds it until `/reload-plugins` (plugins.md L322). Nothing describes per-skill loading or filtering.

**Token cost:** Not found in docs for plugin skills/commands. The only cost-adjacent statements are that hint lines are "never counted toward token usage" (plugin-hints.md L141) and that enabling/disabling a plugin mid-conversation can "invalidate the prompt cache" (plugins.md L322, linking to the prompt-caching page, not in this assignment). Searched for "token", "context window", "prompt cache".

### 3.2 How relevance works

Signals are tested locally: "Signal matching happens locally on the user's machine. The matching adds no network traffic and does not report which signals matched, or their values, to Anthropic or to the marketplace operator." (L19). Three surfaces when a signal matches and the plugin is not installed (L21-L25): spinner tip with the `/plugin install` command; session-start one-line `plugin suggestion: <name>@<marketplace> · /plugin` if `cwd` matches; `/plugin` Discover tab pin. Spinner tip and session-start notification are disabled when `spinnerTipsEnabled` "resolves to `false` across your settings files", or when `excludeDefault` resolves to `true` across the `spinnerTipsOverride` keys in user, `--settings`, and managed settings "and those keys configure at least one tip or a `tipsFile`" (L27); Discover pin is independent (L29). "Claude Code never installs a plugin automatically. The user always confirms." (L31).

Verbatim example (L37-L55):

```json
{
  "name": "acme-corp-plugins",
  "owner": { "name": "Acme Platform Team" },
  "plugins": [
    {
      "name": "terraform-helpers",
      "source": "./plugins/terraform-helpers",
      "description": "Acme conventions and helpers for Terraform",
      "relevance": {
        "topic": "Terraform",
        "signals": {
          "cli": ["terraform"],
          "filesRead": ["**/*.tf"]
        }
      }
    }
  ]
}
```

Field reference: `topic` optional, max 64 chars, defaults to plugin name with hyphen segments capitalized (L66); `signals` requires at least one signal (L67). Signals (L73-L77): `cwd` (globs, absolute and repo-relative, case-insensitive, "This is the only signal that can match at session start", max 10 x 256 chars); `cli` (exact command names, max 10 x 64); `hosts` (bare hostnames from URLs in Bash commands, max 20 x 128); `filesRead` (globs, max 10 x 256); `manifestDeps` (`{file, pattern}` regex pairs, files over 512 KB skipped, max 10). "The `cli`, `hosts`, `filesRead`, and `manifestDeps` signals need session history, so they can only match on the spinner tip and the Discover tab." (L79). `filesRead`/`manifestDeps` include files Claude wrote/edited and auto-loaded `CLAUDE.md`, but skip Claude's own config and temp dirs (L81). Unknown fields under `relevance` are ignored at load (L104).

Enabling: add the marketplace to `pluginSuggestionMarketplaces` in managed settings, and for non-official marketplaces also declare its source in `extraKnownMarketplaces` or `strictKnownMarketplaces` (L109-L111; example L115-L127). Frequency: "A given plugin's suggestion appears at most once every three sessions across the spinner tip and the session-start notification combined, and neither repeats once the plugin is installed. The session-start notification additionally stops appearing after the suggestion has been shown twice." (L152). Validate with `claude plugin validate ./my-marketplace` (L158-L164).

### 3.3 Windows / platform-specific components

> `cli` ... Applies on every platform: commands run on Windows through PowerShell or Git Bash are recorded the same way. Claude Code records one command name per shell tool invocation: the first token after any leading environment variable assignments and `sudo`. Compound commands contribute only their leading command, so `cd infra && terraform plan` records `cd`, not `terraform`. (L74)

> `manifestDeps` ... Anchor `file` at the end, for example `[/\\\\]package\\.json$` in JSON-escaped form, because a start-anchored pattern never matches an absolute path. Paths are not separator-normalized for this signal, so Windows paths use backslashes. (L77)

`cwd` and `filesRead` are "Forward-slash normalized and case-insensitive" (L73, L76). Nothing about platform-specific plugin components (e.g. per-OS hooks) in this file.

---

## 4. plugin-dependencies.md (Constrain plugin dependency versions)

### 4.1 Scope: dependencies are other plugins only

> A plugin can depend on other plugins by listing them in `plugin.json` or in its marketplace entry. By default, a dependency tracks the latest available version, so an upstream release can change the dependency under your plugin without warning. (plugin-dependencies.md L9)

> Dependencies here are other plugins; for the npm and Bun packages a plugin itself uses, see Node.js package dependencies. (L13)

**Can a plugin depend on a runtime such as Node?** Not found in docs. The `dependencies` array only names plugins (L40-L46). A separate "Node.js package dependencies" section exists on the plugins-reference page (link at L13) but is outside the assigned files. Searched for "node", "runtime", "engines".

### 4.2 Declaration schema

```json
{
  "name": "deploy-kit",
  "version": "3.1.0",
  "dependencies": [
    "audit-logger",
    { "name": "secrets-vault", "version": "~2.1.0" }
  ]
}
```
(plugin-dependencies.md L29-L38)

Object fields (L42-L46): `name` (string, required, "Resolves within the same marketplace as the declaring plugin"); `version` (semver range such as `~2.1.0`, `^2.0`, `>=1.4`, `=2.1.0`; "fetched at the highest tagged version that satisfies this range"); `marketplace` (cross-marketplace, blocked unless the root marketplace's `marketplace.json` lists it in `allowCrossMarketplaceDependenciesOn`). "Pre-release versions such as `2.0.0-beta.1` are excluded unless your range opts in with a pre-release suffix like `^2.0.0-0`." (L48). A manifest can consist of only `name` + `dependencies` to bundle plugins (L52).

### 4.3 Auto-install

> When you install a plugin that declares dependencies, Claude Code resolves and installs them automatically, apart from a dependency whose marketplace entry has a `command` source or a `headersHelper`, which you install yourself first. Later, `/reload-plugins`, auto-update of the dependent plugin's marketplace, re-running `claude plugin install` on the dependent plugin, and `claude plugin marketplace add` each install any declared dependency that isn't installed yet, under the same rules (L11)

Cross-marketplace auto-install is refused by default; failure is a `cross-marketplace` error (L81-L104). Local testing: `claude --plugin-dir ./my-dependency --plugin-dir ./my-plugin`; version constraints are not checked against a local copy; "Before v2.1.242, a dependency entry that named a marketplace never matched the local copy" (L108-L114). "`<name>@inline` is how Claude Code identifies every `--plugin-dir` and `--plugin-url` plugin." (L120).

Version resolution uses git tags named `{plugin-name}--v{version}`; `claude plugin tag --push` creates and pushes them (L125-L140). Enabling a plugin enables its dependencies; disabling is refused while another enabled plugin needs it (L177-L199). Errors: `dependency-unsatisfied`, `range-conflict`, `dependency-version-unsatisfied`, `no-matching-tag`; `claude plugin list --json` exposes an `errors` field (L231-L238).

### 4.4 Prune

> To clean them up, run `claude plugin prune` to list the auto-installed dependencies that no longer have any installed plugin requiring them and remove them after a confirmation prompt. (L203)

Defaults to user scope with confirmation; `--scope project|local`, `--dry-run`, `-y`; non-TTY lists orphans and removes nothing without `-y` (L211-L215). `claude plugin uninstall <name> --prune` removes orphans after uninstall; "Plugins you installed yourself are never pruned" (L217). `Nothing to prune` on a fresh install is expected (L209).

---

## 5. plugin-evals.md (Test plugins with evals), intro only

> `claude plugin eval` runs your plugin against a suite of test cases and scores the results. Each case is a realistic prompt plus one or more graders. A grader is a pass/fail check on what Claude produced, such as a regex over the reply, whether a particular tool was called, or a rubric that a second model judges the reply against. (plugin-evals.md L9)

`claude plugin eval init` interviews you, proposes cases and graders, pilots them, and writes the files (L11). Purpose: measure reliability, catch regressions "when you change the plugin or a new model ships", and compare against no plugin (L13). Case format is separate from skill-creator's `evals/evals.json`; `claude plugin validate` checks files, evals check behavior (L15). Every run and judge grader "is a real model call on your account" (L18).

Requirements: "Claude Code v2.1.269 or later" (L25); a plugin dir with a manifest or a skills-directory plugin (L26); normal auth/model provider, costs count against plan or API bill (L27).

Suite layout: `evals/` inside the plugin, one subdirectory per case with a prompt and graders (L31). Each run starts "a fresh, isolated non-interactive session with only your plugin loaded" (L35). Each case runs three times by default; score is the fraction of graders passed, case passes at `--threshold` (default `1.0`) (L39). Baseline: runs repeat with no plugin, yielding `WITH`, `W/OUT`, and `Δ` (L43). Commands: `claude plugin eval init` (L58) and `claude plugin eval .` from the plugin root (L72); the first run asks `Trust this plugin directory? [y/N]` (L75); one case is six runs (L77).

---

## Implications for Synchrobuilder

- **Layout is fixed by the docs**: all component directories at the plugin root (`skills/`, `hooks/hooks.json`, `agents/`, `monitors/monitors.json`, `.mcp.json`, `settings.json`), only `plugin.json` inside `.claude-plugin/` (plugins.md L168-L184). Use `skills/<name>/SKILL.md` rather than `commands/` ("Use `skills/` for new plugins", L177). Commands such as `/synchrobuilder:audit` become `skills/audit/SKILL.md` with `disable-model-invocation: true` for user-only commands (L93).
- **Command prefix = manifest `name`**: `/synchrobuilder:audit` is the only form; a shorter prefix requires renaming the plugin (e.g. `name: "sb"`) (plugins.md L71, L116-L118), which also changes the install id, since plugins are identified in `name@marketplace` form (plugin-hints.md L130; plugin-dependencies.md L120, L144). Whether a rename has other consequences (cache keys, marketplace entries, enabledPlugins settings) is not covered in these files.
- **Marketplace vs official-only features**: hints (plugin-hints.md L30, L139) and CLI-driven install prompts are official-marketplace-only; relevance suggestions require managed-settings allowlisting by an admin (plugin-relevance.md L11, L109). Neither helps a GitHub-hosted third-party marketplace reach users; the website install page must carry the install commands itself.
- **Background monitors are a real mechanism for "sooner than next prompt" notify delivery**: a monitor `command` runs automatically while the plugin is active and each stdout line reaches Claude as a notification (plugins.md L251, L265). Synchrobuilder's `/synchrobuilder:notify` could tail the local snapshot cache from a Node monitor (`node "<path>"` as the `command`). Full schema (`when`, variables) lives on plugins-reference and must be checked there.
- **Plugin `settings.json` cannot set `statusLine`** per this doc: only `agent` and `subagentStatusLine` are supported and unknown keys are ignored (plugins.md L269, L279). Presence in the status line therefore cannot be shipped as a plugin default via this file; `/synchrobuilder:setup` would have to write the user's own `statusLine` setting with consent, or the plan should drop the status line unless the statusline/plugins-reference notes find another route.
- **Dev/testing loop**: `claude --plugin-dir ./plugins/synchrobuilder` (plugins.md L290), `/reload-plugins` for changes (L301), hook matches/exit codes/output land in the debug log (L305), `claude plugin validate` before release (L371), `claude plugin eval` (v2.1.269+, plugin-evals.md L25) for behavior regression tests. `--plugin-dir ./plugins` folder mode needs v2.1.265+ (plugins.md L319); the local CLI (`claude --version` printed `2.1.218` on 2026-09-18) cannot use it, so pass the plugin directory explicitly.
- **Dependencies**: `dependencies` names other plugins only (plugin-dependencies.md L9, L13, L40-L46). Node.js runtime presence cannot be declared here; `/synchrobuilder:doctor` must check it at runtime. npm package deps are covered on plugins-reference ("Node.js package dependencies", L13), which matters for the "minimal dependencies" principle.
- **`bin/` caveat**: a `bin/` directory is added to Bash `PATH` but is disallowed for plugins distributed through claude.ai organization settings (plugins.md L183). Synchrobuilder does not need `bin/`; keep scripts under a plain `scripts/` folder invoked as `node "<path>"`.
- **Migration doc example uses `jq | xargs`** (plugins.md L433); Synchrobuilder replaces this with a Node ESM script reading stdin JSON, consistent with the no-shell principle.
- **Environment detection**: `CLAUDECODE=1` and (v2.1.172+) `CLAUDE_CODE_CHILD_SESSION=1` are set in hook commands (plugin-hints.md L17, L35); useful for scripts to detect they run under Claude Code.

## Conflicts with the brief

| Brief says | Docs say | Source |
| :-- | :-- | :-- |
| Status line should show presence if plugins can drive the status line | Plugin `settings.json` supports only `agent` and `subagentStatusLine`; unknown keys silently ignored. No plugin mechanism for the main `statusLine` in these files. | plugins.md L269, L279 |
| Shorter prefix or aliases (e.g. `/sb:audit`) | Namespace is always the manifest `name`; "To change the namespace prefix, update the `name` field in `plugin.json`." No alias facility documented. | plugins.md L71, L116, L118 |
| Expected install `/plugin marketplace add <owner>/<repo>` then `/plugin install synchrobuilder@<marketplace>` | Consistent in form with the community example `/plugin marketplace add anthropics/claude-plugins-community` and install "as `@claude-community`", and with `claude plugin marketplace add anthropics/claude-plugins-official`; exact syntax for third-party repos must be verified on the marketplaces/discover pages, which are not in this assignment. | plugins.md L361-L362 |
| Commands directory naming (brief implies "commands") | `commands/` is legacy flat-file layout; "Use `skills/` for new plugins". | plugins.md L177 |
| Notify lands in teammate's next prompt "sooner if plugin monitors allow" | Monitors exist and deliver each stdout line "as a notification during the session"; the doc does not say whether that interrupts an idle session or waits for the next turn. | plugins.md L251, L265 |
| Node ESM scripts only | Monitor `command` example is a shell string (`tail -F ./logs/error.log`); hooks example uses `jq`/`xargs`. Docs do not state how `command` is executed (shell vs direct), so `node "<path>"` portability on Windows needs the plugins-reference and hooks notes. | plugins.md L259, L433 |

## Open questions

1. How exactly is a monitor `command` executed (shell, cwd, env, restart on exit, `when` trigger semantics, variable substitution such as a plugin-root variable)? Needs plugins-reference "Monitors" plus a real-machine test of `node "<path>"` as a monitor on macOS and Windows.
2. Does a monitor notification reach Claude while idle (between turns), or only on the next turn? Affects the notify latency claim.
3. Is there any supported way to set the main `statusLine` from a plugin (e.g. `settings` in `plugin.json`, plugins-reference, statusline doc)? If not, does `/synchrobuilder:setup` writing `statusLine` into user settings survive plugin uninstall cleanly?
4. Does `claude --plugin-dir` on the local v2.1.218 CLI honor `settings.json`, `monitors/`, and `/reload-plugins` identically to v2.1.276? Folder mode (L319) is explicitly v2.1.265+, so test single-directory mode only.
5. Skill loading and token cost: how much of each SKILL.md (frontmatter vs body) is loaded into context for six-plus commands, and does `disable-model-invocation: true` remove the body from the prompt? Not in these docs; check skills doc and measure with `/context`.
6. Does `claude plugin validate` accept a plugin whose `hooks.json` commands are `node "${CLAUDE_PLUGIN_ROOT}/..."` style paths on Windows, and does the variable exist? Not covered here.
7. Whether renaming the plugin to a short `name` (e.g. `sb`) has marketplace-uniqueness or discoverability consequences on a third-party marketplace.
