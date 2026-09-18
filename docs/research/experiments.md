# Experiments run on a real machine (Phase 0)

These are things we verified by running them, not by reading docs. Every claim
below has the command that produced it. Paths under the session scratch
directory are written as `<scratch>`.

| Item | Value |
| :-- | :-- |
| Date | 2026-09-18 |
| Machine | macOS (Darwin 24.6.0), Apple Silicon (arm64) |
| Node | v24.16.0 at `/usr/local/bin/node` |
| git | 2.39.5 (Apple Git-154) |
| Claude Code (local CLI) | 2.1.218 (`~/.local/share/claude/versions/2.1.218`, Mach-O arm64) |
| Claude Code (latest on npm) | 2.1.276 (`npm view @anthropic-ai/claude-code version`) |
| Docs snapshot | raw Markdown from `https://code.claude.com/docs/en/<page>.md`, fetched 2026-09-18T07:13Z |

Not verified here, because it needs a machine we do not have: anything on
Windows or Linux, anything interactive-only (permission prompts, status line
rendering, plugin monitors, the `/plugin` menu). See PLAN.md for the list.

## E1. Plugin and marketplace manifests pass the real validator

Command (run from a throwaway directory containing
`plugins/synchrobuilder/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` with a relative-path plugin source):

```
claude plugin validate plugins/synchrobuilder
claude plugin validate --strict plugins/synchrobuilder
claude plugin validate .
claude plugin validate --strict .
```

Output:

```
Validating plugin manifest: <scratch>/validate-test/plugins/synchrobuilder/.claude-plugin/plugin.json
✔ Validation passed                      (exit 0, also with --strict)

Validating marketplace manifest: <scratch>/validate-test/.claude-plugin/marketplace.json
⚠ Found 1 warning:
  ❯ description: No marketplace description provided. Adding a description helps users understand what this marketplace offers
✔ Validation passed with warnings        (exit 0)
✘ Validation failed (--strict treats warnings as errors)   (exit 1 with --strict)
```

A manifest with `"name": "Synchro Builder"` and an unknown field `bogus` gives:

```
✘ Found 1 error:
  ❯ name: Plugin name cannot contain spaces. Use kebab-case (e.g., "my-plugin")
⚠ Found 1 warning:
  ❯ bogus: Unknown field 'bogus'. Claude Code ignores it at load time.
✘ Validation failed                      (exit 1)
```

Conclusions: the manifests in the proposed layout validate; `--strict` is
usable as a CI gate once the marketplace has a `description`; the validator
checks the manifest only, not `hooks/hooks.json` or command files.

## E2. Exec-form Node hooks work end to end in a real headless session

Experiment plugin: `.claude-plugin/plugin.json` (`name: sbtest`),
`hooks/hooks.json` registering `SessionStart`, `UserPromptSubmit`,
`PreToolUse` (`Write|Edit`), `PostToolUse` (`Write|Edit`), `Stop` and
`SessionEnd`, every handler in exec form:

```json
{ "type": "command", "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs", "session-start"], "timeout": 5 }
```

`dist/hook.mjs` (plain ESM, no dependencies) appends its stdin JSON and a few
environment variables to a log file, then prints JSON `additionalContext`
containing a marker such as `SYNCHRO-TOKEN-PREEDIT`.

Command:

```
cd <scratch>/hooktest/project
claude -p "Create a file named hello.txt in the current directory containing the single word hi. Then list every SYNCHRO-TOKEN value you can see anywhere in your context, one per line, and nothing else." \
  --plugin-dir <scratch>/hooktest/plugin --output-format stream-json --verbose --include-hook-events \
  --permission-mode acceptEdits --allowedTools "Write" --model haiku --no-session-persistence --max-budget-usd 0.50
```

Result event (`type: result`, `is_error: false`, `num_turns: 2`, cost 0.078 USD):

```
SESSIONSTART
PROMPT
PREEDIT
POSTEDIT
```

`hello.txt` was created with content `hi`. The hook log shows all six hooks
ran, in this order, each receiving the documented input keys:

