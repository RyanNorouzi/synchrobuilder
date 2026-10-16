# Changelog

All notable changes to Synchrobuilder. The format follows Keep a Changelog;
versions follow semver. The plugin version in
`plugins/synchrobuilder/.claude-plugin/plugin.json` is the cache key Claude
Code uses to detect updates, so every release bumps it.

## 0.2.0 - 2026-10-15

Several Claude Code sessions can now work in one repository at the same time,
including two agents in two git worktrees of the same clone on one machine.
Before this, every worktree of a clone collapsed into a single participant, so
those agents could not see each other at all.

### Added
- Seats. A seat is one git working tree, and it is the third segment of the
  writer ref: `refs/synchrobuilder/v1/<handle>/<device>/<seat>`. Two-segment
  refs published by 0.1.0 still read, and `isSelf` falls back to the old
  handle-and-device rule whenever either side predates seats, so an upgrade
  never shows you your own work as a teammate's.
- A same-machine fast path. Agents sharing a disk read each other's state
  directly instead of waiting for a sync, so a claim reaches a sibling in
  milliseconds rather than the 45 to 60 second remote interval.
- `collision.mode = "block"`, which refuses an edit to a file another agent on
  this machine is holding. Opt-in, and narrow by design: a teammate on another
  machine can never trigger it, and neither can an agent whose session has
  ended. Every internal error path still fails open.
- `collision.siblingWindowMinutes` (default 2, may be 0), a shorter warning
  throttle for same-machine agents, whose work is measured in minutes.
- `status` shows which agents share this machine, with a WHERE column and a
  count of what they are holding.
- `tests/e2e/worker.test.mjs`, which proves the detached background worker
  starts, publishes, outlives its session, finishes a last tick and exits.
- `tests/e2e/worktree-agents.test.mjs` and `tests/unit/workspace-seats.test.mjs`.

### Fixed
- A teammate could switch off the only non-advisory control in the plugin. The
  collision hook rendered its context block before building the permission
  decision and returned nothing if the block did not fit, so a claim on a path
  of about 480 characters, which the schema permits up to 512, discarded the
  whole result including a `deny`. The decision is now built first and the
  block can never gate it.
- A message at the size the schema permits was silently lost forever. The
  schema allows 400 code points, the sanitizer HTML-escapes after capping so
  400 ampersands become 1,998 characters, and the 2,000 character inbox budget
  could not carry that with its frame. The block failed to render, `inbox()`
  returned before marking anything seen, and the message was dropped again on
  every later prompt until it expired. `inboxChars` is now 3,200, which carries
  a maximal message with margin and stays far below the 10,000 guard.
- The worker published only the last registered checkout, so a second clone or
  worktree had its claims, presence and messages silently discarded.
- The worker's mutual-exclusion guard tested a result object rather than its
  `.ok` field, so it never fired and two workers could race to publish one ref.
- The worker ignored a failed heartbeat and kept publishing after another
  worker had taken its lock.
- A wake-up that arrived while a tick was running was swallowed, delaying the
  work by a full interval.
- The checkout registry was an unlocked read-modify-write of one shared array;
  it is now one file per seat.
- Handoffs were published verbatim while every neighbouring field was redacted,
  and `appendJournal` validated and redacted nothing. Both are closed.
- `resolveIdentity` never carried an email, so `transport.realEmail` silently
  did nothing.
- One agent consumed the collision warning on behalf of every other worktree.
- `handoff <handle> --for <same handle>` recorded the recipient twice.
- The prompt and pre-edit watchdogs were 120 ms, measured on a fast machine. A
  Windows CI runner is roughly four times slower, where the pre-edit watchdog
  fired and the collision warning vanished with no sign to the user. Both are
  now 400 ms, still far inside Claude Code's own 5 s hook timeout.

### Documentation
- ADR-001, ADR-002 and ADR-003 carry dated amendments for the seat axis,
  per-seat publishing and the blocking exception to the fail-open contract.
- ADR-002's claim that the worker confirms worktrees with `git rev-parse` is
  corrected: no such call was ever written.
- `docs/VERIFICATION.md` no longer presents the old worktree-collapsing
  behaviour as proven correctness, and cites only test files that exist.

## 0.1.0 - 2026-09-19

First public release. Published to npm as `synchrobuilder`, installable with
`npx synchrobuilder@latest install` or the two Claude Code plugin commands.
Website: https://synchrobuilder.com/


### Added
- Phase 0: research notes, experiments, ADRs 001-006, PLAN.md.
- Website source under `site/` with a Node-only build and static checks.
- Phase 1: plugin and marketplace manifests, exec-form hook declarations for
  six events, the fail-open hook dispatcher, core library (state paths and
  git discovery by file reads, atomic JSON, argv-only process helpers,
  schemas and validators), the `synchrobuilder` CLI skeleton, generated
  skills for every command, hook replay and unit tests, and the three-OS CI
  workflow.
- Portability: an audit engine with twelve rules (import casing, case
  duplicates, Unix-only package scripts, required shell scripts, line
  endings, executable bits and symlinks, Windows-illegal names and long
  paths, Python assumptions, native dependencies, one-OS READMEs,
  hard-coded paths, path concatenation), terminal and JSON reports with a
  score, and the `audit` command with `--strict` for CI.
- Fixers for import casing, `.gitattributes`, Unix commands in package
  scripts and path concatenation, with the `fix` command that shows every
  diff and applies nothing without `--yes`.
- A guard hook that re-audits a file right after Claude edits it and reports
  only what the edit introduced, advisory and silenced by `mute`.
- `synchrobuilder.json`: schema, detection, `init`, `setup` with per-step
  consent and a health check, `doctor` with a fingerprint and ordered
  findings, and `ci` which generates a three-OS workflow and a badge.
- Multiplayer: the git transport (one ref per developer and device, snapshot
  commits, force-with-lease, branch fallback), identity from the git email
  through a committed team file, the background sync worker, and the
  features: session digest, inbox, collision warnings, contract alerts,
  handoffs, task board, seats notice and an optional status line.
- The safety layer: sanitizer, redactor and the nonce-delimited untrusted
  teammate data wrapper, with a 48-payload injection corpus.
- `docs/PRIVACY.md`, `docs/SECURITY-MODEL.md`, `docs/manifest-spec.md`,
  `docs/hub-api.md` and `docs/VERIFICATION.md`; `scripts/demo.mjs` sets up
  two developers on one machine.

### Known gaps
- Windows and Linux are unverified until CI runs; see `docs/VERIFICATION.md`.
- Hosted git providers have not been tested with custom refs.
