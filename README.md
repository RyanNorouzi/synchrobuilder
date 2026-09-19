# Synchrobuilder

[![ci](https://github.com/RyanNorouzi/synchrobuilder/actions/workflows/ci.yml/badge.svg)](https://github.com/RyanNorouzi/synchrobuilder/actions/workflows/ci.yml)

Multiplayer Claude Code for teams on any laptop. No server, safe by design.

Synchrobuilder is an open-source Claude Code plugin with two pillars that ship
together:

- **Portability.** Make a project run on macOS, Windows and Linux, and keep it
  that way while Claude writes code: audit, fix, an advisory guard hook, a
  machine-neutral setup manifest, `doctor`, and a three-OS CI generator.
- **Multiplayer.** Several developers, each with their own Claude Code on
  their own machine, working in the same repo at the same time, with each
  Claude aware of what the others are doing. State travels through the git
  remote you already have; nothing is hosted.

## Status

Pre-release. See [PLAN.md](PLAN.md) for the phases and
[CHANGELOG.md](CHANGELOG.md) for what exists. Nothing is claimed to work
unless a test in this repository proves it; see `docs/VERIFICATION.md` once it
exists.

## Install

```
npx synchrobuilder@latest install
```

It shows you the two Claude Code commands it will run, asks, then runs them.
`--uninstall` reverses it. To do it by hand inside Claude Code:

```
/plugin marketplace add RyanNorouzi/synchrobuilder
/plugin install synchrobuilder@synchrobuilder
```

The repository is private while it is being finished, so the marketplace install works
only for people it is shared with. Prerequisites:
Claude Code, Node.js 20 or newer on `PATH`, git.

To try a checkout locally without installing anything:

```
claude --plugin-dir ./plugins/synchrobuilder
```

## Development

Nothing but Node and git. No dependencies, no build step.

```
node scripts/lint.mjs      # every .mjs parses, files under 500 lines, skills up to date
node scripts/test.mjs      # node:test suites
node site/build.mjs        # the website, into site/dist
node scripts/gen-skills.mjs  # regenerate plugin skills from docs/commands.md
```

Layout: `plugins/synchrobuilder/` is the plugin and the npm package
(`bin/`, `lib/`, `hooks/`, `skills/`); `tests/` holds the suites; `docs/`
holds research, ADRs and the command reference; `site/` is the website.

## License

MIT. See [LICENSE](LICENSE).
