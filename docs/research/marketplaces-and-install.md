# Marketplaces and install flow: research note

## Source

- https://code.claude.com/docs/en/plugin-marketplaces (raw: `plugin-marketplaces.md`, 1557 lines)
- https://code.claude.com/docs/en/discover-plugins (raw: `discover-plugins.md`, 585 lines)
- Fetched 2026-09-18 as raw Markdown downloaded from code.claude.com/docs/en/<page>.md.
- The highest version marker in either page is v2.1.275 (plugin-marketplaces.md L170; discover-plugins.md L354); neither page states which release it describes. The local CLI used for experiments is v2.1.218 (`claude --version` on 2026-09-18).

Citations are `(file L<start>-L<end>)`. Lines 1-4 of each raw file are an index preamble; content starts at line 5.

## 1. marketplace.json schema

File location: "Create `.claude-plugin/marketplace.json` in your repository root." (plugin-marketplaces.md L122). Canonical example (L126-L153):

```json
{
  "name": "company-tools",
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@example.com"
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",
      "description": "Automatic code formatting on save",
      "version": "2.1.0",
      "author": {
        "name": "DevTools Team"
      }
    },
    {
      "name": "deployment-tools",
      "source": {
        "source": "github",
        "repo": "company/deploy-plugin"
      },
      "description": "Deployment automation tools"
    }
  ]
}
```

### Required top-level fields (L157-L163)

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | "Marketplace identifier in kebab-case, with no spaces, control characters, or bidirectional-formatting characters. This is public-facing: users see it when installing plugins (for example, `/plugin install my-tool@your-marketplace`). Each user can register only one marketplace per name: when they add a second marketplace with the same name, Claude Code replaces the first." (L161) |
| `owner` | object | "Marketplace maintainer information." (L162) |
| `plugins` | array | "List of available plugins" (L163) |