| Hook verb | `hook_event_name` | Input keys received |
| :-- | :-- | :-- |
| session-start | SessionStart | session_id, transcript_path, cwd, hook_event_name, source |
| prompt | UserPromptSubmit | session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, prompt |
| pre-edit | PreToolUse | session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, tool_name, tool_input, tool_use_id |
| post-edit | PostToolUse | session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, tool_name, tool_input, tool_response, tool_use_id, duration_ms |
| stop | Stop | session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, stop_hook_active, last_assistant_message, background_tasks, session_crons |
| session-end | SessionEnd | session_id, transcript_path, cwd, prompt_id, hook_event_name, reason |

Environment seen by every hook process: `CLAUDE_PLUGIN_ROOT` (the
`--plugin-dir` path), `CLAUDE_PROJECT_DIR` (the cwd), `CLAUDE_PLUGIN_DATA`
(`~/.claude/plugins/data/sbtest-inline`), and on SessionStart only
`CLAUDE_ENV_FILE`. `NODE_USE_SYSTEM_CA` was not set. `CLAUDE_CODE_ENTRYPOINT`
was `claude-vscode`, inherited from the parent environment, so it is not a
reliable way to detect an interactive session.

The redacted hook inputs are saved in
`evidence/hook-inputs-claude-2.1.218-macos.jsonl` for use as test fixtures.

In the stream, hooks appear as `{"type":"system","subtype":"hook_started"}`
and `{"type":"system","subtype":"hook_response", "outcome": "...",
"exit_code": N, "stdout": "...", "stderr": "..."}` events.

Conclusions: exec form `node` + `args` with `${CLAUDE_PLUGIN_ROOT}` works with
no shell on macOS on CLI 2.1.218; `additionalContext` from SessionStart,
UserPromptSubmit, PreToolUse and PostToolUse all reached Claude in the same
turn; a `PreToolUse` `permissionDecision: "allow"` let the `Write` proceed.

## E3. Fail open when `node` is not on PATH

Same command as E2, but run with `env -i HOME=... PATH=/usr/bin:/bin` so that
no `node` is reachable (the `claude` binary itself does not need Node).

Result: exit 0, `is_error: false`, the file was still created, and Claude
answered `NONE` (no hook context reached it). Each hook produced a
`hook_response` with `outcome: "error"`:

```
"stderr":"Error occurred while executing hook command: Executable not found in $PATH: \"node\"","exit_code":1,"outcome":"error"
```

and at session end the CLI printed to stderr:

```
SessionEnd hook [node ${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs session-end] failed: Error occurred while executing hook command: Executable not found in $PATH: "node"
```

Conclusions: a missing Node never blocks the developer (fail open holds), but
the user sees a hook error notice on every event. Synchrobuilder must detect
this at install time (`/synchrobuilder:doctor`) and document it; it cannot fix
it from inside an exec-form hook because the executable is resolved before our
code runs.

## E4. Hook latency budget

`time.mjs` spawns the E2 hook 30 times with a UserPromptSubmit-shaped stdin
and measures spawn-to-exit wall time with `process.hrtime`:

```
exec-form node hook end-to-end (spawn->exit), 30 runs: min 18.8 ms, p50 20.3 ms, p90 24.6 ms, max 28.8 ms
```

Bare `node -e ''` measured with `/usr/bin/time -p`: `real 0.01` on five runs.

Conclusions: a Node hook that reads stdin and one small cache file costs about
20 ms on this laptop, leaving roughly 30 ms of the 50 ms budget for real work.
Every import we add to the hook entry point eats into that; the hook bundle
must stay small and lazy.

## E5. A hook can spawn a detached background worker

`hook.mjs bg` calls
`spawn(process.execPath, [...], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`
and exits. Measured:

```
parent exited after 39 ms; bg-done.txt present immediately? no
after 2.5 s: child finished at 2026-09-18T07:24:07.808Z
```

Conclusions: on macOS the child outlives the hook process, so a sync worker can
be launched from a hook without a shell. The Windows and Linux behavior of the
same call is documented by Node but not yet tested by us.

## E6. The reported `NODE_USE_SYSTEM_CA` crash does not reproduce on Node 24.16

The Relay project reports (their `packages/plugin/scripts/hook.sh`) that on
Node 24.7 (macOS) `process.exit()` races a keychain-reading thread started by
`NODE_USE_SYSTEM_CA=1` into a SIGSEGV in about 20 % of hook runs. We ran three
variants 60 times each with `NODE_USE_SYSTEM_CA=1` on Node 24.16.0:

