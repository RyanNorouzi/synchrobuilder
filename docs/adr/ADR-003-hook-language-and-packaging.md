# ADR-003: Hook language, invocation form, and how the plugin is packaged

- Status: Proposed (awaiting approval at the end of Phase 0)
- Date: 2026-09-18
- Deciders: lead engineer, project owner

## Context

The brief requires every shipped hook, script and tool to be Node.js ESM
invoked as `node "<path>"`, with no bash, PowerShell or cmd anywhere, fail-open
behavior, and a 50 ms budget for hooks that run before edits and on every
prompt. The Claude Code docs (fetched 2026-09-18, see
`docs/research/hooks-core.md` and `docs/research/plugins-reference.md`)
constrain how a plugin can do that:

- A command hook runs in **exec form** when `args` is set: `command` is
  resolved as an executable on `PATH` and spawned directly, "with no shell
  involved"; `${CLAUDE_PLUGIN_ROOT}` is substituted into each `args` element as
  a plain string, so paths with spaces need no quoting. The docs' own example
  is `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/format.js"]`.
  On Windows exec form requires a real executable such as `node.exe`; `.cmd`
  shims cannot be spawned.
- Both forms export `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA` to the hook process.
- A plugin **cannot reference files outside its own directory**; component
  paths that escape the plugin root are rejected, and files above the plugin
  root are not copied into the cache on install.
- If the plugin root contains `package.json` **and** an npm or Bun lockfile,
  Claude Code runs `npm ci --ignore-scripts` (or `bun install`) in the cached
  copy with a 60 s timeout; a `package.json` with no lockfile is skipped
  silently. Yarn and pnpm lockfiles are never used.
- Plugin updates are keyed on the `version` field in `plugin.json`; without
  it, on the commit SHA.
- Default hook timeout is 600 s (30 s for `UserPromptSubmit`); a timed-out
  hook's output is discarded and, on `PreToolUse`, the tool call proceeds.

Experiments E2 to E5 in `docs/research/experiments.md` showed on macOS with
CLI 2.1.218 that exec-form Node hooks fire for all six events we need, deliver
`additionalContext` in the same turn, cost about 20 ms end to end, can spawn a
detached worker, and fail open (with a visible hook-error notice) when `node`
is not on `PATH`.

## Decision

1. **Language and runtime.** Plain JavaScript, ESM (`.mjs`), no TypeScript,
   no transpiler, no bundler, no runtime dependencies. Node 20 or newer
   (`engines.node: ">=20"`); we use only `node:fs`, `node:path`, `node:os`,
   `node:child_process`, `node:crypto`, `node:http` (health checks) and
   `node:test` for tests. What is in the repository is exactly what runs on
   the user's machine, which is the property a security-sensitive tool needs
   most.
2. **Invocation form.** Every hook is declared in exec form:

   ```json
   { "type": "command", "command": "node",
     "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs", "pre-edit"],
     "timeout": 5 }
   ```

   One entry point (`hooks/run.mjs`) dispatches on the verb, so the plugin
   ships a single hook program. `timeout` is set explicitly and small on every
   hook (5 s for the fast hooks, 15 s for `SessionEnd`) as a backstop; the
   program itself enforces a tighter internal watchdog.
3. **Fail-open contract** (every hook, every verb):
   - The whole program runs inside one `try/catch`; on any error it writes a
     one-line record to `~/.synchrobuilder/logs/hooks.log` (rotated at
     1 MB), prints nothing, and exits 0. It never exits 2.
   - A watchdog `setTimeout(..., budgetMs).unref()` ends the process with
     exit 0 and no output if work overruns; budgets: 40 ms for `PreToolUse`
     and `UserPromptSubmit`, 200 ms for `SessionStart` and `PostToolUse`,
     2 s for `Stop`/`SessionEnd`.
   - Fast verbs read only files under `~/.synchrobuilder/` (ADR-001 §6) and
     the plugin directory. They never run `git`, never open sockets, never `await` on
     the network. Anything slower is handed to the background worker
     (ADR-001) by appending a line to a local queue file.
   - Process exit uses `process.exitCode = 0` and a natural exit rather than
     `process.exit()` (experiment E6; harmless and safer).