Reserved marketplace names (L165-L171): `claude-code-marketplace`, `claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`, `claude-community`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`, `claude-for-financial-services`, `financial-services-plugins`, `first-party-plugins`, `claude-tag-plugins`, `healthcare`; impersonating names such as `official-claude-plugins` are also blocked (L166). Also:

> You also can't name a marketplace `npm`, `pip`, `uv`, `cargo`, `github`, or `gh`, in any casing. This check requires Claude Code v2.1.275 or later. (L170)

### Owner fields (L173-L179)

`name` (string, required), `email` (string, optional), `url` (string, optional: "Website, GitHub profile, or organization URL").

### Optional top-level fields (L181-L192)

| Field | Type | Description |
| --- | --- | --- |
| `$schema` | string | "JSON Schema URL for editor autocomplete and validation. Claude Code ignores this field at load time." (L185) |
| `description` | string | "Brief marketplace description" (L186) |
| `version` | string | "Marketplace manifest version" (L187) |
| `metadata.pluginRoot` | string | "Directory that Claude Code resolves bare plugin source names under. ... Requires Claude Code v2.1.239 or later." (L188) |
| `allowCrossMarketplaceDependenciesOn` | array | "Other marketplaces that plugins in this marketplace may depend on." (L189) |
| `renames` | object | "Map from a former plugin `name` to its current name, or to `null` if the plugin was removed. ... Requires Claude Code v2.1.193 or later." (L190) |

> `description` and `version` are also accepted under `metadata` for backward compatibility. (L192)

### Plugin entry fields

> Each plugin entry in the `plugins` array describes a plugin and where to find it. You can include any field from the plugin manifest schema, such as `description`, `version`, `author`, `commands`, and `hooks`, plus these marketplace-specific fields: `source`, `category`, `tags`, `strict`, `relevance`, `headers`, and `headersHelper`. (L196)

Required (L198-L203): `name` (string): "Plugin identifier in kebab-case, with no spaces, control characters, or bidirectional-formatting characters. This is public-facing: users see it when installing (for example, `/plugin install my-plugin@marketplace`)." (L202); `source` (string|object): "Where to fetch the plugin from" (L203).

Optional standard metadata (L209-L224): `displayName` (string; "Human-readable name shown in UI surfaces. ... May contain spaces and any casing. Not used for namespacing or lookup." L211), `description`, `version` ("If set (here or in `plugin.json`), the plugin is pinned to this string and users only receive updates when it changes." L213), `author` (object; "`name` required; `email` and `url` optional" L214), `homepage`, `repository`, `license` ("SPDX license identifier (for example, MIT, Apache-2.0)" L217), `keywords` (array), `metadata` (object; "Free-form object for your own fields ... Claude Code doesn't read it." L219), `category` (string), `tags` (array), `strict` (boolean, "default: true" L222), `relevance` (object; only for admin-allowlisted marketplaces, L223), `defaultEnabled` (boolean, "default: true" L224).

Display-field precedence: "For a field you set on the entry, users see the entry's value, even when `plugin.json` sets a different one." (L228). "Before install, Claude Code can read `plugin.json` only for entries with a relative-path source, whose plugin files live inside the marketplace itself." (L231)

Component configuration fields (L235-L242): `skills` (string|array), `commands` (string|array), `agents` (string|array), `hooks` (string|object: "Custom hooks configuration or path to hooks file"), `mcpServers` (string|object), `lspServers` (string|object).

Archive auth fields (L244-L251): `headers` (object) and `headersHelper` (string), both "Requires Claude Code v2.1.238 or later"; `headersHelper` "must also set `"strict": false`" (L251).

### Strict mode (L744-L756)

| Value | Behavior |
| --- | --- |
| `true` (default) | "`plugin.json` is the authority. The marketplace entry can supplement it with additional components, and both sources are merged." (L750) |
| `false` | "The marketplace entry is the entire definition. If the plugin also has a `plugin.json` that declares components, that's a conflict and the plugin fails to load." (L751) |

## 2. Plugin source forms

Summary table (L259-L267): Relative path (string, "Must start with `./`, unless you write a bare name under `metadata.pluginRoot`", L261); `github` (`repo`, `ref?`, `sha?`); `url` (`url`, `ref?`, `sha?`); `git-subdir` (`url`, `path`, `ref?`, `sha?`; "Clones sparsely to minimize bandwidth for monorepos"); `npm` (`package`, `version?`, `registry?`); `archive` (`url`, `sha256?`; "Works without git or npm on the user's machine. Requires Claude Code v2.1.224 or later", L266); `command` (`command`, `timeout?`, `mode?`; "Requires Claude Code v2.1.229 or later", L267).

> Claude Code copies each installed plugin into the local versioned plugin cache at `~/.claude/plugins/cache`, unless the plugin loads in place. A `command` source in link mode loads in place, and so does a relative path source in a marketplace added from a local directory. (L257)

Marketplace source vs plugin source: "Git-based marketplace sources support `ref` (branch/tag) but not `sha`." (L272); "Git-based plugin sources support both `ref` (branch/tag) and `sha` (exact commit)." (L273). "When both `ref` and `sha` are set on any of them, the `sha` is the effective pin." (L278)

### Relative path (recommended for a plugin in the marketplace repo) (L284-L303)

```json
{
  "name": "my-plugin",
  "source": "./plugins/my-plugin"
}
```

> Paths resolve relative to the marketplace root, which is the directory containing `.claude-plugin/`. The source `./plugins/my-plugin` therefore points to `<repo>/plugins/my-plugin`, even though `marketplace.json` lives at `<repo>/.claude-plugin/marketplace.json`. Don't use `../` to reference paths outside the marketplace root. On macOS and Linux, Claude Code refuses an entry path with a backslash anywhere past the leading `./`, so write the separators as `/` on every platform. (L295)

> Claude Code resolves relative paths against a local copy of the marketplace, so they work when users add your marketplace from a git source or a local directory. If users add your marketplace via a direct URL to the `marketplace.json` file, relative paths won't resolve, because Claude Code downloads only that file. (L302)

Bare names under `metadata.pluginRoot` require v2.1.239+ (L297).

Troubleshooting entry (L1527-L1539): with a marketplace added from `https://example.com/marketplace.json`, relative-path plugins "fail to install with `its marketplace entry path does not stay inside the marketplace directory`. Already-installed plugins fail to load with `Plugin source path refused`." (L1529). Cause: "adding a URL-based marketplace downloads only the `marketplace.json` file itself, and Claude Code doesn't fetch plugin files by relative path from that server." (L1531). Fixes: use any non-relative source, or host the marketplace in a git repo and add it by git URL (L1535-L1539).

### github (L305-L335)

```json
{
  "name": "github-plugin",
  "source": {
    "source": "github",
    "repo": "owner/plugin-repo",
    "ref": "v2.0.0",
    "sha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"
  }
}
```