```
NODE_USE_SYSTEM_CA=1 + process.exit():                        0 non-zero exits out of 60
NODE_USE_SYSTEM_CA=1 + read stdin + write + exit:            0 non-zero exits out of 60
NODE_USE_SYSTEM_CA=1 + natural exit (exitCode):              0 non-zero exits out of 60
```

Also, in E2 the hook environment did not contain `NODE_USE_SYSTEM_CA` at all
on CLI 2.1.218.

Conclusions: not reproducible here; keep it on the risk list, prefer
`process.exitCode` plus a natural exit in hooks anyway (it is the safer idiom),
and re-test on Node 24.7 if a CI runner has it.

## E7. Command menu matching (docs, not an experiment)

The docs state that since v2.1.236 typing letters that match "a word within"
a command name, ignoring `:`, `_` and `-`, highlights that command (see
`skills-commands-agents.md`). This means `/audit` can highlight
`/synchrobuilder:audit`. We could not verify this interactively in this
session; it is listed for manual verification.

## E8. Git plumbing for per-developer state refs on a local bare remote

Setup: `git init --bare remote.git`, clones `alice` and `bob`, an initial
`main` commit pushed by alice. Then, in `alice`, a commit built with no
worktree checkout:

```
BLOB=$(printf '{"handle":"alice",...}\n' | git hash-object -w --stdin)
TREE=$(printf '100644 blob %s\tpresence.json\n' "$BLOB" | git mktree)
SUB=$(printf '040000 tree %s\talice\n' "$TREE" | git mktree)
ROOT=$(printf '040000 tree %s\tstate\n' "$SUB" | git mktree)
COMMIT=$(GIT_AUTHOR_NAME=alice GIT_AUTHOR_EMAIL=alice@example.com \
  GIT_COMMITTER_NAME=alice GIT_COMMITTER_EMAIL=alice@example.com \
  git commit-tree "$ROOT" -m "sb: alice presence")
git update-ref refs/synchrobuilder/local/alice "$COMMIT"
git push origin refs/synchrobuilder/local/alice:refs/synchrobuilder/alice
git push --force origin refs/synchrobuilder/local/alice:refs/synchrobuilder/alice   # second snapshot
```

Output (abridged):

```
worktree status after plumbing (should be clean):
## main...origin/main
branches (should be only main):
* main
  remotes/origin/main
 * [new reference]   refs/synchrobuilder/local/alice -> refs/synchrobuilder/alice
 + e5616f8...ee6b02d refs/synchrobuilder/local/alice -> refs/synchrobuilder/alice (forced update)
```

In `bob`: `git fetch origin '+refs/synchrobuilder/*:refs/synchrobuilder-remote/*'`
then `git ls-tree -r --name-only refs/synchrobuilder-remote/alice` and
`git cat-file -p refs/synchrobuilder-remote/alice:state/alice/presence.json`:

```
ee6b02d10deee668345ed62a570f254ee1262e84 commit	refs/synchrobuilder-remote/alice
state/alice/presence.json
{"handle":"alice","ts":"2026-09-18T07:31:00Z"}
bob status:
## main...origin/main
* main
  remotes/origin/main
```

`git ls-remote origin` on the remote showed `HEAD`, `refs/heads/main` and
`refs/synchrobuilder/alice`. A `--depth 1` clone (`carol`) fetched the same
namespace successfully ("shallow ok"). A fetch from an unreachable URL
printed `fatal: unable to access ... Couldn't connect to server` and left
no refs behind.

Conclusions: a developer can publish state without touching their worktree
or branches; a custom ref namespace round-trips through a plain git remote,
force-push works for the single writer, and readers (including shallow
clones) fetch it into a private local namespace. Hosted providers are not
covered by this experiment (GitHub's reference API docs accept any
`refs/...` name with two slashes; GitLab, Bitbucket and Azure DevOps are
unverified). The design panel's own experiments (compare-and-swap races,
poisoned trees, `push --mirror`, `Cannot fetch both`) are recorded in
`evidence/transport-design-panel.json`.