4. **Packaging and layout.** Because a plugin cannot reach outside its own
   directory, the plugin directory is the single source tree:

   ```
   plugins/synchrobuilder/
     .claude-plugin/plugin.json      name, version (explicit semver), no build step
     package.json                    name "synchrobuilder", "bin", "files", no dependencies, no lockfile
     bin/synchrobuilder.mjs          `npx synchrobuilder ...` entry (CLI outside Claude Code and in CI)
     hooks/hooks.json                exec-form declarations only
     hooks/run.mjs                   hook dispatcher (imports ../lib/**)
     lib/                            core library: config, identity, git plumbing, cache, redaction, rules, transport
     commands/*.md                   slash commands
     skills/*/SKILL.md               auto-activating skills
     monitors/monitors.json          optional background monitor (ADR-001; may be absent in v1)
   tests/                            node:test suites (outside the plugin; not shipped)
   ```

   This replaces the brief's `packages/core`, `packages/hooks`,
   `packages/cli` and `plugins/synchrobuilder/dist/` split. There is nothing
   to bundle, so the "CI checks dist matches source" job is unnecessary. The
   npm package published for `npx synchrobuilder` is built from the same
   directory (`npm publish` from `plugins/synchrobuilder`), so the CLI and the
   plugin can never drift. `package.json` has no `dependencies` and the
   plugin ships no lockfile, so Claude Code's automatic dependency install is
   skipped (the docs say a `package.json` with no lockfile is skipped
   silently).
5. **Windows rules baked into `lib/`:** normalize `tool_input.file_path`
   backslashes before comparing; compare paths case-insensitively on Windows
   and macOS by default; never assume a POSIX `HOME` (use `os.homedir()`);
   write files atomically via temp file plus `rename`; keep every path we
   create short and ASCII; use `\n` when writing, accept `\r\n` when reading.
6. **Skills and commands must not use shell preprocessing.** The skills docs
   allow `!`-prefixed inline shell commands in skill content; we do not use
   them. Commands instruct Claude to run `node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs" <verb>`
   through its Bash or PowerShell tool for the portability commands, and
   commands with free-text arguments are routed through a dependency-free
   stdio MCP server if the owner approves that option (see PLAN.md open
   question 3), because JSON tool arguments avoid shell quoting entirely.

## Consequences

- **`node` must be on `PATH` in Claude Code's environment.** When it is not,
  every hook shows a "hook error" notice but nothing blocks (E3). The
  install docs state the requirement, `/synchrobuilder:doctor` and the
  `SessionStart` hook detect the case (SessionStart cannot detect it, since it
  would not run; the website troubleshooting page covers it), and the Relay
  project's report that Desktop-launched sessions can have a minimal `PATH`
  is listed as a risk to test on real Desktop installs. We deliberately do
  not add a shell wrapper to search for Node, because that reintroduces the
  shell the brief forbids; if the Desktop `PATH` problem is confirmed, the
  documented fix is a user-level `PATH` setting or a symlink into a standard
  location, offered by `doctor` with consent.
- Without TypeScript, correctness relies on tests and JSDoc. CI runs
  `node --test` on three OSes and `node --check` on every file. We may add
  `tsc --checkJs` as a dev-only dependency later; that is a question for the
  owner.
- Explicit `version` in `plugin.json` means users update only when we bump
  it; every release bumps it and `CHANGELOG.md`, and `claude plugin tag`
  creates the `synchrobuilder--v<version>` tag.
- Anything we would have put in `packages/core` is importable by tests via a
  relative path; the "one plugin directory" rule costs nothing in practice.

## Alternatives considered

- **POSIX `sh` wrapper that finds Node, then `exec`s the `.mjs`** (what Relay
  does). Rejected by the brief (no shell) and because it does not exist on a
  Windows machine without Git Bash.
- **TypeScript compiled by esbuild into committed `dist/` bundles.** Rejected:
  adds a build toolchain and a dev dependency, and readers of the repo would
  audit generated code. Can be revisited if the library grows past what plain
  JS keeps readable.
- **Bun as the runtime.** Rejected: Node is the documented prerequisite and
  the one every teammate already has for Claude Code's own ecosystem.
- **Shell-form hooks with quoted placeholders.** Works, but is exactly the
  quoting problem the brief exists to remove, and behaves differently under
  Git Bash and PowerShell.

## Evidence and verification

- Verified on macOS, CLI 2.1.218: exec-form hooks for SessionStart,
  UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionEnd (E2); latency
  (E4); detached worker (E5); fail open without `node` (E3).
- Not yet verified: the same on Windows (native, with and without Git Bash)
  and Linux; behavior when the plugin is installed through a marketplace
  rather than `--plugin-dir` (cache copy path, `CLAUDE_PLUGIN_ROOT` value);
  the Desktop app's `PATH`. All are Phase 1 acceptance criteria.
