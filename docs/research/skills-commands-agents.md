# Research note: skills, commands, and agents in Claude Code plugins

Assignment key: `skills-commands`. Prepared for Synchrobuilder on 2026-09-18.

## Source

| Doc | Canonical URL | Raw file read | Range read |
| :-- | :-- | :-- | :-- |
| skills.md | https://code.claude.com/docs/en/skills | `docs-raw/skills.md` (1098 lines) | whole file |
| commands.md | https://code.claude.com/docs/en/commands | `docs-raw/commands.md` (183 lines) | whole file |
| sub-agents.md | https://code.claude.com/docs/en/sub-agents | `docs-raw/sub-agents.md` (1384 lines) | L155-L345 (scope, frontmatter), L403-L430 (tools), L548-L600 (permissionMode, skills preload), L707-L770 (hooks), L797-L866 (invocation), L868-L912 (background, names), L989-L1030 (nesting); tutorials skipped |

Fetch date: 2026-09-18, raw Markdown downloaded from `code.claude.com/docs/en/<page>.md`. Line numbers below refer to the raw files; the first 4 lines of each are an index preamble and content starts at the `# ` title on line 5.

The highest Claude Code version marker in these three files is v2.1.273 (skills.md L195; commands.md tops out at v2.1.269, sub-agents.md at v2.1.271). The npm "latest" version was not verifiable offline on 2026-09-18. The local CLI used for experiments is v2.1.218 (`claude --version`, checked 2026-09-18).

Citation form: `(skills.md L123-L125)`. Quotes are verbatim except that Markdown link markup `[text](url)` is reduced to `text` in some table rows, and `...` marks an elision.

---

## 1. SKILL.md frontmatter reference

Preamble (skills.md L325-L329):

> All fields are optional. Only `description` is recommended so Claude knows when to use the skill.

> Claude Code reads the frontmatter only when the opening `---` is the file's first line. Otherwise it treats the whole file, `---` markers included, as skill content.

> Boolean fields accept `yes`, `no`, `on`, `off`, `1`, and `0` in any letter case, in addition to `true` and `false`. Before v2.1.218, Claude Code recognized only `true` and `false`.

The table, verbatim (skills.md L331-L352; the `model` row is L342, reconstructed across two reads):

