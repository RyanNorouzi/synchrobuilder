# What is verified, and what is not

This file is the honest ledger behind every claim in the README, the website and the
command reference. A row says "verified" only when a command in this repository was run
and its output recorded. Everything else is listed as unverified, with the reason.

Machine used for every run below unless stated otherwise:

| | |
| :-- | :-- |
| Date | 2026-09-18 |
| Operating system | macOS 15 (Darwin 24.6.0), Apple Silicon |
| Node | v24.16.0 |
| git | 2.39.5 |
| Claude Code | 2.1.218 (local CLI); the documentation read in Phase 0 describes up to 2.1.276 |

Reproduce the automated part with:

```
node scripts/lint.mjs
node scripts/test.mjs
node plugins/synchrobuilder/bin/synchrobuilder.mjs audit --strict
```

## Verified by the test suite on three operating systems

265 tests, 264 passing and 1 skipped, from `node scripts/test.mjs` on 2026-10-15. The CI
matrix runs them on ubuntu, macos and
windows, on Node 20 and Node 24, plus a Windows job that checks the repository out with
CRLF line endings. Every job passed on 2026-09-18, and again on 2026-10-15 with the worker and lock tests added
(`https://github.com/RyanNorouzi/synchrobuilder/actions`). The seat and sibling tests
added later on 2026-10-15 have been run on macOS only so far; their first three-OS run
is the CI run for that change. Two real bugs were found by
that first run and fixed: an integration test that planted a file which silenced the
very rule it was testing on case-sensitive file systems, and Windows 8.3 short paths
(`RUNNER~1` against `runneradmin`) making tests disagree with the product's own path
canonicalization.

The counts below were measured on macOS. The skip is `case-duplicates` on a
case-insensitive file system, which cannot hold two names differing only by case; the
rule's logic is covered by a synthetic index in the same file, and the disk-level case
runs on the Linux CI job.

| Area | What is proven | Where |
| :-- | :-- | :-- |
| Hook contract | All six hooks exit 0 on recorded inputs, on malformed stdin, on an unknown verb and outside a git repository; output is a single JSON object or nothing; nothing is written outside the state directory | `tests/hooks/replay.test.mjs` |
| Hook speed | End to end per hook on this machine: 21 to 26 ms, measured by spawning the real dispatcher | `tests/hooks/replay.test.mjs` (prints timings) |
| Path identity | One checkout resolves to one state directory through a symlinked path, so a hook and the CLI agree; a linked worktree's `gitdir:` and `commondir` files are followed by reading them, with no git process; remote URL spellings normalize to one key | `tests/unit/paths.test.mjs` |
| Seat addressing | Three working trees of one clone get three distinct seats and three distinct state directories while still sharing one common git directory, and a plain clone's key is unchanged by the move from the common directory to the working tree's own, so no existing state directory moves; a seat is sixteen hex characters; writer refs carry the seat and two-segment refs from before seats parse with a null seat; `isSelf` compares the seat and falls back to handle and device when either side has none; teammates, siblings and remote writers are three different lists; the fold keeps every seat and marks which came off this machine. This row replaces an earlier claim that worktrees resolve to one state directory, which described the pre-seat collapsing rather than correctness | `tests/unit/workspace-seats.test.mjs` |
| Untrusted input | Identifier validators reject traversal, Windows-illegal names, control and format characters, homoglyphs and future timestamps | `tests/unit/schema.test.mjs` |
| Sanitizer and wrapper | The ADR-005 pipeline, the nonce-delimited wrapper and its guard, plus the 48-payload injection corpus from the threat model | `tests/injection/corpus.test.mjs`, `tests/unit/{sanitize,redact,wrap}.test.mjs` |
| Audit rules | Twelve rules with positive and negative fixtures | `tests/unit/audit-rules-1.test.mjs`, `tests/unit/audit-rule-path-concat.test.mjs`, `tests/integration/audit-demo.test.mjs` |
| Audit on the demo repo | Every planted bug is reported, the score is below 50, `--strict` exits 1, `--only` and `--report` work | `tests/integration/audit-demo.test.mjs` |
| Fixers | Each fixer on fixtures, diffs, idempotence, refusal to touch what it cannot parse or paths outside the repository | `tests/unit/fix.test.mjs` |
| Manifest | The reader and the shell-syntax rule, exercised through the setup planner: a command containing shell syntax becomes a manual step instead of being spawned, and a junk manifest yields no plan rather than throwing. The schema validator has **no dedicated test**; see Not verified. | `tests/unit/setup-plan.test.mjs` |
| Doctor | Findings ordered blocker, likely, note, each with an OS-specific fix; the fingerprint contains no environment variable values | `tests/unit/doctor-ci.test.mjs` |
| CI generator | Three runners, exact pinned versions, per-OS overrides as guarded steps, a health check that no quoting can break | `tests/unit/doctor-ci.test.mjs` |
| Setup | Plans for the three platforms, consent flags, manual steps for anything needing elevation, and the health-check step that no quoting can break | `tests/unit/setup-plan.test.mjs`, `tests/unit/doctor-ci.test.mjs` |
| Multiplayer features | Digest, inbox, collision, contracts, handoff, board, seats and the status line, against fixture snapshots | `tests/unit/features-*.test.mjs` |
| Transport | Publish and pull between two developers over a real bare git remote, and an unreachable remote that queues locally and recovers. Force-push survival, a poisoned ref and a mirror push that deletes the namespace are **not covered**; see Not verified. | `tests/e2e/multiplayer.test.mjs` |
| Budget starvation | A claim on a path long enough to be unrenderable can no longer delete the whole PreToolUse result: the permission decision is built before the context block and never depends on it. A message at the maximum size the schema permits is delivered rather than withheld forever | `tests/unit/features-collision.test.mjs`, `tests/unit/features-inbox.test.mjs` |
| Worker mutual exclusion | One worker per remote: a live holder keeps the lock, a dead holder is taken over, a non-owner can neither heartbeat nor release, `runWorker` refuses to start beside a live worker, and a worker whose lock is taken over mid-run stops instead of publishing beside the new holder | `tests/unit/lock.test.mjs` |
| Worker wake-ups | A kick that lands while a tick is still running wakes the worker immediately instead of being swallowed for a whole interval | `tests/unit/lock.test.mjs` |
| The detached worker, end to end | A session start spawns a real detached worker that takes the lock and publishes to the remote; a second worker refuses to start beside it; the other developer's worker pulls the claim; the session ends and the worker finishes a last tick, delivers that final claim and exits releasing its lock; neither repository is written to. Green on ubuntu, macOS and Windows, Node 20 and 24, on 2026-10-15 | `tests/e2e/worker.test.mjs` |
| Multiplayer end to end | Two developers, one bare remote, no Claude: presence, a claim producing a collision warning, a message round trip, a handoff reaching the other developer's digest, offline queueing and recovery, and neither repository touched | `tests/e2e/multiplayer.test.mjs` |
| Two agents in two worktrees, end to end | Two worktrees of one clone on one machine with one git identity, against a local bare remote, driving the real hooks, CLI and worker: the two trees are two seats with two state directories sharing one remote directory, both register and each publishes its own ref (`ls-remote` shows exactly two, one per seat), a claim made in one tree reaches the other tree's pre-edit hook with no worker tick in between, a file nobody holds produces no warning, `warn` mode stays advisory, `block` mode returns a deny naming `release` and `status`, releasing the claim lifts it at once, a sibling whose session has ended warns but does not block, and neither worktree is written to. Run on macOS on 2026-10-15 | `tests/e2e/worktree-agents.test.mjs` |

