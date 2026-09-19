# Changelog

All notable changes to Synchrobuilder. The format follows Keep a Changelog;
versions follow semver. The plugin version in
`plugins/synchrobuilder/.claude-plugin/plugin.json` is the cache key Claude
Code uses to detect updates, so every release bumps it.

## 0.1.0 - 2026-09-19

First public release. Published to npm as `synchrobuilder`, installable with
`npx synchrobuilder@latest install` or the two Claude Code plugin commands.
Website: https://ryannorouzi.github.io/synchrobuilder/


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