Fields (L331-L335): `repo` required, `owner/repo`; `ref` optional "Git branch or tag (defaults to repository default branch)"; `sha` optional "Full 40-character git commit SHA".

### url (git URL) (L337-L367)

`{"source": "url", "url": "https://gitlab.com/team/plugin.git", "ref": "main", "sha": "..."}` (L351-L361). `url`: "Full git repository URL (`https://` or `git@`). The `.git` suffix is optional" (L365).

### git-subdir (L369-L406)

```json
{
  "name": "my-plugin",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/acme-corp/monorepo.git",
    "path": "tools/claude-plugin"
  }
}
```

"Claude Code uses a sparse, partial clone to fetch only the subdirectory" (L371). "The `url` field also accepts a GitHub shorthand (`owner/repo`) or SSH URLs" (L399).

### npm (L408-L457)

`{"source": "npm", "package": "@acme/claude-plugin", "version": "^2.0.0", "registry": "https://npm.example.com"}` (L441-L451). "The package's install scripts, such as `preinstall` or `postinstall`, never run, and its dependencies aren't installed during the fetch." (L412)

### archive (zip) (L459-L509)

`{"source": "archive", "url": "https://.../my-plugin-2.1.0.zip", "sha256": "<64 hex>"}` (L489-L498). Requires v2.1.224+; on v2.1.120-v2.1.223 install fails with `This plugin uses a source type your Claude Code version does not support.`; "on older versions, a marketplace containing an `archive` entry fails to load entirely" (L461). Rejects `http://` URLs "along with loopback, link-local, and cloud-metadata hosts" (L506); refuses archives larger than 256 MiB (L485). "The `sha256` digest also serves as the plugin's version when neither `plugin.json` nor the marketplace entry declares one." (L509)

### command (L604-L667)

`{"source": "command", "command": "my-tool claude-plugin-path", "timeout": 60, "mode": "copy"}` (L610-L618, L630-L634). "Claude Code runs the command through the platform shell, `sh` on macOS and Linux or `cmd.exe` on Windows, from the user's home directory." (L620). "Claude Code doesn't support link mode on Windows" (L644). Users must accept the exact command on install (L646-L655).

## 3. Exact user commands

### Add a marketplace

In-session (discover-plugins.md):

```shell
/plugin marketplace add anthropics/claude-code
```
(GitHub `owner/repo`, L228-L230; "Add a GitHub repository that contains a `.claude-plugin/marketplace.json` file using the `owner/repo` format" L224)

```shell
/plugin marketplace add https://gitlab.com/company/plugins.git
/plugin marketplace add git@gitlab.com:company/plugins.git
/plugin marketplace add https://gitlab.com/company/plugins.git#v1.0.0
```
(L246-L262; "To add a specific branch or tag, append `#` followed by the ref" L258)

```shell
/plugin marketplace add ./my-marketplace
/plugin marketplace add ./path/to/marketplace.json
```
(L268-L276)

> **Shortcuts**: You can use `/plugin market` instead of `/plugin marketplace`, and `rm` instead of `remove`. (L213)

Suffix rules for https URLs (L236-L238): github.com and gitlab.com work with or without `.git` (gitlab without suffix needs v2.1.232+); "Every other host ... include the `.git` suffix". "Include the `https://` prefix. Claude Code v2.1.196 and later reject a host typed without it" (L242).

Terminal CLI (plugin-marketplaces.md L1242-L1312):

```bash
claude plugin marketplace add <source> [options]
```

> `<source>`: GitHub `owner/repo` shorthand, git URL, remote URL to a `marketplace.json` file, or local directory path. To pin to a branch or tag, append `@ref` to the GitHub shorthand or `#ref` to a git URL (L1252)

Options (L1258-L1262): `--scope <scope>` ("`user`, `project`, or `local`", default `user`); `--sparse <paths...>` ("Limit checkout to specific directories via git sparse-checkout. Useful for monorepos"); `--claudeai` (v2.1.273+).

```bash
claude plugin marketplace add acme-corp/claude-plugins
claude plugin marketplace add acme-corp/claude-plugins@v2.0
claude plugin marketplace add https://gitlab.example.com/team/plugins.git
claude plugin marketplace add https://example.com/marketplace.json
claude plugin marketplace add ./my-marketplace
claude plugin marketplace add acme-corp/claude-plugins --scope project
claude plugin marketplace add acme-corp/monorepo --sparse .claude-plugin plugins
```
(L1266-L1304). "Declare the marketplace at project scope so it is shared with your team via `.claude/settings.json`" (L1294).

