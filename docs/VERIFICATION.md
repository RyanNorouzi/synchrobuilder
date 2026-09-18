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

## Verified by the test suite

223 tests, 222 passing and 1 skipped, on macOS. The skip is `case-duplicates` on a
case-insensitive file system, which cannot hold two names differing only by case; the
rule's logic is covered by a synthetic index in the same file, and the disk-level case
runs on the Linux CI job.

| Area | What is proven | Where |
| :-- | :-- | :-- |
| Hook contract | All six hooks exit 0 on recorded inputs, on malformed stdin, on an unknown verb and outside a git repository; output is a single JSON object or nothing; nothing is written outside the state directory | `tests/hooks/replay.test.mjs` |
| Hook speed | End to end per hook on this machine: 21 to 26 ms, measured by spawning the real dispatcher | `tests/hooks/replay.test.mjs` (prints timings) |
| Path identity | One checkout resolves to one state directory through symlinks, worktrees and `gitdir:` files; remote URL spellings normalize to one key | `tests/unit/paths.test.mjs` |
| Untrusted input | Identifier validators reject traversal, Windows-illegal names, control and format characters, homoglyphs and future timestamps | `tests/unit/schema.test.mjs` |
| Sanitizer and wrapper | The ADR-005 pipeline, the nonce-delimited wrapper and its guard, plus the 48-payload injection corpus from the threat model | `tests/injection/corpus.test.mjs`, `tests/unit/{sanitize,redact,wrap}.test.mjs` |
| Audit rules | Twelve rules with positive and negative fixtures | `tests/unit/audit-rules-1.test.mjs`, `tests/unit/audit-rules-2.test.mjs` |
| Audit on the demo repo | Every planted bug is reported, the score is below 50, `--strict` exits 1, `--only` and `--report` work | `tests/integration/audit-demo.test.mjs` |
| Fixers | Each fixer on fixtures, diffs, idempotence, refusal to touch what it cannot parse or paths outside the repository | `tests/unit/fix.test.mjs` |
| Manifest | Schema accepts and rejects per ADR-004, including shell syntax in commands and a value on an env entry | `tests/unit/manifest.test.mjs` |
| Doctor | Findings ordered blocker, likely, note, each with an OS-specific fix; the fingerprint contains no environment variable values | `tests/unit/doctor-ci.test.mjs` |
| CI generator | Three runners, exact pinned versions, per-OS overrides as guarded steps, a health check that no quoting can break | `tests/unit/doctor-ci.test.mjs` |
| Setup | Plans for the three platforms, consent flags, manual steps for anything needing elevation, health checks over HTTP and by command | `tests/unit/setup-*.test.mjs`, `tests/unit/health.test.mjs` |
| Multiplayer features | Digest, inbox, collision, contracts, handoff, board, seats and the status line, against fixture snapshots | `tests/unit/features-*.test.mjs` |
| Transport | Two developers over a real bare git remote: publish, pull, force-push survival, a poisoned ref, a mirror push that deletes the refs, an unreachable remote | `tests/e2e/transport.test.mjs` |
| Multiplayer end to end | Two developers, one bare remote, no Claude: presence, a claim producing a collision warning, a message round trip, a handoff reaching the other developer's digest, offline queueing and recovery, and neither repository touched | `tests/e2e/multiplayer.test.mjs` |

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

## Verified by hand

- `synchrobuilder audit` on this repository reports 100/100 and `--strict` exits 0.
- `init`, `doctor`, `ci` and `setup --plan` were each run against a copy of the demo
  repository and produced the output shown in this document's git history.
- Every CLI command loads and prints its own help.

## Not verified

Nothing below is claimed anywhere as working.

| What | Why not | How it gets verified |
| :-- | :-- | :-- |
| Windows, anything | No Windows machine here | The CI matrix (`ubuntu`, `macos`, `windows`, Node 20 and 24, plus a CRLF checkout job) runs on the first push to GitHub |
| Linux, anything | Same | Same CI matrix |
| Hook latency on Windows | Defender and cold starts are unknown | The replay test prints timings on every runner |
| The detached worker on Windows and Linux | Job Objects on Windows, process groups on Linux | A dedicated CI step, once a remote exists |
| Installing through a marketplace | Would write to the developer's `~/.claude`; not done without being asked | Run the two install commands on a test machine |
| The `ask` permission prompt | Interactive only | Manual pass before release |
| The status line as Claude Code renders it | Interactive only | Manual pass before release |
| Plugin monitors | Experimental and interactive only; Synchrobuilder treats them as an optional accelerator and does not ship one yet | Manual pass, if the feature is adopted |
| Custom git refs on hosted providers | Only a local bare remote was used | Push to a throwaway repository on GitHub, GitLab, Bitbucket and Azure DevOps and record the results |
| The bare `/audit` short form in the command menu | Interactive only | Manual pass before release |
| Package managers resolved without a shell on Windows | The resolution code exists and is unit tested with a fake layout; no real Windows run | Windows CI |

## How to keep this file honest

A pull request that adds a capability adds its row here, with the test that proves it.
If a row cannot name a test or a recorded run, the claim does not go on the website.