## Verified by running the real Claude Code CLI

Each of these was driven through `claude -p ... --plugin-dir plugins/synchrobuilder`
with a scratch `SYNCHROBUILDER_HOME`, so nothing touched the developer's own
configuration.

1. **Every hook runs and nothing breaks.** A session that created a file: all six hooks
   reported `outcome=success, exit=0`; the result was `is_error: false`.
2. **The guard reaches Claude in the same turn.** Asked to write a file containing
   `/Users/alice/logs/app.log`, Claude then quoted the guard note back verbatim:

   ```
   Synchrobuilder guard: this edit introduced 1 new portability finding in src/paths.js.
   - hardcoded-paths line 1: Contains a hard-coded home directory: /Users/alice Fix: Derive the path at runtime (os.homedir(), os.tmpdir(), path.join) or move it to configuration that each machine sets.
   This note is advisory and blocks nothing; /synchrobuilder:mute silences it for this checkout.
   ```

3. **The session produces team state by itself.** After one session in a repository with
   a remote: identity resolved from `team.json`, the journal recorded the session, the
   prompt, a task summary and the edited path, presence was built with the area and the
   recent edits, the background worker started from the session hook, published, pulled
   and wrote a snapshot, and a handoff was staged and finalized when the session closed.
4. **Fail open without Node.** With `node` removed from `PATH`, the session still
   completed and the file was still created; every hook reported a non-blocking error
   and Claude received no plugin context (Phase 0 experiment E3).
5. **Manifests validate.** `claude plugin validate --strict` passes on both
   `plugins/synchrobuilder` and the marketplace manifest.
