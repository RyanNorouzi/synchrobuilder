# Changelog

All notable changes to Synchrobuilder. The format follows Keep a Changelog;
versions follow semver. The plugin version in
`plugins/synchrobuilder/.claude-plugin/plugin.json` is the cache key Claude
Code uses to detect updates, so every release bumps it.

## Unreleased

### Added
- Phase 0: research notes, experiments, ADRs 001-006, PLAN.md.
- Website source under `site/` with a Node-only build and static checks.
- Phase 1: plugin and marketplace manifests, exec-form hook declarations for
  six events, the fail-open hook dispatcher, core library (state paths and
  git discovery by file reads, atomic JSON, argv-only process helpers,
  schemas and validators), the `synchrobuilder` CLI skeleton with `mute` and
  `clean`, generated skills for every command, hook replay and unit tests,
  and the three-OS CI workflow.