### Install a plugin

```shell
/plugin install plugin-name@marketplace-name
```
(discover-plugins.md L312-L314)

> The command opens that plugin's details, where you choose an installation scope. ... (L316)
> * **User scope**: install for yourself across all projects
> * **Project scope**: install for all collaborators on this repository, which adds the plugin to `.claude/settings.json`
> * **Local scope**: install for yourself in this repository only, not shared with collaborators (L318-L320)

> To install without an interactive step, use the `claude plugin install` shell command, which installs to user scope unless you pass `--scope`. (L322)

```shell
claude plugin install formatter@your-org --scope project
claude plugin uninstall formatter@your-org --scope project
```
(L432-L435)

The `marketplace-name` is the `name` in marketplace.json: "`<name>`: marketplace name to remove, as shown by `claude plugin marketplace list`. This is the `name` from `marketplace.json`, not the source you passed to `add`" (plugin-marketplaces.md L1344). User-scope settings file: neither page names the file that a user-scope install or marketplace declaration writes to; only project (`.claude/settings.json`, discover-plugins.md L319) and local (`.claude/settings.local.json`, L376) are named. For a plugin with a `command` source, `claude plugin install` needs `--yes` to accept the command non-interactively (L322). Local-scope settings file: uninstalling a project-enabled plugin "for you alone ... writes an override to your `.claude/settings.local.json`" (discover-plugins.md L376). Managed scope exists and "can't be modified" (L324).

Refresh-before-install: "when you install `plugin-name@marketplace-name`, in a session or with `claude plugin install`, Claude Code refreshes that marketplace before the lookup. ... Before v2.1.232, Claude Code didn't refresh the marketplace before the lookup." (L328); skipped if refreshed "within the last 30 seconds" (L331). "`claude plugin install plugin-name`" (bare) "reads the cached catalogs without refreshing" (L334).

Activation: `Plugin is now active.` or `Run /reload-plugins to activate.`, in which case "Claude Code then runs `/reload-plugins` for you" (L340-L341); "Before v2.1.221, no install took effect in the current session until you ran `/reload-plugins` or restarted." (L344). "The `claude plugin install` shell command doesn't run in a session, so Claude Code loads the plugins it installs the next time you start Claude Code, or when you run `/reload-plugins`" (L346).

One-command form: `/plugin install quality-review-plugin --marketplace your-org/plugins` "Requires Claude Code v2.1.275 or later." (L354-L358); Claude Code "asks you to confirm before adding it" (L362).

### Update, uninstall, list, enable/disable

```shell
/plugin marketplace list
/plugin marketplace update marketplace-name
/plugin marketplace remove marketplace-name
```
(discover-plugins.md L479-L493). "Removing a marketplace will uninstall any plugins you installed from it." (L496)

```bash
claude plugin marketplace list [options]        # --json
claude plugin marketplace remove <name> [options]  # --scope user|project|local; alias rm; omit --scope to remove from every editable scope (L1350)
claude plugin marketplace update [name]         # all marketplaces if omitted
```
(plugin-marketplaces.md L1318-L1362). "A marketplace added with a branch or tag `ref` updates to the latest commit of that ref, not the repository's default branch." (L1358). "Removing a marketplace from its last remaining scope also uninstalls any plugins you installed from it." (L1353)

```shell
/plugin list                                   # --enabled | --disabled
/plugin disable plugin-name@marketplace-name
/plugin enable plugin-name@marketplace-name
/plugin uninstall plugin-name@marketplace-name
```
(discover-plugins.md L402-L428). "When you run `/plugin disable`, `/plugin enable`, or `/plugin uninstall`, Claude Code opens the plugin panel to make the change and leaves it open. Press **Esc** to close the panel" (L397); "For scripting, use the `claude plugin` shell commands instead" (L398). `claude plugin details` lists a plugin's components (L378). Plugin updates: `/plugin update` and `claude plugin update <plugin>@<marketplace>` are referenced (plugin-marketplaces.md L1081, L653, L786) but neither page documents their full syntax; see Not found.

## 4. Require marketplaces for a team

> You can configure your repository so Claude Code adds your marketplace for team members once they trust the project folder, with no separate prompt. Add your marketplace to `.claude/settings.json`: (plugin-marketplaces.md L870)