| Field | Required | Description |
| :-- | :-- | :-- |
| `name` | No | Display name shown in skill listings. Defaults to the directory name. See [How a skill gets its command name](#how-a-skill-gets-its-command-name) for how the field interacts with the name you type to invoke the skill. |
| `description` | Recommended | What the skill does and when to use it. Claude uses this to decide when to apply the skill. If omitted, uses the first non-empty line of the markdown content. Put the key use case first: the combined `description` and `when_to_use` text is truncated at 1,536 characters in the skill listing to reduce context usage. |
| `when_to_use` | No | Additional context for when Claude should invoke the skill, such as trigger phrases or example requests. Appended to `description` in the skill listing and counts toward the 1,536-character cap. |
| `argument-hint` | No | Hint shown during autocomplete to indicate expected arguments. Example: `[issue-number]` or `[filename] [format]`. |
| `arguments` | No | Named positional arguments for [`$name` substitution](#available-string-substitutions) in the skill content. Accepts a space-separated string or a YAML list. Names map to argument positions in order. |
| `disable-model-invocation` | No | Set to `true` to prevent Claude from automatically loading this skill. Use for workflows you want to trigger manually with `/name`. Also prevents the skill from being [preloaded into subagents](/docs/en/sub-agents#preload-skills-into-subagents). As of v2.1.196, also prevents the skill from running when a [scheduled task](/docs/en/scheduled-tasks) fires with the skill as its prompt. Default: `false`. |
| `user-invocable` | No | Set to `false` when only Claude should invoke the skill: Claude Code hides it from the `/` menu and doesn't run it when you type `/name`. Use for background knowledge users shouldn't invoke directly. Default: `true`. |
| `allowed-tools` | No | Tools Claude can use without asking permission during the turn that invokes this skill. The grant clears when you send your next message. Accepts a space- or comma-separated string, or a YAML list. See [Pre-approve tools for a skill](#pre-approve-tools-for-a-skill). |
| `disallowed-tools` | No | Tools removed from Claude's available pool while this skill is active. Use for autonomous skills that should never call certain tools, such as `AskUserQuestion` for a background loop. Accepts a space- or comma-separated string, or a YAML list. The restriction clears when you send your next message. Like deny rules, the field can't remove [`EndConversation`](/docs/en/tools-reference#endconversation-tool-behavior) while any other tool remains. |
| `model` | No | Model to use when this skill is active. The override applies for the rest of the current turn and isn't saved to settings. The session model resumes when you send your next prompt. Accepts the same values as [`/model`](/docs/en/model-config), or `inherit` to keep the active model. A value excluded by your organization's [`availableModels`](/docs/en/model-config#restrict-model-selection) allowlist isn't used, and the session keeps its current model. In [auto mode](/docs/en/permission-modes#eliminate-prompts-with-auto-mode), and in [plan mode while the classifier reviews commands](/docs/en/permission-modes#analyze-before-you-edit-with-plan-mode), a model that auto mode doesn't support also isn't used, and the session keeps its current model. With `context: fork`, the value sets the [forked subagent's model](#run-skills-in-a-subagent) instead, and an excluded value follows the [same rules as a subagent model override](/docs/en/model-config#restrict-model-selection). |
| `effort` | No | [Effort level](/docs/en/model-config#adjust-effort-level) when this skill is active. Overrides the session effort level. Default: inherits from session. Options: `low`, `medium`, `high`, `xhigh`, `max`; available levels depend on the model. |
| `context` | No | Set to `fork` to run in a forked subagent context. See [Run skills in a subagent](#run-skills-in-a-subagent). |
| `agent` | No | Which subagent type to use when `context: fork` is set. |
| `background` | No | Only applies with `context: fork`. Set to `false` to wait for the forked subagent's result in the turn that invoked the skill, instead of [running it in the background](#run-skills-in-a-subagent). Default: `true`. Requires Claude Code v2.1.218 or later. |
| `hooks` | No | Hooks that Claude Code registers when the skill is invoked and keeps running for the rest of the session. See [Hooks in skills and agents](/docs/en/hooks#hooks-in-skills-and-agents) for the configuration format and the `once` option. |
| `paths` | No | Glob patterns that limit when this skill is activated. Accepts a comma-separated string or a YAML list. When set, Claude loads the skill automatically only when working with files matching the patterns. Uses the same format as [path-specific rules](/docs/en/memory#path-specific-rules). |
| `shell` | No | Shell to use for `` !`command` `` and ` ```! ` blocks in this skill. Accepts `bash` (default) or `powershell`. Setting `powershell` runs inline shell commands via PowerShell when the [PowerShell tool](/en/tools-reference#powershell-tool) is enabled: it's on by default on Windows without Git Bash, on by default with Git Bash for claude.ai and Console accounts, and needs `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` in Amazon Bedrock, Google Cloud's Agent Platform, and Microsoft Foundry sessions and on macOS, Linux, and WSL. Set it to `0` to turn the tool off. |
| `metadata` | No | Free-form YAML map for your own key-value data, such as entitlement or catalog fields, read by your own tooling from `SKILL.md`. Claude Code doesn't act on its contents, and drops a value that isn't a map. Don't reuse frontmatter field names such as `paths` as keys. |
| `license` | No | License covering the skill. Part of the [Agent Skills](https://agentskills.io) spec; see [Using skill frontmatter outside Claude Code](#using-skill-frontmatter-outside-claude-code). Claude Code accepts the field but doesn't act on it. |
| `compatibility` | No | Environment requirements for the skill, such as intended products or system prerequisites, as defined by the [Agent Skills](https://agentskills.io) spec; see [Using skill frontmatter outside Claude Code](#using-skill-frontmatter-outside-claude-code). Accepts a string of up to 500 characters. Claude Code accepts the field but doesn't act on it. |

Which apply to plugin skills: all of them (skills.md L356, L360):

> Claude Code accepts every field in the table above.

> | Claude Code skills at [any level](#where-skills-live), including [plugin](/docs/en/plugins) skills | Every field in the table above |

Outside Claude Code (claude.ai uploads, Skills API, `package_skill.py`) only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are allowed; anything else is a hard error (skills.md L361-L371):

```
Unexpected key(s) in SKILL.md frontmatter: argument-hint. Allowed properties are: allowed-tools, compatibility, description, license, metadata, name
```

`version`: **Not found in docs.** No `version` frontmatter field appears in the table (L331-L352); grep for "version" in skills.md hit only Claude Code version markers (`v2.1.x`), `node --version` in the injection example (L630), the skill-creator "Version comparison" bullet (L848), and "version control" (L858).

Plugin-specific substitutions in skill bodies and in `allowed-tools` Bash rules (skills.md L407-L412):

> | `${CLAUDE_SKILL_DIR}`   | The directory containing the skill's `SKILL.md` file. For plugin skills, this is the skill's subdirectory within the plugin, not the plugin root. ... |
> | `${CLAUDE_PLUGIN_ROOT}` | The plugin's installation directory. Substituted only in plugin skills. ... |
> | `${CLAUDE_PLUGIN_DATA}` | The plugin's [persistent data directory](/docs/en/plugins-reference#persistent-data-directory), which survives plugin updates. Substituted only in plugin skills. ... |

> Claude Code substitutes `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` in two places: the skill's markdown content, and Bash rules in the [`allowed-tools`](#frontmatter-reference) frontmatter. In a plugin skill, Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in the same two places. Using the same variable in both places lets a skill run a bundled script without a permission prompt.

Example verbatim (skills.md L414-L422):

```yaml
---
name: render-chart
description: Render a chart from a CSV file
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)
---

Run `${CLAUDE_SKILL_DIR}/scripts/render.sh <csv-file>` to render the chart.
```

Other substitutions: `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_PROJECT_DIR}` (v2.1.196+) (skills.md L405-L408, L426).

## 2. Skill vs command

Commands are merged into skills (skills.md L16):

> **Custom commands have been merged into skills.** A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working. Skills add optional features: a directory for supporting files, frontmatter to control whether you or Claude invokes them, and the ability for Claude to load them automatically when relevant.

Command files are the older format; skills are recommended (skills.md L131):

> **Command files**: a Markdown file in `.claude/commands/` is the older format and still works. It supports the same [frontmatter](#frontmatter-reference) except `name` and `paths`. ... Prefer a skill for new work, since skills also support [supporting files](#add-supporting-files).

When both exist with one name, the skill wins (skills.md L165). Not marked deprecated anywhere in skills.md; the word "deprecated" does not appear.

How each gets its slash name (skills.md L375, table L379-L387, L389, L393):

> The command you type to invoke a skill comes from where the skill file lives and, for plugin skills, also from the frontmatter `name` field. In a personal or project skill, `name` sets only the display label shown in skill listings, and the command still comes from the directory name. In a plugin skill, `name` sets the last segment of the command and the plugin prefix stays in place.

| Skill location | Command name source | Example |
| :-- | :-- | :-- |
| Skill directory under `~/.claude/skills/` or `.claude/skills/` | Directory name | `.claude/skills/deploy-staging/SKILL.md` → `/deploy-staging` |
| Nested `.claude/skills/` directory, when the name clashes with another skill | Subdirectory path relative to the working directory, then the skill directory name | `apps/web/.claude/skills/deploy/SKILL.md` → `/apps/web:deploy` |
| File under `.claude/commands/` | File name without extension | `.claude/commands/deploy.md` → `/deploy` |
| File in a subdirectory of `.claude/commands/` | Subdirectory path relative to `commands/` with each `/` replaced by `:`, then the file name without extension | `.claude/commands/frontend/component.md` → `/frontend:component` |
| Plugin `skills/` subdirectory | Frontmatter `name` or the directory name, namespaced by plugin | `my-plugin/skills/review/SKILL.md` → `/my-plugin:review`, or `/my-plugin:fancy` with `name: fancy` |
| Plugin root `SKILL.md` | Frontmatter `name`, with the plugin directory name as a fallback | `my-plugin/SKILL.md` with `name: review` → `/my-plugin:review`. See Path behavior rules |
| Skill synced from claude.ai | The skill's name on your claude.ai account, prefixed with `anthropic-skills:` | Account skill `deploy` → `/anthropic-skills:deploy`, or `/deploy` while no other command uses that name |

> In a plugin skill, the frontmatter `name` replaces the directory name in the last segment of the command, so `my-plugin/skills/review/SKILL.md` with `name: fancy` becomes `/my-plugin:fancy`. The bare `/fancy` also invokes the skill unless another command already uses that name. If the `name` you write already starts with the plugin's own prefix, Claude Code doesn't add the prefix again on v2.1.246 or later. For example, `name: my-plugin:fancy` still becomes `/my-plugin:fancy`. From v2.1.216 through v2.1.245, Claude Code doubled the prefix when the `name` already carried it. (skills.md L389)

> In [non-interactive sessions](/docs/en/headless), the names `help` and `feedback` aren't reserved for their terminal-only built-in commands, so a plugin skill with one of those names keeps its bare command there. Every other terminal-only built-in's name, such as `/login`, stays reserved even though the command can't run in those sessions. (skills.md L391)

Plugin location row (skills.md L124): `<plugin>/skills/<skill-name>/SKILL.md` loads "Wherever the plugin is enabled, as `/plugin-name:skill-name`". A plugin `commands/` directory is **not described in skills.md**; only `.claude/commands/` is (see plugins-reference, out of scope here).

Removing a plugin skill: "disable or uninstall the plugin that provides it, from the `/plugin` menu or with `/plugin uninstall <plugin-name>@<marketplace-name>`" (skills.md L264). Install form used in the docs: `/plugin install skill-creator@claude-plugins-official` and `/plugin marketplace add anthropics/claude-plugins-official` (skills.md L834, L839); the summary may say `Run /reload-plugins to activate.`, and `/reload-plugins --force` may be needed (L842).

## 3. Arguments

Substitution table (skills.md L401-L404):

> | `$ARGUMENTS`            | All arguments passed when invoking the skill. When no placeholder receives an argument, Claude Code appends them as `ARGUMENTS: <value>`. ... |
> | `$ARGUMENTS[N]`         | Access a specific argument by 0-based index, such as `$ARGUMENTS[0]` for the first argument. |
> | `$N`                    | Shorthand for `$ARGUMENTS[N]`, such as `$0` for the first argument or `$1` for the second. |
> | `$name`                 | Named argument declared in the [`arguments`](#frontmatter-reference) frontmatter list. Names map to positions in order, so with `arguments: [issue, branch]` the placeholder `$issue` expands to the first argument and `$branch` to the second. |

Quoting and edge cases (skills.md L428-L434):

> Indexed arguments use shell-style quoting, so wrap multi-word values in quotes to pass them as a single argument. For example, `/my-skill "hello world" second` makes `$0` expand to `hello world` and `$1` to `second`. The `$ARGUMENTS` placeholder always expands to the full argument string as typed.

> An indexed placeholder with no corresponding argument, such as `$2` when only one argument was passed, stays in the content unchanged. A named placeholder from the `arguments` frontmatter with no matching argument expands to an empty string.

> If you pass an argument value that itself contains text such as `$1` or `$ARGUMENTS`, Claude Code inserts it as literal text and doesn't expand it. ... Claude Code still replaces `${CLAUDE_*}` variables such as `${CLAUDE_SKILL_DIR}` after it inserts the arguments.

Escape: `\$1.00` keeps a literal `$1` (L434). Fallback when nothing receives args (L565): `ARGUMENTS: <your input>` is appended. Skill stacking: `/write-tests /fix-issue 123` loads both and passes `123` to each; up to six skills (first plus five), expansion stops at a forked skill (L567-L569; commands.md L13). Example `/fix-issue 123` → "Fix GitHub issue 123 following our coding standards..." (L547-L563); `$0 $1 $2` example (L585-L593).

How `/synchrobuilder:notify <handle> <message>` receives input: `$0` (or `arguments: [handle, message]` then `$handle`) = first whitespace-separated token; `$1`/`$message` = only the second token because indexed args are shell-style split (L428); `$ARGUMENTS` = the whole string "as typed". A multi-word message therefore arrives intact only through `$ARGUMENTS`, or through `$1` if the user quotes it. `argument-hint: <handle> <message>` drives autocomplete (L336).

## 4. Dynamic context injection

Syntax and semantics (skills.md L599, L621, L623, L625-L633):

> The `` !`<command>` `` syntax runs shell commands before the skill content is sent to Claude. The command output replaces the placeholder, so Claude receives actual data, not the command itself.

> Substitution runs once over the original file. Command output is inserted as plain text and is not re-scanned for further `` !`<command>` `` placeholders, so a command cannot emit a placeholder for a later pass to expand.

> The inline form is only recognized when `!` appears at the start of a line or immediately after whitespace. If `!` follows another character, as in `` KEY=!`cmd` ``, the placeholder is left as literal text and the command does not run.

Multi-line form (L625-L633):

````markdown
## Environment
```!
node --version
git status --short
```
````

Example verbatim (L603-L619):

```yaml
---
name: pr-summary
description: Summarize changes in a pull request
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---

## Pull request context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Your task
Summarize this pull request...
```

It is always a shell (skills.md L645-L649):

> Claude Code picks the tool that runs a skill's injected commands from the `shell` key in the skill's frontmatter and your environment. Every combination runs the commands through the Bash tool or the PowerShell tool, except one that fails the invocation outright:
> * `shell: powershell`, with the PowerShell tool enabled: the commands run through the PowerShell tool.
> * `shell: bash` when bash isn't available: the invocation fails before any command runs. This happens on Windows without Git Bash. Claude Code shows ``Skill <name> requires bash (`shell: bash` in frontmatter) but Git Bash was not found``.
> * Any other combination: the commands run through the Bash tool when bash is available. When it isn't, they run through the PowerShell tool.

Runtime behavior (L653-L656): runs in the session shell's cwd (moves with `cd`; use `${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}`); stderr merged into stdout under bash; 2-minute Bash timeout, auto-background may apply, otherwise killed and the invocation aborts; oversized output arrives as a file path plus preview.

Failure (L662-L664, L671):

> A failed command aborts the entire skill invocation, not just its own placeholder. Claude never sees the skill content for that invocation. The abort shows `Shell command failed for pattern "..."`. The error message includes the command's output under `[stderr]`.

> With the default `bash` shell, any non-zero exit code counts as a failure. One carveout applies: Claude Code treats exit code 1 from search and comparison commands as a normal result and injects their output. Exit codes of 2 or higher fail even for those commands.

Permissions (L675-L679):

> Injected commands never prompt for permission while the skill renders. Claude Code checks each one against your permission rules first. A command a deny rule matches aborts the invocation with `Shell command permission check failed for pattern "..."`.

> Outside auto mode, when a command's permission check returns anything other than allow, Claude Code aborts the invocation with the same error. This includes a rule that would normally ask you. To keep an unmatched command from aborting here, pre-approve it with `allowed-tools`. Deny and ask rules still override `allowed-tools`.

In auto mode an unapproved command does not abort; the skill loads with an instruction telling Claude to run it first (L679). The same paragraph names two cases where it still aborts even in auto mode (L679):

> The invocation still aborts in a forked skill that sets `agent`, and in a session where Claude doesn't have the shell tool that runs injected commands.

Policy kill-switch (L635):

> To disable this behavior for skills and custom commands from user, project, plugin, or additional-directory sources, set `"disableSkillShellExecution": true` in settings. Each command is replaced with `[shell command execution disabled by policy]` instead of being run. Bundled and managed skills are not affected.

Synced skills never run `!` commands locally (L599, L637, L248).

Non-shell alternative: **Not found in docs.** skills.md documents no injection mechanism other than `!` shell commands. The only other body feature mentioned is `@` file references, which appear once, obliquely, in the synced-skill section (L248: "doesn't attach the files that `@` references name the way it does for a local skill"); skills.md has no section defining `@` references. Searched: "@", "attach", "inject", "hook", "MCP".

## 5. Control who invokes a skill

(skills.md L475-L479, L498, L502-L506, L776, L1075)

> * **`disable-model-invocation: true`**: Only you can invoke the skill. Use this for workflows with side effects or that you want to control timing, like `/commit`, `/deploy`, or `/send-slack-message`. You don't want Claude deciding to deploy because your code looks ready.
> * **`user-invocable: false`**: Only Claude can invoke the skill. Use this for background knowledge that isn't actionable as a command. ...

> If Claude tries anyway, Claude Code blocks the call and instructs it not to reproduce the deploy steps another way, so expect Claude to suggest running `/deploy` yourself.

| Frontmatter | You can invoke | Claude can invoke | When loaded into context |
| :-- | :-- | :-- | :-- |
| (default) | Yes | Yes | Description always in context, full skill loads when invoked |
| `disable-model-invocation: true` | Yes | No | Description not in context, full skill loads when you invoke |
| `user-invocable: false` | No | Yes | Description always in context, full skill loads when invoked |

> With `user-invocable: false`, you can't invoke the skill, but Claude still can. To keep Claude from invoking it through the Skill tool, set `disable-model-invocation: true`.

Troubleshooting "triggers too often": make the description more specific, or add `disable-model-invocation: true` (L1074-L1075). Settings-side equivalent without editing the file: `skillOverrides` states `on`, `name-only`, `user-invocable-only`, `off` (L783-L805), but "Plugin skills are not affected by `skillOverrides`. Manage those through `/plugin` instead." (L811). Permission rules: `Skill(name)` exact, `Skill(name *)` prefix; deny `Skill` disables all (L749-L767).

## 6. Pre-approve tools (`allowed-tools`)

(skills.md L524, L526, L530-L537, L539, L745)

> The `allowed-tools` field grants permission for the listed tools during the turn that invokes the skill, so Claude can use them without prompting you for approval. The grant clears when you send your next message, even though the skill content stays in context; invoking the skill again re-applies it for that turn. It does not restrict which tools are available: every tool remains callable, and your permission settings still govern tools that are not listed. To pre-approve tools for the whole session rather than a single turn, add allow rules to those permission settings instead.

> Workspace trust doesn't gate this field. Claude Code applies a project skill's `allowed-tools` whenever you or Claude invoke the skill, including in a `-p` run in a folder you've never trusted. A skill can grant itself broad tool access, so review the `allowed-tools` of skills checked into a repository before you run Claude Code there.

```yaml
---
name: commit
description: Stage and commit the current changes
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)
---
```

Plugin skills: the field applies (all fields apply, L356/L360) and `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PLUGIN_DATA}` are substituted inside `allowed-tools` Bash rules for plugin skills (L412). `disallowed-tools` removes tools for the turn (L539). Deny/ask rules override `allowed-tools` for injected commands (L677).

## 7. Run skills in a subagent (`context: fork`)

(skills.md L683, L686, L689, L691-L696, L698, L700, L703, L708-L713, L741)

> Add `context: fork` to your frontmatter when you want a skill to run in isolation. Claude Code starts a new subagent of the type set in the `agent` field and gives it the skill content as its prompt. The subagent doesn't see your conversation history, so the skill's instructions have to stand on their own.

> Despite the name, a skill with `context: fork` doesn't run in a fork of the current conversation, which would hand the subagent everything you've discussed so far.

> The forked subagent runs in the background: you keep working while it runs, and its result arrives in your conversation when it completes. Set `background: false` in the frontmatter to instead wait for the result in the turn that invoked the skill. Before v2.1.218, forked skills always blocked the turn until they finished.

Always waits anyway: non-interactive `-p`/SDK; `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`; same skill already running; scheduled task (L693-L696). Cost/limits: a backgrounded fork gets the narrower background tool set (L698; sub-agents.md L421 lists it: `Read`, `Grep`, `Glob`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`, `Monitor`, `TaskStop`, `SendMessage`, `Artifact`); background edits are outside checkpoints so `/rewind` can't undo them (L700); a guideline-only skill returns nothing useful (L703). `agent` accepts "built-in agents (`Explore`, `Plan`, `general-purpose`) or any custom subagent from `.claude/agents/`. If omitted, uses `general-purpose`" (L741); plugin agents are not mentioned as `agent` values. Explore/Plan skip CLAUDE.md (L713). Injected `!` commands in a forked skill that sets `agent` abort the invocation when they are not pre-approved, even in auto mode (L679).

## 8. Description limits and auto-activation

Cap and budget (skills.md L334-L335, L1079, L1081, L1083, L1085):

> Claude Code loads a listing of skill names and descriptions into context so Claude knows what's available. The listing always contains every skill name, but if you have many skills, Claude Code shortens descriptions to fit the listing's character budget, which can strip the keywords Claude needs to match your request. The budget scales at 1% of the model's context window. When the listing overflows, Claude Code drops descriptions starting with the skills you invoke least, so the skills you use most keep their full text.

> ... put the key use case first, since each entry's combined text is capped at 1,536 characters regardless of budget. The cap is configurable with `skillListingMaxDescChars`.

Raise with `skillListingBudgetFraction` (e.g. `0.02`) or `SLASH_COMMAND_TOOL_CHAR_BUDGET`; `/doctor` estimates cost; `/skill-doctor` (v2.1.252+) finds unused skills; `/context` Skills row shows post-budget size (from v2.1.196) (L1081-L1085). Every listed skill costs context on every turn (L815).

Not triggering (L1059-L1068): put natural keywords in the description; check `What skills are available?`; malformed YAML loads the body with empty metadata so `/name` works but matching fails (`--debug` shows the parse error); plugin skills can be measured with `claude plugin eval` and a `tool_used: Skill` grader; `claude plugin validate <dir>` finds unparseable SKILL.md (v2.1.233+). Content lifecycle: invoked content stays in context across turns and is not re-read (L514); re-invocation with identical rendered content adds a short note only (L516); compaction keeps first 5,000 tokens per skill within a 25,000-token shared budget (L518).

## 9. Name resolution and aliases

Precedence table (skills.md L161-L168), key rows:

> | Two of enterprise, personal, and project | Enterprise over personal, and personal over project. ... |
> | Any of those locations and a bundled skill | Your skill replaces the bundled command, but not its aliases. A project `code-review` skill replaces `/code-review`, and the bundled alias `/review` never runs your skill |
> | A skill and a file in `.claude/commands/` | The skill |
> | A plugin skill and a skill at any of the locations above | Both load, because plugin skills are namespaced as `/plugin-name:skill-name` |
> | Any of the above and a skill synced from your claude.ai account | The other skill or command. The synced skill still runs as `/anthropic-skills:<name>`. ... |

Name comparison ignores case, spacing, invisible characters, and compatibility forms (fullwidth, dash variants); look-alike letters from other alphabets count as different (L231-L233, v2.1.228+; stated for synced skills). A plugin skill is listed among the "other command" kinds that take the bare short name away from a claude.ai-synced skill of the same name, so `/name` runs the plugin skill and the synced one keeps only `/anthropic-skills:name` (L220, L222-L227).

Aliases in the docs exist only for bundled/built-in commands: `/review` for `/code-review` (L164, commands.md L129), `checkup` for `/doctor` (L807, commands.md L83), `/bg` (commands.md L59), `/reset`/`/new` (L67), `/cost`/`/stats` (L74, L142), `/peers` for `/list-agents` (L103), `/bashes` for `/tasks` (L148). Deny rules match aliases; allow rules match only the skill's own name (skills.md L769-L771). `skillOverrides` under an alias works only in managed/`--settings` sources (L807-L809).

**Conclusion on plugin aliases / short prefix: Not found in docs.** Nothing in skills.md or commands.md lets a plugin declare an alias, a second name, or a shorter namespace prefix for a skill. Searched skills.md and commands.md for "alias", "search alias", "prefix", "short name", "shorter". What the docs do provide: (a) the prefix is always the plugin name (L375, L385); (b) `name` in a plugin skill changes only the last segment (L389); (c) the bare short form `/fancy` works "unless another command already uses that name" (L389). So `/audit` would reach `/synchrobuilder:audit` only via that bare fallback, not via an alias, and `/sb:audit` is possible only if the plugin itself is named `sb`.

## 10. commands.md: menu matching and command rows

Matching rules verbatim (commands.md L170-L173):

> * **Highlighting**: Claude Code highlights the top suggestion only when the letters after the `/` match a command's name or alias, from the start of the name or from a word within it, ignoring the `:`, `_`, and `-` separators. Typing `/adddir` highlights `/add-dir`, and typing `/new` highlights `/clear` through its alias. Press `Enter` to run the highlighted suggestion. These highlighting rules require Claude Code v2.1.236 or later.
> * **After a typo**: Claude Code highlights nothing. The close matches stay listed, and you can pick one with `Tab` or the arrow keys, but `Enter` submits your text as typed and reports Unknown command.
> * **Commands that aren't available to you**: Claude Code leaves them out of the menu. When nothing matches, Claude Code shows `No commands match "/name"`. ...
> * **Hidden commands**: Claude Code keeps a few available commands, such as `/heapdump`, out of the menu by design. ...

Would `/audit` highlight `/synchrobuilder:audit`? By the rule, "audit" is a word within `synchrobuilder:audit` (separator `:` ignored), so it qualifies for highlighting on v2.1.236+; the docs say nothing about how v2.1.218 highlights (see open question 1). The docs do not say how ties are ordered when several commands match (e.g. `/init` typed while built-in `/init` and `/synchrobuilder:init` both match). Also, per skills.md L389 the bare `/audit` is itself a valid invocation when nothing else uses the name.

Other rules: command only recognized at message start; trailing text becomes arguments (commands.md L13); commands sent mid-response are queued (L15); bundled skills are marked **Skill** in the table (L37); `/init` and `/security-review` are also reachable through the Skill tool (skills.md L745).

Rows copied verbatim (commands.md):

> | `/plugin [subcommand]` | Manage Claude Code plugins. Run with no argument to open the plugin menu, or pass a subcommand such as `list`, `install`, `enable`, or `disable` to act directly. Claude Code can activate a plugin during the install; the install summary tells you whether it did or whether to run `/reload-plugins` | (L115)

> | `/hooks` | View hook configurations for tool events | (L95)

> | `/statusline` | Configure Claude Code's status line. Describe what you want, or run without arguments to auto-configure from your shell prompt | (L144)

> | `/reload-plugins [--force]` | Reload all active plugins to apply pending changes without restarting. Reports counts for each reloaded component and flags any load errors. When the reload would change which MCP tools are loaded and invalidate the prompt cache, the command warns and skips unless you pass `--force`. Also available in non-interactive mode (`-p`), the Agent SDK, and the desktop app, where it runs only on input typed directly into the session and doesn't apply plugin MCP server changes; requires Claude Code v2.1.260 or later. See Apply plugin changes without restarting | (L123)

> | `/list-agents` | List the subagents, agent team teammates, and other Claude Code sessions Claude can message, with the name to use for each. See cross-session messaging. Also available as `/peers`. Requires Claude Code v2.1.224 or later; earlier versions report `Unknown command: /list-agents`. Teammate rows and the first line showing this session's own name require v2.1.239 or later. Available only in sessions where cross-session messaging is enabled | (L103; `/peers` has no separate row)

> | `/mcp [reconnect <server>\|enable\|disable [<server>\|all]]` | Manage MCP server connections and OAuth authentication. Run with no argument to open the interactive list, pass `reconnect <server>` to reconnect one disconnected server, or pass `enable`/`disable` with a server name or `all` to change connection state without opening the dialog. Also available in non-interactive mode (`-p`), where running it with no argument prints a text summary of server status instead of opening the list; requires Claude Code v2.1.205 or later | (L107)

> | `/doctor` | **Skill.** Run a setup checkup that diagnoses issues and can fix them. Checks installation health, including duplicate or leftover installs, `PATH` problems, and unparseable settings files. Finds unused skills, MCP servers, and plugins versus their context cost, flags slow hooks, and checks for a newer version on your release channel. Deduplicates local `CLAUDE.md` files against checked-in ones, trims checked-in `CLAUDE.md` files by cutting content Claude could derive from the codebase, and migrates the always-loaded guidance that remains into skills and nested `CLAUDE.md` files that load on demand. Also offers to make auto mode your default and to pre-approve frequently denied read-only commands. Reports findings first and asks for confirmation before changing anything. From the terminal, `claude doctor` prints read-only installation diagnostics without starting a session. Alias: `/checkup`. The `CLAUDE.md` trim check requires Claude Code v2.1.206 or later. Before v2.1.205, `/doctor` opened a read-only diagnostics screen and pressing `f` sent the report to Claude | (L83; link markup removed)

Also relevant: `/reload-skills` re-scans skill and command directories (L124); `/skills` lists skills and cycles visibility, but "You can't cycle plugin skills" (L141); `/init` is a built-in command (L98). Built-in names in the table that collide with brief command names: `/init` (L98) and `/doctor` (L83). No built-in `/audit`, `/fix`, `/setup`, `/ci`, `/mute`, `/notify`, `/iam` appears in the table (L52-L164). The nearest neighbours are `/setup-bedrock` and `/setup-vertex` (L137-L138), which are hidden from the menu until `CLAUDE_CODE_USE_BEDROCK=1` / `CLAUDE_CODE_USE_VERTEX=1` is set and do not own the name `setup`.

## 11. sub-agents.md: agent frontmatter and plugin agents

Required fields: "Only `name` and `description` are required." (sub-agents.md L290). Table rows, abbreviated to field, required, and the decisive wording (L292-L311):

| Field | Req | Key wording (verbatim fragments) |
| :-- | :-- | :-- |
| `name` | Yes | "Unique identifier using lowercase letters and hyphens. Hooks receive this value as `agent_type`. The filename doesn't have to match. Names can't contain `:`, which is reserved for plugin-scoped identifiers such as `my-plugin:reviewer`. Claude Code doesn't load a file whose name contains one and logs an error to the debug log. Before v2.1.218, such names were accepted" |
| `description` | Yes | "When Claude should delegate to this subagent" |
| `tools` | No | "Inherits every tool available to subagents if omitted. If no entry in the list resolves to a tool, the subagent usually fails to launch ... To preload Skills into context, use the `skills` field rather than listing `Skill` here" |
| `disallowedTools` | No | "Tools to deny, removed from inherited or specified list. An entry with a specifier, such as `Bash(git push *)`, still removes the whole tool" |
| `model` | No | "`sonnet`, `opus`, `haiku`, `fable`, a full model ID such as `claude-opus-5`, or `inherit`" |
| `permissionMode` | No | "`default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, or `manual` as an alias for `default`. ... Ignored for plugin subagents" |
| `maxTurns` | No | "Maximum number of agentic turns before the subagent stops" |
| `skills` | No | "Skills to preload into the subagent's context at startup. The full skill content is injected, not only the description. Subagents can still invoke unlisted project, user, and plugin skills through the Skill tool" |
| `mcpServers` | No | "... Ignored for plugin subagents" |
| `hooks` | No | "Lifecycle hooks scoped to this subagent. Ignored for plugin subagents" |
| `memory` | No | "Persistent memory scope: `user`, `project`, or `local`" |
| `background` | No | "Set to `true` to keep this subagent in the background even when Claude asks to run it in the foreground. Where fork mode is on, Claude Code already runs the subagents Claude spawns in the background" |
| `omitClaudeMd` | No | "Set to `true` to launch this subagent without the user, project, and local CLAUDE.md files ... Requires Claude Code v2.1.271 or later" |
| `effort` | No | "`low`, `medium`, `high`, `xhigh`, `max`" |
| `isolation` | No | "Set to `worktree` to run the subagent in a temporary git worktree" |
| `color` | No | "`red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, or `cyan`" |
| `initialPrompt` | No | "Auto-submitted as the first user turn when this agent runs as the main session agent (via `--agent` or the `agent` setting)" |
| `experimental` | No | "Map of experimental options. Set its `cacheTtl` key to `5m` or `1h` ... Requires Claude Code v2.1.248 or later" |

Example file (L255-L265):

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. When invoked, analyze the code and provide
specific, actionable feedback on quality, security, and best practices.
```

Plugin agents (L169, L183, L233, L236, L336):

> | Plugin's `agents/` directory | Where plugin is enabled | 5 (lowest) | Installed with plugins |

> Plugin `agents/` directories are also scanned recursively. Unlike project and user scopes, a subfolder inside a plugin's `agents/` directory becomes part of the scoped identifier: a file at `agents/review/security.md` in plugin `my-plugin` registers as `my-plugin:review:security`.

> For security reasons, plugin subagents don't support the `hooks`, `mcpServers`, or `permissionMode` frontmatter fields. These fields are ignored when loading agents from a plugin. If you need them, copy the agent file into `.claude/agents/` or `~/.claude/agents/`. You can also add rules to `permissions.allow` in `settings.json` or `settings.local.json`, but these rules apply to the entire session, not only the plugin subagent.

> A plugin subagent whose frontmatter has no `name` or doesn't parse still loads, under its filename.

Invocation: typeahead shows `my-plugin:code-reviewer`; manual form `@agent-my-plugin:code-reviewer` (L828-L830); `claude --agent security-reviewer` finds a plugin agent by bare name, `claude --agent my-plugin:security-reviewer` disambiguates (L844-L856); `SubagentStart`/`SubagentStop` matchers use the scoped identifier, regex-unanchored, so use `^my-plugin:db-agent$` (L767). Descriptions count toward a 15,000-token startup warning (L803). In "a project, user, or managed `agents` directory, or in one under a directory you add with `--add-dir`", files are skipped when `name` is missing, `---` is not the first line, the name starts with `-` or contains `:`, there is no description, or the YAML doesn't parse (L326-L332). That skip list is stated for those directories only; for plugins, L336 (quoted above) says a file with no `name` or unparseable frontmatter still loads under its filename.

Background: the `background` field is in the general table (L305) and is not in the plugin exclusion list (L236), so nothing in the docs says plugin agents cannot be background; the docs do not state it positively either. Fork mode (default on in interactive sessions) already runs spawned subagents in the background (L879); background subagents get the narrower built-in tool set (L884, L421); a teammate cannot spawn a `background: true` subagent (L877).

---

## Implications for Synchrobuilder

1. Ship every command as `plugins/synchrobuilder/skills/<name>/SKILL.md`, not `commands/<name>.md`: skills are the recommended format, support supporting files and `name`/`paths`, and `.claude/commands/` is "the older format" (skills.md L16, L131). Slash names become `/synchrobuilder:audit`, `/synchrobuilder:fix`, etc. (L124, L385).
2. Bare short forms `/audit`, `/fix`, `/setup`, `/ci`, `/mute`, `/notify`, `/iam` will resolve to the plugin skills as long as no other command uses the name (L389); `/init` and `/doctor` will not, because built-in `/init` (commands.md L98) and bundled `/doctor` (L83) own those names. Consider renaming to avoid user confusion (e.g. `init-team`, `checkup` is itself an alias of `/doctor` so avoid it).
3. Do not set `name: synchrobuilder:audit`: on the local v2.1.218 (range v2.1.216-v2.1.245) the prefix is doubled (L389). Either omit `name` or use the bare last segment.
4. User-only commands (`mute`, `iam`, `notify`, `fix`, `setup`, `init`) should set `disable-model-invocation: true`; this also removes their descriptions from the per-turn listing and frees the 1% listing budget (L505, L1079). Keep `audit`/`doctor` model-invocable only if auto-triggering is wanted; each such description costs context every turn (L815) and is capped at 1,536 chars (L334).
5. Injected context (`!`node ...``) is the only documented pre-render mechanism and it always runs through the Bash or PowerShell tool (L645-L649). The shipped code can still be `.mjs` invoked as `node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"`; the shell is Claude Code's, not the plugin's. Because a non-zero exit aborts the whole invocation and hides the skill body (L662-L664), every script must exit 0 and print nothing on internal error, matching the brief's fail-open rule. Also budget for the 2-minute timeout and cwd drift; use `${CLAUDE_PLUGIN_ROOT}` (L653, L409).
6. Pre-approve the exact node command in `allowed-tools`, e.g. `Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs *)`, so injected commands don't abort on an "ask" rule outside auto mode (L677) and Claude's own follow-up call doesn't prompt (L412-L424). The grant is per-turn only (L524). Deny rules still win (L677). `disableSkillShellExecution` can replace commands with a placeholder for plugin skills (L635); the body must still make sense when that happens.
7. `${CLAUDE_PLUGIN_DATA}` survives updates and is substituted in plugin skills (L410); a natural home for the local snapshot cache and logs.
8. `/synchrobuilder:notify <handle> <message>`: use `$0` (or `arguments: [handle]` → `$handle`) for the handle and `$ARGUMENTS` for the full text; multi-word messages are split by shell-style quoting under `$1` (L428). If passing args into an injected command, note that arguments are inserted as literal text (L432) and the shell will see them, so the script must not rely on shell parsing of user text (open question 2).
9. `context: fork` suits long, self-contained jobs (`ci`, a full `audit`) that should not flood the main context; the default is background with a narrower tool set and results arrive later (L689, L698). Anything that must answer in the same turn (guard, presence, claims) must stay inline. The local v2.1.218 is the first version with the `background` field (L346). If a forked skill sets `agent` and also uses `!` injection, every injected command must be covered by `allowed-tools`, because in that case an unapproved command aborts the invocation even in auto mode (L679).
10. Skill `hooks` frontmatter registers hooks for the rest of the session when the skill is invoked (L347); a possible route for opt-in guard behavior via `/synchrobuilder:setup`, but see hooks.md (other note).
11. Plugin agents, if any, are addressed as `synchrobuilder:<name>`; their `hooks`, `mcpServers`, `permissionMode` are ignored (sub-agents.md L236), so any agent-scoped hooks must live in the plugin's hooks.json instead. Hook matchers for them must be anchored regexes (L767).
12. Install page commands confirmed by the docs' own examples: `/plugin marketplace add <owner>/<repo>` (form `anthropics/claude-plugins-official`, skills.md L839) and `/plugin install <plugin>@<marketplace>` (L834); after install, `/reload-plugins` or `/reload-plugins --force` may be required (L842, commands.md L123). Uninstall: `/plugin uninstall <plugin-name>@<marketplace-name>` (skills.md L264).
13. Keep `SKILL.md` under 500 lines and move reference material to sibling files (L471); invoked content persists across turns and is not re-read (L514), so bodies should be short standing instructions.
14. Validation/CI: `claude plugin validate <dir>` (v2.1.233+) finds unparseable SKILL.md frontmatter (L1068) and agent files (sub-agents.md L340); `claude plugin eval` with a `tool_used: Skill` grader measures trigger rates (L1066). Both are newer than the local v2.1.218.

## Conflicts with the brief

| Brief says | Docs say | Source |
| :-- | :-- | :-- |
| Plugin is named `synchrobuilder` and a shorter prefix or alias like `/sb:audit` is wanted | The prefix is always the plugin name; `name` only changes the last segment; no alias mechanism exists for plugin skills. Only a plugin literally named `sb` yields `/sb:audit`. | skills.md L375, L385, L389; alias search: not found |
| Commands `/synchrobuilder:init` and `/synchrobuilder:doctor` | Fully qualified forms work, but the bare fallbacks `/init` and `/doctor` are taken by a built-in command and a bundled skill, so users typing the short form get Claude Code's own commands. | skills.md L389; commands.md L98, L83 |
| "NO bash/PowerShell/cmd anywhere in shipped code" and dynamic context in the same turn | `!` injection is the only documented pre-render mechanism, and "Every combination runs the commands through the Bash tool or the PowerShell tool". On Windows without Git Bash the default runs via PowerShell; `shell: bash` there fails the invocation. Shipping `.mjs` is compatible, but the invocation line is a shell command string. | skills.md L599, L645-L649 |
| Fail open: exit 0, no output on internal error | Any non-zero exit (2+ even for search commands) aborts the entire skill invocation and Claude never sees the body; a command killed at the 2-minute timeout also aborts. The scripts must enforce exit 0 themselves. | skills.md L655, L662-L664 |
| Advisory, consent before changing a machine | `allowed-tools` grants are not gated by workspace trust and apply even in untrusted `-p` runs; injected commands never prompt. Keep injected commands read-only and put machine changes behind Claude tool calls that can prompt. | skills.md L526, L675 |
| `/synchrobuilder:notify <handle> <message>` as positional args | Indexed args are shell-style split; only `$ARGUMENTS` carries the full message unless the user quotes it. | skills.md L428 |
| Hooks-like behavior from plugin agents | Plugin subagents ignore `hooks`, `mcpServers`, `permissionMode`. | sub-agents.md L236 |
| Status line presence "if docs confirm plugins can drive the status line" | commands.md only says `/statusline` configures the status line, and sub-agents.md lists a built-in `statusline-setup` helper agent used "When you run `/statusline`"; nothing in these three docs addresses plugin-driven status lines. Not settled here. | commands.md L144; sub-agents.md L78 |

## Open questions

1. Menu behavior on the local v2.1.218: the word-within-name highlighting rule requires v2.1.236+ (commands.md L170). Does typing `/audit` on v2.1.218 list or highlight `/synchrobuilder:audit`, and which entry is highlighted when both `/init` and `/synchrobuilder:init` match?
2. Order of substitution: do `$ARGUMENTS`/`$0` expand before `!` commands run, so an injected line like `` !`node "${CLAUDE_PLUGIN_ROOT}/scripts/notify.mjs" $ARGUMENTS` `` sees the user text? skills.md L432 and L621 describe arguments and injection separately but not their order. If it does expand, how must user text be quoted to be safe?
3. On Windows without Git Bash, does a plugin skill with no `shell` key run `node "<path>"` correctly through the PowerShell tool (L649), and does `${CLAUDE_PLUGIN_ROOT}` expand to a path PowerShell accepts?
4. Does the bare fallback `/audit` (skills.md L389) also work for Claude's Skill-tool invocations, or only for typed input?
5. Is `background: true` honored on a plugin agent (not excluded at sub-agents.md L236, but never confirmed)?
6. Does the synced-skill description sanitization (angle brackets escaped, L240) apply to plugin skill descriptions too? Relevant to how teammate text is labeled.
7. Does `/plugin marketplace add <owner>/<repo>` resolve an arbitrary GitHub repo with `.claude-plugin/marketplace.json` at root the same way the docs' `anthropics/claude-plugins-official` example does (skills.md L839)? Needs the plugin-marketplaces note or an experiment.
8. `claude plugin validate` and `claude plugin eval` require v2.1.233+/newer; what does v2.1.218 offer for CI validation?

## Not found in docs

- Any way for a plugin to declare an alias, second short name, or shorter namespace prefix for a skill (searched "alias", "search alias", "prefix", "short name", "shorter" in skills.md and commands.md).
- A `version` frontmatter field for SKILL.md (searched "version").
- A non-shell dynamic context mechanism (searched "inject", "@", "attach", "hook", "MCP" in skills.md).
- A description of a plugin `commands/` directory in skills.md (only `.claude/commands/` is documented; plugins-reference is out of scope).
- Any statement that plugin agents can or cannot use `background` (only `hooks`, `mcpServers`, `permissionMode` are excluded).
- Plugin-driven status line (searched "status line", "statusline" in the three files; hits are commands.md L144 and the built-in `statusline-setup` agent at sub-agents.md L78, neither about plugins).
