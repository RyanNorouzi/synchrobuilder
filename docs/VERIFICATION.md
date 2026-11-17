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
| Manifest | The reader and the shell-syntax rule, exercised through the setup planner: a command containing shell syntax becomes a manual step instead of being spawned, and a junk manifest yields no plan rather than throwing. The schema validator's own rules are asserted directly: exact versions, env entries without values or duplicates, shell syntax refused wherever a command can appear, length and range limits, `x-` extensions, per-OS overrides. | `tests/unit/setup-plan.test.mjs`, `tests/unit/manifest.test.mjs` |
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
| Leases, the rules | Against a fake compare-and-swap store with the clock passed in: first taker holds, a second seat on the machine is refused, a lease stops counting when its session ends or it goes idle or is released, a dead process holds nothing, the table mutex recovers from an abandoned lock and a busy table lets the edit through, one winner on the remote and the loser gives its local slot back, takeover only after expiry plus grace, a machine that slept is refused on waking, an unreachable remote never blocks, remote leases only with a teammate elsewhere and no public hold, hostile lease documents dropped, deny by default and warn or off on request, an unlisted handle never enforced | `tests/unit/leases.test.mjs` |
| Leases, the remote contract | Against a real bare git remote: create is exclusive, replace needs the sha that is there (and works though the new commit is not a descendant), a wrong expectation changes nothing, delete removes only a lease that is still ours, one listing returns every lease and a forged record inside a commit message is not one, six creators from six repositories get exactly one winner, and a rejection is read as a lost race whatever digits its commit id contains | `tests/unit/lease-refs.test.mjs` |
| Leases, upkeep | Renewal at half life by compare-and-swap; refs deleted on session end, idle and release; a release made offline waits for the remote; a lease taken offline is pushed later; a lease that changed hands is flagged and the next edit refused; refs unrenewed for an hour are collected and live ones never | `tests/unit/lease-upkeep.test.mjs` |
| Leases, end to end | Two homes, two clones, one real bare remote, the real hooks, CLI and worker: no lease ref while a developer is alone; the first editor's lease ref on the remote; the other machine's hook prints a deny naming the holder; five rounds of two pre-edit hooks started at the same moment on the same new file, exactly one refusal each; `release` and session end free the file after one sync; `lease take --force` and the old holder refused at its next sync; two worktrees on one machine refused with no sync and freed at session end with no worker tick; `leases.mode = off` takes and refuses nothing. Run on Windows on 2026-11-16 | `tests/e2e/leases.test.mjs` |
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

## Verified against a hosted remote

`node scripts/hosted-lease-check.mjs <repo root> <remote url>` drives the
lease flow from two homes and two clones against a real remote. Against a
private GitHub repository from Windows on 2026-11-16, eight of eight checks
passed: both developers see each other; the first edit takes a lease inside
the hook's budget (1,728 ms); a second edit to that file is local only
(194 ms); the other machine is refused (2,150 ms) and refused again from the
cache (173 ms); four of four rounds of simultaneous first edits had exactly
one winner (hooks took 1.7 to 2.9 s); a released file is free after one sync;
and ending both sessions left no lease refs behind.

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
| The worker holding back on a public remote, end to end | `tests/unit/privacy-defaults.test.mjs` asserts the decision (`publishHold`) and the visibility check against a fake HTTP client. No test runs a whole worker tick against a public GitHub repository and confirms nothing was pushed | A hosted check against a throwaway public repository |
| Public-repository detection on hosts other than GitHub | Only github.com can be asked without credentials; every other host is treated as not public | A per-host check, if those hosts expose one |
| Force-push survival, a poisoned ref, and a mirror push that deletes the namespace | The hosted GitHub check confirmed `--force-with-lease` replaces the writer's own ref, but no test drives a hostile or destructive remote | An end-to-end test that corrupts and deletes the namespace between ticks |
| Package managers resolved without a shell on Windows | The resolution code exists and is unit tested with a fake layout; no real Windows run | Windows CI |
| Claude Code acting on a lease refusal | The tests assert the hook's `permissionDecision: "deny"` output and its reason. That the CLI refuses the edit, and that the agent then does other work instead of retrying or going around the hook with a shell command, has not been driven through a real session | Two sessions through `claude -p` on one file |
| Leases on GitLab, Bitbucket and Azure DevOps | Only GitHub and a local bare remote were available. The mechanism is plain git compare-and-swap, but whether those hosts accept the `refs/synchrobuilder/lease1/` namespace is unknown | `scripts/hosted-lease-check.mjs` against each |
| Leases on macOS and Linux | Written and run on Windows only so far | CI |
| Leases under clock skew between machines | The margins (one minute before expiry for the holder, two minutes after for everyone else, renewal at half life) are asserted with one clock. No test runs two machines whose clocks disagree | A test that offsets one side's clock |
| A file changed through the shell | `sed`, a formatter or a script edits a file without the Edit tool, so no hook runs and no lease is taken | Not fixable in a hook; documented as a limit |
| Claude Code acting on a `block` decision | The test asserts the hook's `permissionDecision: "deny"` output, not that the CLI refuses the edit when it receives one. The shape comes from the hooks documentation | A session driven through `claude -p` with `collision.mode` set to `block` |
| Two separate clones of one remote on one machine | The worktree test covers two working trees of one clone. Nothing registers two independent clones against one remote, which is the other case the per-seat registry and per-seat publishing were written for | Extend the worktree test with a second clone of the same remote |

## How to keep this file honest

A pull request that adds a capability adds its row here, with the test that proves it.
If a row cannot name a test or a recorded run, the claim does not go on the website.