```json
{
  "extraKnownMarketplaces": {
    "company-tools": {
      "source": {
        "source": "github",
        "repo": "your-org/claude-plugins"
      }
    }
  }
}
```
(L872-L883)

```json
{
  "enabledPlugins": {
    "code-formatter@company-tools": true,
    "deployment-tools@company-tools": true
  }
}
```
(L887-L894)

> Marketplace state is stored once per user in `~/.claude/plugins/known_marketplaces.json`, not per project. (L899)

Teammate flow (discover-plugins.md L531-L533):

> Once a team member trusts the repository folder, Claude Code adds these marketplaces without a further prompt. (L531)
> As of Claude Code v2.1.195, adding the marketplace doesn't install plugins that come from an external source, on any path that loads plugins. A plugin that only the project's `.claude/settings.json` enables, and that comes from an external source such as a GitHub repository or npm package, doesn't load until the team member installs it. Until then, Claude Code reports the plugin as not installed and shows the `claude plugin install` command to run. (L533)

The specific dialog text is not described in either page; the only gate named is the workspace trust dialog (linked to permissions docs). The `extraKnownMarketplaces` map is replaced, not merged, by a gateway group policy (plugin-marketplaces.md L1094). A `headersHelper` declared in a project's `.claude/settings.json` or `.claude/settings.local.json` runs "Only after the user accepts the workspace trust dialog for that folder itself. A `-p` or SDK session doesn't count as accepting it, and neither does trust granted to a parent folder" (L597). For cloud sessions without `/plugin`, the docs say to "declare the plugin under `enabledPlugins` in `.claude/settings.json`" (discover-plugins.md L41). Admins may set `"autoUpdate": true` per `extraKnownMarketplaces` entry in managed settings (discover-plugins.md L518).

## 5. Version resolution and release channels

> Plugin versions determine cache paths and update detection: if the resolved version matches what a user already has, `/plugin update` and auto-update skip the plugin. For git-based sources, if you omit `version`, Claude Code uses the source's resolved commit SHA, so users get an update whenever that commit changes; this is the simplest setup for internal or actively developed plugins. (plugin-marketplaces.md L1081)

> Setting `version` pins the plugin for every source type except `command` ... A plugin loaded in place from a marketplace added as a local directory isn't pinned either. If you declare `"version": "1.0.0"` in `plugin.json` and push new commits without changing that string, existing users of those sources keep the cached copy ... Bump the field on every release, or omit it to fall back to the resolved version. (L1084)

> Avoid setting `version` in both `plugin.json` and the marketplace entry. Claude Code always uses the `plugin.json` value without warning (L1086)

Other version signals: an `archive` entry's `sha256` digest is the version when neither `plugin.json` nor the entry sets one (L509); a `command` source's version is a hash of the printed directory's contents in copy mode (L638) or of its real path and top-level entries in link mode (L642); the community marketplace pins each plugin "to a specific commit SHA in the catalog" (discover-plugins.md L124). Release channels: two marketplaces pointing to different `ref`s of the same repo (L1089-L1134, example `"ref": "stable"` vs `"ref": "latest"` L1102-L1134); "Each channel must resolve to a different version." (L1099). Dependency version pinning uses a `{plugin-name}--v{version}` git-tag convention (L1170). Auto-update timing: "with a random delay of up to ten minutes" after session start (discover-plugins.md L503); "Other third-party marketplaces and local development marketplaces have auto-update disabled by default." (L516). `DISABLE_AUTOUPDATER` disables both; `FORCE_AUTOUPDATE_PLUGINS=1` re-enables plugin updates (L520-L527).

## 6. Private repos, auth, offline, timeouts, Windows, sparse checkout

Clone behavior: "Claude Code clones that marketplace or plugin repository onto their machine. The clone never downloads Git LFS content" (plugin-marketplaces.md L760).