6. **The transport works against real GitHub.** Against a throwaway private repository
   (`RyanNorouzi/synchrobuilder-transport-test`), 11 of 11 checks passed on 2026-09-18:
   GitHub accepts a push to `refs/synchrobuilder/v1/<handle>/<device>`;
   `--force-with-lease` replaces the writer's own ref; the ref never appears in
   `git branch -a` in an ordinary clone but does appear in `ls-remote`; a second clone
   fetches the namespace into its own local namespace and the published JSON
   round-trips; `main` is untouched; the branch-mode fallback publishes to
   `refs/heads/synchrobuilder/v1/...`; and no Actions workflow run was triggered by any
   state push.

7. **The marketplace install path works end to end on macOS.** Run on 2026-09-18 with
   `CLAUDE_CONFIG_DIR` pointed at a scratch directory, so the developer's own
   configuration was never touched (confirmed afterwards: no mention of the plugin in
   `~/.claude/settings.json`):

   ```
   claude plugin marketplace add RyanNorouzi/synchrobuilder
     SSH not configured, cloning via HTTPS: https://github.com/RyanNorouzi/synchrobuilder.git
     ✔ Successfully added marketplace: synchrobuilder (declared in user settings)
   claude plugin install synchrobuilder@synchrobuilder
     ✔ Successfully installed plugin: synchrobuilder@synchrobuilder (scope: user)
   ```

   `claude plugin details synchrobuilder` then reported 15 skills, 6 hooks, 0 MCP
   servers and about 443 always-on tokens. The cached copy contains only `bin`,
   `hooks`, `lib`, `skills` and `package.json`: no `node_modules`, because the plugin
   ships no lockfile and Claude Code therefore skips its dependency install, as
   intended. The audit and the guard hook were then run from the cached copy and
   behaved identically to the source tree. `claude plugin uninstall` removed it
   cleanly.

   Two things this run corrected: on Claude Code 2.1.218 the `owner/repo` shorthand
   detects that SSH is not configured and falls back to HTTPS by itself, so
   `CLAUDE_CODE_PLUGIN_PREFER_HTTPS` is not needed for that case; and a private
   repository installs fine for anyone whose git credentials can read it.

8. **The one-line install works from the published package.** `synchrobuilder@0.1.0`
   went live on npm on 2026-09-19. From an empty directory, with a scratch npm cache and
   a scratch `CLAUDE_CONFIG_DIR` so nothing local could help it,
   `npx --yes synchrobuilder@latest install --yes` downloaded the package, added the
   marketplace, installed the plugin and printed the next steps. `--plan` showed the
   plan and stopped. Running it a second
   time reported "already added" and "already installed" and changed nothing;
   `--uninstall` removed both; and with stdin not a terminal and no `--yes` it refused
   to act and said why instead of hanging.

## Verified by hand

- `synchrobuilder audit` on this repository reports 100/100 and `--strict` exits 0.
- `init`, `doctor`, `ci` and `setup --plan` were each run against a copy of the demo
  repository and produced the output shown in this document's git history.
- Every CLI command loads and prints its own help.

## Not verified

Nothing below is claimed anywhere as working.

| What | Why not | How it gets verified |
| :-- | :-- | :-- |
| The `ask` permission prompt | Interactive only | Manual pass before release |
| The status line as Claude Code renders it | Interactive only | Manual pass before release |
| Plugin monitors | Experimental and interactive only; Synchrobuilder treats them as an optional accelerator and does not ship one yet | Manual pass, if the feature is adopted |
| Custom git refs on GitLab, Bitbucket and Azure DevOps | Only GitHub was available here | Repeat the hosted transport check on each provider |
| Branch protection and rulesets refusing the state ref | The test repository had no rules configured | Enable a repository-wide ruleset and re-run the hosted transport check |
| The bare `/audit` short form in the command menu | Interactive only | Manual pass before release |
| The manifest schema validator | It is reached only indirectly, through the setup planner. Its own rules (exact versions, length and count limits, duplicate env names, `default` beside `value`) have no test asserting them directly | A dedicated `tests/unit/manifest.test.mjs` |
| Force-push survival, a poisoned ref, and a mirror push that deletes the namespace | The hosted GitHub check confirmed `--force-with-lease` replaces the writer's own ref, but no test drives a hostile or destructive remote | An end-to-end test that corrupts and deletes the namespace between ticks |
| Package managers resolved without a shell on Windows | The resolution code exists and is unit tested with a fake layout; no real Windows run | Windows CI |
| Claude Code acting on a `block` decision | The test asserts the hook's `permissionDecision: "deny"` output, not that the CLI refuses the edit when it receives one. The shape comes from the hooks documentation | A session driven through `claude -p` with `collision.mode` set to `block` |
| Two separate clones of one remote on one machine | The worktree test covers two working trees of one clone. Nothing registers two independent clones against one remote, which is the other case the per-seat registry and per-seat publishing were written for | Extend the worktree test with a second clone of the same remote |

## How to keep this file honest

A pull request that adds a capability adds its row here, with the test that proves it.
If a row cannot name a test or a recorded run, the claim does not go on the website.