> When you run `/plugin marketplace add`, `/plugin install`, `/plugin update`, or `/plugin marketplace update`, Claude Code uses your existing git credential helpers ... SSH access works as long as the host is already in your `known_hosts` file and the key is loaded in `ssh-agent` ... GitHub `owner/repo` shorthand sources clone over SSH by default; set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` to clone them over HTTPS instead. (L786)

Background auto-updates: "the background refresh disables git credential helpers when it checks the marketplace's remote for new commits" (L790); mitigations `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` and `gh auth setup-git` (L796-L797); a global git URL rewrite with a token (L804-L818); CI: "export a token ... as `GH_TOKEN`, then run `gh auth setup-git`" (L820). Diagnostics: `gh auth status`, `git config --global credential.helper`, `git ls-remote <marketplace-url>` (L1485-L1487).

Offline (L1499-L1513): the background refresh "repeatedly attempts a re-clone that can't succeed" (L1501); "Before v2.1.274, the refresh ran `git pull` in the existing checkout" (L1503); fix `export CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` (L1510) or `CLAUDE_CODE_PLUGIN_SEED_DIR` (L1513). Install while offline: "Claude Code looks the plugin up in the cached catalog anyway" and reports `marketplace not refreshed` (discover-plugins.md L336).

Timeouts: "Claude Code uses a 120-second timeout for all git operations" (L1519); `export CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000` (L1524).

Windows mentions: `headersHelper` runs "through `sh`, or `cmd.exe` on Windows" (L554); `command` sources run via "`cmd.exe` on Windows, from the user's home directory" (L620), refuse UNC paths (L626), and link mode is unsupported (L644); seed dirs separate with `;` on Windows (L906); backslashes are refused in relative source paths on macOS/Linux (L295). No Windows statement about hooks, `/plugin`, or git prerequisites in these pages.

Sparse checkout: marketplace-level `--sparse <paths...>` (L1261; example L1302-L1304); plugin-level `git-subdir` sparse partial clone (L371).

Seed dir for containers/CI (L902-L937): `CLAUDE_CODE_PLUGIN_SEED_DIR` mirrors `~/.claude/plugins` with `known_marketplaces.json`, `marketplaces/<name>/`, `cache/<marketplace>/<plugin>/<version>/` (L910-L915); build with `CLAUDE_CODE_PLUGIN_CACHE_DIR=/opt/claude-seed claude plugin marketplace add your-org/plugins` (L921-L924).

## 7. Rename or remove a plugin

> A plugin's `name` is its stable identifier. Users reference it in `enabledPlugins`, `pluginConfigs`, and `/plugin install` commands, so changing it breaks every existing install. To change the label shown in the UI without breaking installs, set `displayName` and keep `name` unchanged. (L1174)

> If you must change a plugin's `name`, or you remove a plugin from the `plugins` array, add a top-level `renames` entry ... Automatic migration requires Claude Code v2.1.193 or later. (L1176)

```json
{
  "name": "acme-tools",
  "owner": { "name": "Acme" },
  "plugins": [
    { "name": "code-formatter", "source": "./plugins/code-formatter" }
  ],
  "renames": {
    "formatter": "code-formatter",
    "legacy-linter": null
  }
}
```
(L1178-L1190)

Behavior: notice `Renamed to "code-formatter" in the "acme-tools" marketplace`, then keys rewritten in user, project, and local scopes (L1194); `null` drops the key (L1195); remote-source renames need one `/plugin install` (L1196). "Treat `renames` as append-only history" (L1198); `claude plugin validate .` rejects cycles (L1200); "Earlier versions of Claude Code ignore the `renames` field and report `plugin-not-found`" (L1206).

## 8. Validation and testing

```bash
claude plugin validate .
```
```shell
/plugin validate .
/plugin marketplace add ./path/to/marketplace
/plugin install test-plugin@marketplace-name
```
(L1214-L1234). "Validation checks file structure; to test whether a plugin changes what Claude does on realistic prompts, run its eval suite with `claude plugin eval`" (L1210).

Validator scope: "checks `marketplace.json` for schema errors, duplicate plugin names, and source path traversal. For each entry whose `source` is a local path, it also validates that plugin's own `plugin.json` and warns when the entry's `version` doesn't match" (L1385); v2.1.196+ also includes `source: "."` entries (L1387-L1391). "From a marketplace directory, Claude Code doesn't open the plugins' skill, agent, command, or hook files." (L1395) Per-directory runs: `claude plugin validate ./plugins/my-plugin` checks "`plugin.json`, `hooks/hooks.json`, and the `skills`, `agents`, and `commands` directories" (L1424); most non-manifest runs require v2.1.233+ (L1416). Warnings include `Plugin name "x" is not kebab-case` (L1410) and Claude Desktop name rules: "up to 128 characters made of letters, digits, `.`, `_`, and `-`, starting with a letter or digit" (L1412). A clean run ends with `Validation passed` (L1454); `hooks/hooks.json` JSON errors are reported only in a plugin run (L1461).

Local testing: the walkthrough uses a local-directory marketplace (`/plugin marketplace add ./my-marketplace` then `/plugin install quality-review-plugin@my-plugins`, L97-L100), which loads relative-path plugins in place (L257). `--plugin-dir` is mentioned only in discover-plugins.md (L384, L444, L447) as a way to load a plugin under development; its syntax is documented on the plugins page, not here. `--strict`: Not found in either file (searched `--strict`).

## 9. discover-plugins.md: menu, claude.ai, enablement, two-command shape

Two-step model: "Add the marketplace ... This registers the catalog with Claude Code so you can browse what's available. No plugins are installed yet." then "Install individual plugins" (L17-L27).

`/plugin` tabs (L154-L160): **Discover**, **Installed**, **Marketplaces**, **Errors**, **Stats** ("in sessions where `/skill-doctor` is available"); cycle with **Tab** / **Shift+Tab**. Details pane shows **Context cost**, **Last updated**, **Will install** (L166-L170); "For plugins from local or custom marketplaces, you may not see the **Context cost** and **Last updated** rows, and the **Will install** section may show **Components will be discovered at installation** instead." (L172). "`/plugin` opens an interactive panel in the terminal CLI." (L41)

claude.ai marketplaces: `claude plugin marketplace add --claudeai claudeai-organization-library` (L296-L298); requires v2.1.273+ (L292); registered under a `claudeai-` prefixed local name (L300); refuses `--scope`/`--sparse` and "can't share it through a project's `.claude/settings.json`" (plugin-marketplaces.md L1312).

Seeing what is enabled: **Installed** tab "grouped by scope and sorted so you see problems first" (L366); `f` favorites, type to filter, Enter opens detail (L370-L372); `/plugin list --enabled|--disabled` (L402-L406); **Not used recently** header after two weeks/10 sessions (L380).

Enable/disable per scope: `/plugin disable|enable plugin-name@marketplace-name` (L410-L418); "`plugin-name` is the plugin's `name` in the marketplace entry, which can differ from the `name` in the plugin's own `plugin.json`" (L420); v2.1.195+ accepts either name (L422). Scope on uninstall of a project-enabled plugin: local override in `.claude/settings.local.json` or removal from shared `.claude/settings.json` (L376). Changes apply on menu close via automatic `/reload-plugins`; `--force` if prompt cache would be invalidated (L439); `/reload-plugins` works in `-p`/SDK sessions on v2.1.260+ (L451).

Expected two-command install shape (walkthrough, L143-L149 and L180-L186):

```shell
/plugin marketplace add anthropics/claude-code
/plugin install commit-commands@claude-code-plugins
```

Namespacing: "Plugin skills are namespaced by the plugin name, so **commit-commands** provides skills like `/commit-commands:commit`." (L194; same at plugin-marketplaces.md L104-L108).

Prerequisites stated: `/plugin` requires a version that has it; upgrade via `brew upgrade claude-code` or `npm install -g @anthropic-ai/claude-code@latest` (L560-L566). Git-based marketplaces are cloned (plugin-marketplaces.md L760) and only `archive` "Works without git or npm on the user's machine" (L266); an explicit "git must be installed" sentence: Not found. Security: "Plugins and marketplaces are highly trusted components that can execute arbitrary code on your machine with your user privileges." (L554)

## Implications for Synchrobuilder

- Repo layout in the brief (`.claude-plugin/marketplace.json` at root, plugin under `plugins/synchrobuilder/`, source `"./plugins/synchrobuilder"`) matches the documented recommended layout (L122, L286-L295, L762-L768). Use `/` separators only (L295).
- Install page commands must be `/plugin marketplace add <owner>/<repo>` then `/plugin install synchrobuilder@<marketplace-name>`, where `<marketplace-name>` is the `name` field in marketplace.json, not the repo name (L161, L1344). Choose a marketplace `name` that is kebab-case, not reserved, and not `github`/`gh`/`npm` (L166-L170). Avoid the `--marketplace` one-liner on the install page: v2.1.275+ only (discover-plugins.md L354), above the local v2.1.218.
- `owner/repo` shorthand clones over SSH by default (L786); document `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` or the full `https://github.com/<owner>/<repo>.git` form for users without SSH keys.
- Versioning: either bump `plugin.json` `version` on every release or omit it so the commit SHA drives updates (L1081-L1086). Don't set `version` in both places (L1086). `/synchrobuilder:doctor` can remind users that third-party marketplaces have auto-update off by default (discover-plugins.md L516).
- `/synchrobuilder:setup` writing `extraKnownMarketplaces` + `enabledPlugins` to `.claude/settings.json` gives teammates the marketplace on folder trust, but they still must run the shown `claude plugin install` for external sources (discover-plugins.md L531-L533). Whether a relative-path plugin inside the same marketplace repo auto-installs is not stated (open question).
- Entry-level `hooks`, `mcpServers`, `commands`, `skills` fields exist (L235-L242) but the default `strict: true` keeps `plugin.json` authoritative (L750); keep everything in `plugin.json` and leave the marketplace entry to metadata (`description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`).
- Command namespace = plugin `name` (discover-plugins.md L194). `displayName` cannot shorten it (L211). Renaming `name` later requires the `renames` map (v2.1.193+, L1176) and breaks `enabledPlugins` keys on older clients (L1206).
- `claude plugin validate .` at the marketplace root plus `claude plugin validate ./plugins/synchrobuilder` (which reads `hooks/hooks.json`) belong in `/synchrobuilder:ci` and the release checklist (L1385, L1424, L1461).
- Of the marketplace mechanisms these two pages describe, only `headersHelper` and `command` sources run a shell (`sh`, or `cmd.exe` on Windows: L554, L620); a relative-path source is cloned/copied, with no shell step described (L257, L760). Avoid both.
- Offline teammates keep the cached plugin; document `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` (L1507-L1510) and the 120 s git timeout (L1519).

## Conflicts with the brief

| Brief says | Docs say | Source |
| --- | --- | --- |
| Install is `/plugin install synchrobuilder@<marketplace>` where `<marketplace>` might be read as the repo | `<marketplace>` is the `name` field inside marketplace.json ("This is the `name` from `marketplace.json`, not the source you passed to `add`") | plugin-marketplaces.md L161, L1344 |
| Asks whether a plugin can expose a shorter prefix or aliases such as `/sb:audit` | Skills are "namespaced by the plugin name"; `displayName` is "Not used for namespacing or lookup". No alias mechanism appears in either page. Shortening requires naming the plugin `sb`, which changes the install id to `sb@<marketplace>` | discover-plugins.md L194; plugin-marketplaces.md L211, L1174 |
| Consent before changing a machine | With `extraKnownMarketplaces` in `.claude/settings.json`, "Claude Code adds these marketplaces without a further prompt" once the folder is trusted | discover-plugins.md L531; plugin-marketplaces.md L870 |
| Background sync assumes teammates receive plugin updates | Third-party marketplaces have auto-update disabled by default (L516). Without it, updates arrive through `/plugin update` or `claude plugin update`, `/plugin marketplace update`, the refresh that a named `plugin@marketplace` install triggers (L328), a user's **Enable auto-update** toggle (L509-L514), or an admin's `"autoUpdate": true` in managed settings (L518) | discover-plugins.md L516, L503, L328, L518 |
| Status line driven by the plugin | Not mentioned in either page (searched `status line`, `statusline`) | none |

## Open questions

1. Does the skill namespace come from the marketplace-entry `name` or the `plugin.json` `name` when they differ? The pages say the two can differ (discover-plugins.md L420) but not which one prefixes commands.
2. When `extraKnownMarketplaces` + `enabledPlugins` name a plugin whose source is a relative path inside the same git marketplace repo, does trusting the folder install it, or is it treated as "external" and left for `claude plugin install` (discover-plugins.md L533)?
3. On the local v2.1.218 CLI, does `/plugin install synchrobuilder@<marketplace>` refresh the marketplace first (v2.1.232+ behavior, discover-plugins.md L328) or require a manual `/plugin marketplace update`?
4. Exact syntax and scope flags of `/plugin update` and `claude plugin update` (referenced at plugin-marketplaces.md L653, L786, L1081) need confirmation from the plugins-reference page or `claude plugin update --help`.
5. Does `claude plugin validate` accept a `--strict` flag on v2.1.218? Not documented here.
6. What the trust dialog looks like on a fresh clone with `extraKnownMarketplaces` present, and whether a Windows machine without SSH keys can add an `owner/repo` marketplace without `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` (plugin-marketplaces.md L786).
7. Whether the `/plugin` details pane shows **Will install** for a relative-path plugin in a GitHub-hosted marketplace, or falls back to **Components will be discovered at installation** (discover-plugins.md L172).
